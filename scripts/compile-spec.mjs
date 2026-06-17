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
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const SPEC_OPEN = '<script id="embedded-spec" type="application/json">';
const DATA_OPEN = '<script id="embedded-data" type="application/json">';

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

/* the template with engine CSS + JS inlined (embeds left empty) */
function assembleShell() {
  const css = readFileSync(join(ROOT, "engine.css"), "utf8");
  const js = readFileSync(join(ROOT, "engine.js"), "utf8");
  if (js.indexOf("</scr" + "ipt") >= 0) throw new Error("engine.js contains a literal </script — would break inlining");
  return readFileSync(join(ROOT, "engine.html.tmpl"), "utf8")
    .replace("/*__ENGINE_CSS__*/", () => css)
    .replace("/*__ENGINE_JS__*/", () => js);
}

/* the generic "bring your own spec" output: engine inlined, embeds left empty */
export function compileBlank() { return assembleShell(); }

export function compile({ specText, dataText }) {
  const api = loadEngineApi();
  const parsed = api.parseSpecText(specText);
  const env = api.parseEnvelope(parsed.data);
  const errs = api.validateEnvelope(env);
  if (errs.length) throw new Error("spec invalid:\n  - " + errs.join("\n  - "));

  let html = assembleShell();
  html = spliceTag(html, SPEC_OPEN, escapeForScript(JSON.stringify(env.spec)));
  if (dataText != null) {
    const data = JSON.parse(dataText);
    html = spliceTag(html, DATA_OPEN, escapeForScript(JSON.stringify(data)));
  }
  return { html, env };
}

function parseArgs(argv) {
  const a = { spec: null, data: null, out: null, blank: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--data") a.data = argv[++i];
    else if (v === "-o" || v === "--out") a.out = argv[++i];
    else if (v === "--blank") a.blank = true;
    else if (!a.spec) a.spec = v;
    else throw new Error("unexpected argument: " + v);
  }
  if (!a.blank && !a.spec) throw new Error("usage: compile-spec.mjs <spec> [--data data.json] [-o out.html]  |  --blank -o render.html");
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.blank) {
    const html = compileBlank();
    const out = args.out ? resolve(args.out) : resolve("render.html");
    writeFileSync(out, html);
    process.stderr.write(`compiled blank renderer -> ${out} (${html.length} bytes)\n`);
    return;
  }
  const specText = readFileSync(resolve(args.spec), "utf8");
  const dataText = args.data ? readFileSync(resolve(args.data), "utf8") : null;
  const { html, env } = compile({ specText, dataText });
  const out = args.out ? resolve(args.out) : resolve((env.meta.name || "out") + ".html");
  writeFileSync(out, html);
  process.stderr.write(`compiled ${env.kind} '${env.meta.name}' -> ${out} (${html.length} bytes)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
