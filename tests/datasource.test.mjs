/* dataSource — the opt-in live-data feature for views.
 *
 * The whole identity of the tool is a single self-contained offline file; the
 * dataSource is the ONE deliberate, opt-in relaxation of that. So these tests pin,
 * exhaustively:
 *   - normalizeDataSource: the declarative {url,mode,intervalMs,auth} shape, its
 *     defaults/clamps, and that NO credential/token key is ever read;
 *   - parseEnvelope attaches dataSource (canonical x-forge-datasource + alias);
 *   - the compile-time CSP: script-hash (closes footer-XSS), and the three-tier
 *     connect-src lock (blank open / inert 'none' / dataSource origin);
 *   - runtime behavior under a DOM shim with a MOCKED fetch/EventSource:
 *       absent dataSource => fetch NEVER called (offline default intact);
 *       present => fetch -> isBundle -> mergeBundle -> re-render;
 *       auth:session => credentials:'include' (sse => withCredentials);
 *       junk payload => rejected, view unchanged;
 *       inside an MCP host => no fetch (host pushes data instead).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compile, compileBlank, connectSrcFor, cspMeta, engineScriptHash, loadEngineApi } from "../scripts/compile-spec.mjs";
import { lint } from "../scripts/validate-spec.mjs";

const api = loadEngineApi();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const plain = (x) => JSON.parse(JSON.stringify(x)); // vm-realm objects fail deepStrictEqual; normalize first

/* ---------------- normalizeDataSource (pure) ---------------- */

test("normalizeDataSource: defaults for a bare absolute url", () => {
  assert.deepEqual(plain(api.normalizeDataSource({ url: "https://dash.internal/data" })),
    { url: "https://dash.internal/data", mode: "poll", intervalMs: 15000, auth: "none" });
});

test("normalizeDataSource: accepts a root-relative same-origin path", () => {
  assert.equal(api.normalizeDataSource({ url: "/data" }).url, "/data");
});

test("normalizeDataSource: mode sse honored, anything else -> poll", () => {
  assert.equal(api.normalizeDataSource({ url: "/d", mode: "sse" }).mode, "sse");
  assert.equal(api.normalizeDataSource({ url: "/d", mode: "websocket" }).mode, "poll");
});

test("normalizeDataSource: intervalMs clamps to 1s..1h, bad -> 15s", () => {
  assert.equal(api.normalizeDataSource({ url: "/d", intervalMs: 200 }).intervalMs, 1000);
  assert.equal(api.normalizeDataSource({ url: "/d", intervalMs: 9e9 }).intervalMs, 3600000);
  assert.equal(api.normalizeDataSource({ url: "/d", intervalMs: "nope" }).intervalMs, 15000);
  assert.equal(api.normalizeDataSource({ url: "/d", intervalMs: -5 }).intervalMs, 15000);
});

test("normalizeDataSource: auth is session or none only", () => {
  assert.equal(api.normalizeDataSource({ url: "/d", auth: "session" }).auth, "session");
  assert.equal(api.normalizeDataSource({ url: "/d", auth: "none" }).auth, "none");
  assert.equal(api.normalizeDataSource({ url: "/d", auth: "bearer" }).auth, "none");
});

test("normalizeDataSource: NEVER reads a credential/token/header key (declarative-only)", () => {
  const r = api.normalizeDataSource({ url: "/d", token: "DROPME", apiKey: "k", headers: { auth: "x" }, auth: "session" });
  assert.deepEqual(Object.keys(r).sort(), ["auth", "intervalMs", "mode", "url"]);
  assert.equal("token" in r, false);
  assert.equal("headers" in r, false);
});

test("normalizeDataSource: rejects junk / non-lockable urls -> null (stays offline)", () => {
  assert.equal(api.normalizeDataSource(null), null);
  assert.equal(api.normalizeDataSource([{ url: "/d" }]), null);
  assert.equal(api.normalizeDataSource({}), null);
  assert.equal(api.normalizeDataSource({ url: "" }), null);
  assert.equal(api.normalizeDataSource({ url: "ftp://x/y" }), null);
  assert.equal(api.normalizeDataSource({ url: "javascript:alert(1)" }), null);
  assert.equal(api.normalizeDataSource({ url: "relative/path" }), null); // not root-relative
});

/* ---------------- parseEnvelope attaches dataSource ---------------- */

test("parseEnvelope: x-forge-datasource is the canonical key + infers view kind", () => {
  const env = api.parseEnvelope({ "x-forge-name": "d", "x-forge-datasource": { url: "https://h/d" } });
  assert.equal(env.kind, "view");
  assert.equal(env.dataSource.url, "https://h/d");
});

test("parseEnvelope: bare dataSource is accepted as an alias", () => {
  const env = api.parseEnvelope({ kind: "view", name: "d", widgets: [], dataSource: { url: "/d" } });
  assert.equal(env.dataSource.url, "/d");
});

test("parseEnvelope: absent dataSource -> null (default offline)", () => {
  const env = api.parseEnvelope({ kind: "view", name: "d", widgets: [] });
  assert.equal(env.dataSource, null);
});

/* ---------------- compile-time CSP ---------------- */

test("cspMeta: script-src is hash-pinned with NO 'unsafe-inline'; style-src keeps inline", () => {
  const m = cspMeta("sha256-AAA", "'none'");
  assert.match(m, /script-src 'sha256-AAA'/);
  assert.doesNotMatch(m, /script-src[^;]*'unsafe-inline'/);
  assert.match(m, /style-src 'unsafe-inline'/);
  assert.match(m, /object-src 'none'/);
  assert.match(m, /base-uri 'none'/);
  assert.match(m, /connect-src 'none'/);
});

test("cspMeta: connect=null omits connect-src entirely", () => {
  assert.doesNotMatch(cspMeta("sha256-AAA", null), /connect-src/);
});

test("connectSrcFor: absolute -> origin, root-relative -> 'self', else null", () => {
  assert.equal(connectSrcFor("https://dash.internal:8443/data?x=1"), "https://dash.internal:8443");
  assert.equal(connectSrcFor("http://h/d"), "http://h");
  assert.equal(connectSrcFor("https://dash.internal"), "https://dash.internal"); // no path
  assert.equal(connectSrcFor("/data"), "'self'");
  assert.equal(connectSrcFor("relative"), null);
  assert.equal(connectSrcFor(42), null);
});

test("connectSrcFor: rejects a url whose origin carries CSP-attribute-breaking chars", () => {
  // a crafted url must NOT smuggle ", ;, space, <, >, @ into the connect-src value
  assert.equal(connectSrcFor('https://evil.com"></head><script>x</script>'), null);
  assert.equal(connectSrcFor("https://evil.com;default-src *"), null);
  assert.equal(connectSrcFor("https://evil.com data:"), null);
  assert.equal(connectSrcFor("https://user@evil.com/"), null);
  assert.equal(connectSrcFor("https://evil.com\\@good.com"), null);
});

test("normalizeDataSource: rejects an absolute url with a dirty origin (stays offline)", () => {
  assert.equal(api.normalizeDataSource({ url: 'https://evil.com"x/data' }), null);
  assert.equal(api.normalizeDataSource({ url: "https://evil.com;x" }), null);
});

test("compile: a dirty-ORIGIN dataSource url falls back to connect-src 'none'", () => {
  const { html } = compile({ specText: 'kind: "view"\nx-forge-name: "d"\nwidgets: []\nx-forge-datasource: {url: "https://evil.com\\"x/data"}\n' });
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  assert.match(meta, /connect-src 'none'/);
  assert.doesNotMatch(meta, /evil\.com/);
});

test("compile: a crafted dataSource url PATH cannot inject CSP directives (origin only)", () => {
  const { html } = compile({ specText: 'kind: "view"\nx-forge-name: "d"\nwidgets: []\nx-forge-datasource: {url: "https://evil.com/x\\";script-src *//"}\n' });
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  assert.match(meta, /connect-src https:\/\/evil\.com($|; )/);    // ONLY the clean origin survives; path stripped
  assert.doesNotMatch(meta, /script-src \*/);                      // the path payload never became a directive
  assert.equal((meta.match(/script-src/g) || []).length, 1);       // exactly one script-src (the engine hash)
});

test("compile: a dataSource view locks connect-src to the endpoint origin", () => {
  const { html } = compile({ specText: 'kind: "view"\nx-forge-name: "d"\nwidgets: []\nx-forge-datasource: {url: "https://dash.internal/data", auth: "session"}\n' });
  assert.match(html, /connect-src https:\/\/dash\.internal\b/);
  assert.doesNotMatch(html, /connect-src 'none'/);
});

test("compile: a non-dataSource view is inert (connect-src 'none')", () => {
  const { html } = compile({ specText: 'kind: "view"\nx-forge-name: "d"\nwidgets: []\n' });
  assert.match(html, /connect-src 'none'/);
});

test("compileBlank: networked loader leaves connect-src open but still hash-locks scripts", () => {
  const blank = compileBlank();
  const meta = blank.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  assert.doesNotMatch(meta, /connect-src/); // scope to the CSP meta — the engine source comments mention connect-src
  assert.match(meta, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
});

test("engineScriptHash matches the inlined engine <script> body in a compiled file", () => {
  const { html } = compile({ specText: 'kind: "view"\nx-forge-name: "d"\nwidgets: []\n' });
  const declared = html.match(/script-src '(sha256-[^']+)'/)[1];
  assert.equal(engineScriptHash(html), declared);
});

/* ---------------- runtime: DOM shim + mocked fetch / EventSource ---------------- */

const BUNDLE = {
  generated: "20260619123000", harness_commit: "live01",
  domains: {
    generic: {
      runs: { "20260619-123000-generic-replay": { run_id: "20260619-123000-generic-replay", backend: "replay", model: "m", cases: [{ case_id: "x", score: 1, passed: true }] } },
      transcripts: {},
    },
  },
};

class El {
  constructor(tag) {
    this.tag = tag; this.className = ""; this._html = ""; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.onclick = null;
    this.value = ""; this.type = ""; this.checked = false; this._listeners = {};
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this._listeners[ev] || (this._listeners[ev] = [])).push(fn); }
  dispatch(ev) { for (const fn of this._listeners[ev] || []) fn(); }
  remove() {}
  querySelector() { return new El("div"); }
  querySelectorAll() { return []; }
}

const settle = () => new Promise((r) => setTimeout(r, 0)); // flush the fetch().then() microtasks

/* compile `specYaml` (+ optional data), boot it under a fresh shim with mocked
 * network primitives, and hand back the registry + capture arrays. `fetchResult`
 * is the object the mock `fetch` resolves to (or "throw" to fail the test if
 * fetch is called at all). `asHost` simulates an MCP host (window.parent !== window). */
function boot(specYaml, { dataText = null, fetchResult, asHost = false, sse = false } = {}) {
  const { html } = compile({ specText: specYaml, dataText });
  const registry = {};
  for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
    "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#drop", "#file",
    "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  const sm = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/);
  const dm = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/);
  if (sm) registry["#embedded-spec"].textContent = sm[1];
  if (dm) registry["#embedded-data"].textContent = dm[1];

  const fetchCalls = [], intervalCalls = [], sources = [];
  const lsStore = new Map();
  const ctx = {
    document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
    localStorage: { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, v), removeItem: (k) => lsStore.delete(k) },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
    setInterval: (fn, ms) => { intervalCalls.push([fn, ms]); return 7; }, clearInterval() {},
    fetch: (url, opts) => {
      fetchCalls.push([url, opts]);
      if (fetchResult === "throw") throw new Error("fetch must not be called");
      return Promise.resolve({ ok: true, json: () => Promise.resolve(fetchResult) });
    },
  };
  if (sse) {
    ctx.EventSource = class { constructor(url, opts) { this.url = url; this.opts = opts; this.onmessage = null; sources.push(this); } close() {} };
  }
  if (asHost) ctx.window = { parent: { postMessage() {} }, addEventListener() {} };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return { registry, fetchCalls, intervalCalls, sources };
}

const DS_VIEW = (extra) => `kind: "view"
x-forge-name: "live"
title: "Live"
adapters: ["eval-scoring"]
views:
  - key: "overview"
    label: "Overview"
    select: {domain: true, run: "after", case: false}
    widgets: [{widget: "stat", label: "domains", value: "literal"}]
x-forge-datasource: {url: "https://dash.internal/data"${extra || ""}}
`;

const STATIC_VIEW = `kind: "view"
x-forge-name: "static"
title: "Static"
adapters: ["eval-scoring"]
views:
  - key: "overview"
    label: "Overview"
    select: {domain: true, run: "after", case: false}
    widgets: [{widget: "stat", label: "domains", value: "literal"}]
`;

test("offline default: a view with NO dataSource never touches fetch", async () => {
  const { fetchCalls } = boot(STATIC_VIEW, { dataText: JSON.stringify(BUNDLE), fetchResult: "throw" });
  await settle();
  assert.equal(fetchCalls.length, 0);
});

test("poll: fetch -> isBundle -> mergeBundle -> re-render", async () => {
  const { registry, fetchCalls, intervalCalls } = boot(DS_VIEW(), { fetchResult: BUNDLE });
  assert.equal(fetchCalls.length, 1, "fetched once immediately");
  assert.equal(fetchCalls[0][0], "https://dash.internal/data");
  await settle();
  assert.match(registry["#foot"]._html, /data 20260619123000/); // footer shows the merged dataset
  assert.equal(registry["#loader"].style.display, "none");       // loader hidden once data merged
  assert.equal(intervalCalls.length, 1, "an interval was scheduled for the next poll");
  assert.equal(intervalCalls[0][1], 15000);
});

test("auth:session attaches credentials:'include'; auth:none does not", async () => {
  const s = boot(DS_VIEW(`, auth: "session"`), { fetchResult: BUNDLE });
  assert.equal(s.fetchCalls[0][1].credentials, "include"); // vm-realm object: read the prop, don't deepEqual
  const n = boot(DS_VIEW(`, auth: "none"`), { fetchResult: BUNDLE });
  assert.equal(n.fetchCalls[0][1], undefined);
});

test("junk payload is rejected by isBundle — view stays empty", async () => {
  const { registry, fetchCalls } = boot(DS_VIEW(), { fetchResult: { not: "a bundle" } });
  assert.equal(fetchCalls.length, 1);
  await settle();
  assert.doesNotMatch(registry["#foot"]._html, /data \d/);
});

test("inside an MCP host, dataSource does NOT fetch (host pushes data via mcpOnToolResult)", async () => {
  const { fetchCalls } = boot(DS_VIEW(), { fetchResult: BUNDLE, asHost: true });
  await settle();
  assert.equal(fetchCalls.length, 0);
});

test("sse mode: EventSource opened; an event with a bundle merges + re-renders", async () => {
  const { registry, sources, fetchCalls } = boot(DS_VIEW(`, mode: "sse", auth: "session"`), { fetchResult: BUNDLE, sse: true });
  assert.equal(fetchCalls.length, 0, "sse does not poll-fetch");
  assert.equal(sources.length, 1, "an EventSource was opened");
  assert.equal(sources[0].url, "https://dash.internal/data");
  assert.equal(sources[0].opts.withCredentials, true); // vm-realm object: read the prop
  sources[0].onmessage({ data: JSON.stringify(BUNDLE) });
  await settle();
  assert.match(registry["#foot"]._html, /data 20260619123000/);
});

test("sse with no EventSource available falls back to poll", async () => {
  const { fetchCalls } = boot(DS_VIEW(`, mode: "sse"`), { fetchResult: BUNDLE, sse: false });
  assert.equal(fetchCalls.length, 1, "fell back to a poll fetch");
});

/* ---------------- the shipped example-live spec + linter ---------------- */

const liveSpec = readFileSync(join(ROOT, "specs/example-live.view.yaml"), "utf8");

test("example-live.view.yaml compiles to a same-origin 'self' connect-src lock", () => {
  const { html, env } = compile({ specText: liveSpec });
  assert.equal(env.dataSource.url, "/api/eval-data");
  assert.match(html, /connect-src 'self'/);
  assert.doesNotMatch(html, /connect-src 'none'/);
});

test("example-live.view.yaml lints clean (0 errors, 0 warnings)", () => {
  const r = lint(api, liveSpec);
  assert.equal(r.errors.length, 0, r.errors.join("; "));
  assert.equal(r.warnings.length, 0, r.warnings.join("; "));
});

test("linter warns (loudly) when a credential key appears on x-forge-datasource", () => {
  const bad = `kind: view\nx-forge-name: x\nwidgets: []\nx-forge-datasource: {url: "/d", token: "sk-xxx"}\n`;
  const r = lint(api, bad);
  assert.ok(r.warnings.some((w) => /token.*IGNORED/i.test(w)), r.warnings.join("; "));
});

test("linter warns on a malformed datasource url", () => {
  const bad = `kind: view\nx-forge-name: x\nwidgets: []\nx-forge-datasource: {url: "ftp://nope"}\n`;
  const r = lint(api, bad);
  assert.ok(r.warnings.some((w) => /url must be/.test(w)), r.warnings.join("; "));
});
