/* Phase 2 — eval-dashboard render parity (ported from the original eval-dashboard
 * render-smoke). Boots the spec-renderer-COMPILED eval-dashboard.html under a DOM
 * shim and drives each of the four view tabs, asserting the same content tokens the
 * original pinned: overview passed/score + hard-gate, diff before/regressions,
 * transcript observed + final answer (the plan-act-observe payoff), cross all three
 * domains + the hand-rolled <svg> metric bars. Proves the re-expression renders
 * identically. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "eval-dashboard.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const embeddedSpec = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1].trim();
const embeddedData = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/)[1].trim();

class El {
  constructor(tag) {
    this.tag = tag; this.className = ""; this._html = ""; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.onclick = null; this.value = "";
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
const registry = {};
for (const id of ["#tabs", "#pickers", "#themeBtn", "#view", "#subtitle", "#loader", "#bar", "#foot",
  "#drop", "#file", "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
registry["#embedded-spec"].textContent = embeddedSpec;
registry["#embedded-data"].textContent = embeddedData;

const store = new Map();
const ctx = {
  document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
  location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
};
vm.runInNewContext(code, ctx); // boot() runs (document present) -> mountView renders overview

function serialize(node) {
  if (!node) return "";
  let s = (node._html || "") + (node.textContent || "");
  for (const c of node.children || []) s += serialize(c);
  return s;
}
function clickTab(label) {
  const tab = registry["#tabs"].children.find((t) => (t._html || "") === label);
  assert.ok(tab && tab.onclick, 'tab "' + label + '" not rendered');
  tab.onclick();
  return serialize(registry["#view"]);
}

test("boot renders the overview by default; exactly four tabs", () => {
  const view = serialize(registry["#view"]);
  assert.match(view, /passed/);
  assert.match(view, /score/);
  assert.equal(registry["#tabs"].children.length, 4);
});

test("Overview tab renders the hard-gate banner", () => {
  assert.match(clickTab("Overview"), /hard.?gate/i);
});

test("Regression diff tab renders before + regressions", () => {
  const view = clickTab("Regression diff");
  assert.match(view, /before/);
  assert.match(view, /regressions/);
});

test("Transcript tab renders observed output + final answer (plan-act-observe)", () => {
  const view = clickTab("Transcript");
  assert.match(view, /observed/);
  assert.match(view, /final answer/i);
});

test("Cross-domain tab renders all three domains + hand-rolled SVG bars", () => {
  const view = clickTab("Cross-domain");
  assert.match(view, /generic/);
  assert.match(view, /industrial/);
  assert.match(view, /trust_safety/);
  assert.match(view, /<svg/);
});

test("subtitle + footer come from the spec", () => {
  assert.match(serialize(registry["#subtitle"]), /agentic-eval-harness/);
  assert.match(serialize(registry["#foot"]), /agentic-eval-harness/);
});
