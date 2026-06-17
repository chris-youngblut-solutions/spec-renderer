/* Phase 3 — engine UI-side MCP Apps bridge (SEP-1865).
 * Boots a compiled view inside a mocked MCP host (window.parent !== window) and
 * verifies: the ui/initialize handshake is sent, the host theme is applied and
 * ui/notifications/initialized is sent on the init result, and a host-pushed
 * ui/notifications/tool-result bundle is merged and re-rendered. Also verifies
 * the standalone path (no host) sends nothing. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile } from "../scripts/compile-spec.mjs";

const SPEC = "kind: view\nname: v\ntitle: V\nadapters: [eval-scoring]\nviews:\n"
  + "  - key: overview\n    label: Overview\n    select: {domain: true, run: after}\n    widgets:\n      - {widget: heading, value: \"$domain\"}\n"
  + "  - key: cross\n    label: Cross-domain\n    widgets:\n      - {widget: cross-grid}";
const DATA = JSON.stringify({ domains: { generic: { runs: { "20260617-120000-generic-replay": { run_id: "20260617-120000-generic-replay", backend: "replay", model: "m", cases: [{ case_id: "x", score: 1, passed: true, hard_gate: false }] } }, transcripts: {} } } });
const { html } = compile({ specText: SPEC, dataText: DATA });
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const embeddedSpec = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1].trim();
const embeddedData = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/)[1].trim();

class El {
  constructor(tag) { this.tag = tag; this.className = ""; this._html = ""; this.textContent = ""; this.style = {}; this.dataset = {}; this.children = []; this.onclick = null; this.value = ""; this.classList = { add() {}, remove() {}, contains: () => false }; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {} remove() {} querySelector() { return null; } querySelectorAll() { return []; }
}
function serialize(n) { if (!n) return ""; let s = (n._html || "") + (n.textContent || ""); for (const c of n.children || []) s += serialize(c); return s; }

function setup(hosted) {
  const registry = {};
  for (const id of ["#tabs", "#pickers", "#themeBtn", "#view", "#subtitle", "#loader", "#bar", "#foot", "#drop", "#file", "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  registry["#embedded-spec"].textContent = embeddedSpec;
  registry["#embedded-data"].textContent = embeddedData;
  const documentMock = { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } };
  const store = new Map();
  const sent = [];
  let msgHandler = null;
  const self = {};
  const windowMock = {
    parent: hosted ? { postMessage: (m) => sent.push(m) } : self,
    addEventListener: (type, fn) => { if (type === "message") msgHandler = fn; },
    postMessage() {},
  };
  if (!hosted) windowMock.parent = windowMock; // top-level: parent === window
  const ctx = {
    document: documentMock, window: windowMock,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(code, ctx);
  return { registry, documentMock, sent, dispatch: (m) => msgHandler && msgHandler({ data: m }), clickTab: (label) => { const t = registry["#tabs"].children.find((x) => (x._html || "") === label); t.onclick(); return serialize(registry["#view"]); } };
}

test("hosted: ui/initialize is sent on boot", () => {
  const { sent } = setup(true);
  assert.equal(sent[0].method, "ui/initialize");
  assert.ok(sent[0].id, "request carries an id");
});

test("hosted: init result applies theme + sends ui/notifications/initialized", async () => {
  const h = setup(true);
  h.dispatch({ id: h.sent[0].id, result: { hostContext: { theme: "night" } } });
  await new Promise((r) => setTimeout(r, 0)); // flush the request promise's .then
  assert.equal(h.documentMock.documentElement.dataset.cabin, "night");
  assert.ok(h.sent.some((m) => m.method === "ui/notifications/initialized"));
});

test("hosted: host-pushed tool-result bundle is merged + re-rendered", () => {
  const h = setup(true);
  h.dispatch({ method: "ui/notifications/tool-result", params: { structuredContent: { domains: { extra: { runs: { "20260101-000000-extra-replay": { run_id: "20260101-000000-extra-replay", backend: "replay", model: "m", cases: [{ case_id: "e", score: 1, passed: true, hard_gate: false }] } }, transcripts: {} } } } } });
  assert.match(h.clickTab("Cross-domain"), /extra/); // the pushed domain now renders
});

test("hosted: host-context-changed updates the theme", () => {
  const h = setup(true);
  h.dispatch({ method: "ui/notifications/host-context-changed", params: { theme: "day" } });
  assert.equal(h.documentMock.documentElement.dataset.cabin, "day");
});

test("standalone (no host): nothing is posted", () => {
  const { sent } = setup(false);
  assert.equal(sent.length, 0);
});
