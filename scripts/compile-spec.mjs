#!/usr/bin/env node
/* compile-spec.mjs — inline the engine + a spec (+ optional data) into one
 * self-contained, offline, no-build HTML file.
 *
 *   node scripts/compile-spec.mjs <spec.(yaml|yml|json|md)> [--data data.json] [-o out.html]
 *
 * The spec is parsed with the SAME engine.js that runs in the browser (loaded
 * here under node:vm), so author-time and runtime YAML parsing are byte-identical.
 * JSON payloads are embedded with `</` -> `<\/` so a value containing `</script>`
 * can never close the tag early; the round-trip JSON.parse restores it.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const __FILENAME = fileURLToPath(import.meta.url);
const HERE = dirname(__FILENAME);
const ROOT = join(HERE, "..");

const SPEC_OPEN = '<script id="embedded-spec" type="application/json">';
const DATA_OPEN = '<script id="embedded-data" type="application/json">';
const CSP_PLACEHOLDER = "<!--__CSP_META__-->";

/* ── Theme packs ──────────────────────────────────────────────────────────
 * A theme pack is a CSS artifact providing the `--cabin-*` token vocabulary
 * (day + night + fonts) — the swappable design system. The compiler inlines the
 * SELECTED pack's tokens ahead of the engine's widget CSS, so the single output
 * carries exactly one pack and stays self-contained. Default pack = Cabin. */
const THEMES_DIR = join(ROOT, "themes");
const DEFAULT_THEME = "cabin";

/* Resolve a `--theme` value to a pack's CSS file path. Accepts: a bare pack name
 * under themes/ (e.g. "cabin", "cool-slate" -> themes/<name>/theme.css); a path to
 * a pack directory (containing theme.css); or a path straight to a .css file.
 * Throws a clear error if nothing resolves. */
export function resolveThemePath(theme) {
  const t = theme == null ? DEFAULT_THEME : String(theme);
  // bare pack name (no separator, not a .css path) -> bundled pack dir
  if (!t.includes("/") && !t.endsWith(".css")) {
    const p = join(THEMES_DIR, t, "theme.css");
    if (existsSync(p)) return p;
    throw new Error(`unknown theme pack "${t}" (looked for ${p})`);
  }
  const abs = isAbsolute(t) ? t : resolve(t);
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const p = join(abs, "theme.css");
    if (existsSync(p)) return p;
    throw new Error(`theme pack dir has no theme.css: ${abs}`);
  }
  if (existsSync(abs)) return abs; // a direct .css (or any) file
  throw new Error(`theme not found: ${t}`);
}

/* Load + GUARD a theme pack's CSS. A swapped/dropped pack must not be able to
 * break the offline / CSP-clean invariant, so reject any @import, @font-face, or
 * url(http(s)://…) — the same three shapes the offline-csp regression test pins.
 * Returns the CSS text, ready to inline ahead of the widget styles. */
export function loadThemeCss(theme) {
  const path = resolveThemePath(theme);
  const css = readFileSync(path, "utf8");
  // Guard against the offline/CSP-breaking shapes, but only in REAL CSS — strip
  // /* */ comments first so a pack may *mention* @font-face etc. in a header.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\s+(url|['"])/i.test(bare))
    throw new Error(`theme pack uses @import (breaks offline/CSP): ${path}`);
  if (/@font-face/i.test(bare))
    throw new Error(`theme pack uses @font-face (breaks offline/CSP): ${path}`);
  if (/url\(\s*['"]?(https?:|\/\/)/i.test(bare))
    throw new Error(`theme pack references an external url() (breaks offline/CSP): ${path}`);
  return css; // return the ORIGINAL css (comments intact) for inlining
}

/* load the browser engine's pure API under node:vm (no document => no boot) */
export function loadEngineApi() {
  const code = readFileSync(join(ROOT, "engine.js"), "utf8");
  const ctx = { module: { exports: {} }, console };
  vm.runInNewContext(code, ctx);
  return ctx.module.exports;
}

function escapeForScript(json) {
  return json.replace(/<\//g, "<\\/");
}

function spliceTag(html, openTag, body) {
  const start = html.indexOf(openTag);
  if (start < 0) throw new Error("template missing tag: " + openTag);
  const end = html.indexOf("</script>", start);
  if (end < 0) throw new Error("template missing close for: " + openTag);
  return html.slice(0, start + openTag.length) + body + html.slice(end);
}

/* the template with the SELECTED theme pack's tokens + engine widget CSS + JS
 * inlined (embeds left empty). The theme pack is inlined FIRST so its --cabin-*
 * custom properties are defined before the widget rules that consume them. */
function assembleShell(theme) {
  const themeCss = loadThemeCss(theme);
  const css = readFileSync(join(ROOT, "engine.css"), "utf8");
  const js = readFileSync(join(ROOT, "engine.js"), "utf8");
  if (js.indexOf("</scr" + "ipt") >= 0) throw new Error("engine.js contains a literal </script — would break inlining");
  return readFileSync(join(ROOT, "engine.html.tmpl"), "utf8")
    .replace("/*__ENGINE_CSS__*/", () => themeCss + "\n" + css)
    .replace("/*__ENGINE_JS__*/", () => js);
}

/* base64(sha256) of the inlined engine <script> body, for a CSP script-src
 * 'sha256-..' source. Hash the EXACT child text of the single attribute-less
 * <script> — the one element the browser executes and the tests extract — so the
 * policy matches the bytes actually in the file. (The embedded spec/data scripts
 * are type="application/json": non-executable data blocks, not subject to
 * script-src, and they are spliced AFTER this so the hash stays valid.) */
export function engineScriptHash(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("could not locate the engine <script> for CSP hashing");
  return "sha256-" + createHash("sha256").update(m[1]).digest("base64");
}

/* connect-src lock for a declared dataSource url: an absolute http(s) url -> its
 * origin (scheme://host[:port]); a root-relative same-origin path -> 'self'.
 * Mirrors normalizeDataSource's accepted shapes; null = not a lockable url. */
export function connectSrcFor(url) {
  if (typeof url !== "string") return null;
  const u = url.trim();
  // absolute http(s): accept ONLY a clean origin (scheme://host[:port], host =
  // letters/digits/dots/hyphens) that ends or is followed by /?#. This rejects any
  // url whose origin carries characters ("/;/space/</>) that could break out of the
  // CSP meta content attribute — a crafted url then yields null and the caller locks
  // connect-src to 'none' rather than emitting an injectable policy.
  const abs = /^(https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?)(?:[/?#]|$)/i.exec(u);
  if (abs) return abs[1];
  if (u[0] === "/") return "'self'";
  return null;
}

/* the CSP meta. script-src is pinned to the engine hash with NO 'unsafe-inline',
 * so an injected inline script / event handler (e.g. a malicious view footer
 * written to innerHTML) is BLOCKED while the engine's own inline script runs.
 * style-src stays 'unsafe-inline' (the inlined <style> + the bar's style=; CSS
 * cannot execute JS). connect: null -> connect-src omitted (the networked blank
 * loader keeps ?spec=URL); "'none'" -> the inert artifact phones nobody; an origin
 * -> exactly the one dataSource endpoint. script-src and connect-src are
 * orthogonal, so the XSS lock holds in every tier. */
export function cspMeta(scriptHash, connect) {
  const d = [
    "script-src '" + scriptHash + "'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
  ];
  if (connect != null) d.push("connect-src " + connect);
  return '<meta http-equiv="Content-Security-Policy" content="' + d.join("; ") + '">';
}

function injectCsp(html, connect) {
  if (html.indexOf(CSP_PLACEHOLDER) < 0) throw new Error("template missing CSP placeholder: " + CSP_PLACEHOLDER);
  const hash = engineScriptHash(html);
  return html.replace(CSP_PLACEHOLDER, () => cspMeta(hash, connect));
}

/* the generic "bring your own spec" output: engine inlined, embeds left empty.
 * connect-src is left UNRESTRICTED (the ?spec=URL / ?data=URL loader fetches
 * arbitrary author-supplied URLs) — but script-src still locks out injected
 * scripts, so a dropped untrusted spec's footer XSS is closed here too. */
export function compileBlank(theme) { return injectCsp(assembleShell(theme), null); }

export function compile({ specText, dataText, theme }) {
  const api = loadEngineApi();
  const parsed = api.parseSpecText(specText);
  const env = api.parseEnvelope(parsed.data);
  const errs = api.validateEnvelope(env);
  if (errs.length) throw new Error("spec invalid:\n  - " + errs.join("\n  - "));

  // connect-src: a dataSource view locks egress to its endpoint origin; every
  // other compiled artifact is inert and may phone NOBODY.
  let connect = "'none'";
  if (env.dataSource && env.dataSource.url) {
    const origin = connectSrcFor(env.dataSource.url);
    if (origin) connect = origin;
  }
  let html = injectCsp(assembleShell(theme), connect);
  html = spliceTag(html, SPEC_OPEN, escapeForScript(JSON.stringify(env.spec)));
  if (dataText != null) {
    const data = JSON.parse(dataText);
    html = spliceTag(html, DATA_OPEN, escapeForScript(JSON.stringify(data)));
  }
  return { html, env };
}

function parseArgs(argv) {
  const a = { spec: null, data: null, out: null, theme: null, blank: false, watch: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--data") a.data = argv[++i];
    else if (v === "-o" || v === "--out") a.out = argv[++i];
    else if (v === "--theme") a.theme = argv[++i];
    else if (v === "--blank") a.blank = true;
    else if (v === "--watch") a.watch = true;
    else if (!a.spec) a.spec = v;
    else throw new Error("unexpected argument: " + v);
  }
  if (!a.blank && !a.spec) throw new Error("usage: compile-spec.mjs <spec> [--data data.json] [--theme pack] [-o out.html] [--watch]  |  --blank [--theme pack] -o render.html");
  return a;
}

/* one read->compile->write cycle. Returns {out, bytes, kind, name}; THROWS on a bad
 * spec so the caller decides whether to abort (one-shot) or keep watching. Shared by
 * the non-watch path and the watch loop so the written output is identical either way. */
export function compileOnce(args) {
  const specText = readFileSync(resolve(args.spec), "utf8");
  const dataText = args.data ? readFileSync(resolve(args.data), "utf8") : null;
  const { html, env } = compile({ specText, dataText, theme: args.theme });
  const out = args.out ? resolve(args.out) : resolve((env.meta.name || "out") + ".html");
  writeFileSync(out, html);
  return { out, bytes: html.length, kind: env.kind, name: env.meta.name };
}

/* trailing-edge debounce: collapses a burst of calls into one fn(lastArg) after
 * `ms` of quiet. Real timers are fine in this shipped Node script. .cancel() drops
 * a pending fire (used by tests + any future teardown). */
export function debounce(fn, ms) {
  let timer = null;
  let lastArg;
  const wrapped = (arg) => {
    lastArg = arg;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(lastArg); }, ms);
  };
  wrapped.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return wrapped;
}

/* watch-mode: recompile on any change to the spec, --data, or the three engine
 * source files. fs.watch only (no deps). Debounced so one save = one rebuild.
 * A bad spec prints + KEEPS watching; it never tears down the loop. */
export function watchMode(args) {
  let n = 0;
  const rebuild = (trigger) => {
    n++;
    try {
      const { out, bytes } = compileOnce(args);
      process.stderr.write("[watch #" + n + "] " + trigger + " -> recompiled " + out + " (" + bytes + " bytes)\n");
    } catch (e) {
      process.stderr.write("[watch #" + n + "] " + trigger + " -> compile FAILED, still watching:\n  " + e.message + "\n");
    }
  };
  const debounced = debounce(rebuild, 100);

  // also watch the SELECTED theme pack so editing the palette recompiles. Resolve
  // it defensively — a bad --theme just drops it from the watch set (the rebuild
  // will surface the error itself).
  let themePath = null;
  try { themePath = resolveThemePath(args.theme); } catch { themePath = null; }
  const targets = [
    resolve(args.spec),
    args.data ? resolve(args.data) : null,
    themePath,
    join(ROOT, "engine.js"),
    join(ROOT, "engine.css"),
    join(ROOT, "engine.html.tmpl"),
  ].filter((p) => p && p !== __FILENAME && existsSync(p));
  const seen = new Set();
  const watchers = [];
  for (const p of targets) {
    if (seen.has(p)) continue;
    seen.add(p);
    const w = watch(p, () => debounced(basename(p)));
    w.on("error", (e) => process.stderr.write("[watch] watcher error on " + basename(p) + ": " + e.message + "\n"));
    watchers.push(w);
  }
  process.stderr.write("[watch] watching " + seen.size + " file(s); compiling once, then on change. Ctrl-C to stop.\n");
  rebuild("initial"); // compile immediately so the output exists before the first edit

  const stop = () => {
    debounced.cancel();
    for (const w of watchers) { try { w.close(); } catch (e) {} }
  };
  process.on("SIGINT", () => { stop(); process.exit(0); });
  return { stop, watchers };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.blank) {
    if (args.watch) throw new Error("--watch has no inputs to watch with --blank");
    const html = compileBlank(args.theme);
    const out = args.out ? resolve(args.out) : resolve("render.html");
    writeFileSync(out, html);
    process.stderr.write(`compiled blank renderer -> ${out} (${html.length} bytes)\n`);
    return;
  }
  if (args.watch) { watchMode(args); return; }
  const { out, bytes, kind, name } = compileOnce(args);
  process.stderr.write(`compiled ${kind} '${name}' -> ${out} (${bytes} bytes)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
