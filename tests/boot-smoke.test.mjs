/* Phase 0 — boot integration smoke.
 * Compiles a spec, extracts the single attribute-less <script> (the same way
 * the Phase 2 vm/render harness will), boots it under a minimal DOM shim, and
 * asserts boot() dispatched by kind and rendered into #view. Proves the full
 * path: extraction regex -> vm -> boot -> parseEnvelope -> mount. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile } from "../scripts/compile-spec.mjs";

class El {
  constructor(tag) {
    this.tag = tag; this.className = ""; this._html = ""; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.onclick = null;
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  remove() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function serialize(node) {
  if (!node) return "";
  let s = (node._html || "") + (node.textContent || "");
  for (const c of node.children || []) s += serialize(c);
  return s;
}

function boot(html) {
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const embedded = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1].trim();
  const registry = {};
  for (const id of ["#embedded-spec", "#embedded-data", "#themeBtn", "#view", "#subtitle",
    "#tabs", "#pickers", "#foot", "#bar", "#loader", "#drop", "#file", "#paste", "#pasteBtn"]) {
    registry[id] = new El("div");
  }
  // raw embedded text (with compile-spec's <\/ escape intact); boot()'s JSON.parse
  // restores </ just as a real browser does — mirrors the Phase 2 render harness.
  registry["#embedded-spec"].textContent = embedded;
  const dataM = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/);
  if (dataM) registry["#embedded-data"].textContent = dataM[1].trim();
  const store = new Map();
  const ctx = {
    document: {
      createElement: (t) => new El(t),
      querySelector: (s) => registry[s] || new El("div"),
      documentElement: { dataset: {} },
      body: { appendChild() {} },
    },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    location: { search: "", href: "file:///x" },
    URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(code, ctx);
  return serialize(registry["#view"]);
}

test("boot: view spec dispatches to the view renderer", () => {
  const spec = "kind: view\nname: v\ntitle: V\nviews:\n  - key: cross\n    label: Cross\n    widgets:\n      - widget: cross-grid";
  const data = JSON.stringify({ domains: { generic: { runs: { "20260617-120000-generic-replay": { run_id: "20260617-120000-generic-replay", backend: "replay", model: "m", cases: [{ case_id: "x", score: 1, passed: true, hard_gate: false }] } }, transcripts: {} } } });
  const { html } = compile({ specText: spec, dataText: data });
  assert.match(boot(html), /generic/); // cross-grid rendered the domain
});

test("boot: form spec dispatches to the form renderer", () => {
  const spec = 'type: object\nx-forge-name: cfg\ntitle: Cfg\nproperties:\n  A:\n    type: string\n    status: fill';
  const { html } = compile({ specText: spec, dataText: null });
  const view = boot(html);
  assert.match(view, /class="key">A</);   // the field key rendered
  assert.match(view, /b-fill/);            // its status badge — unambiguously a form
});
