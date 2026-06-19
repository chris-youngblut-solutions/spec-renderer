/* Phase 2 — trend widget + scoreTrend adapter.
 * Mirrors the view-data / eval-scoring shims: vm-boots engine.js to exercise the
 * pure adapter (chronological order, score/passed/n), and compiles+boots a small
 * inline VIEW spec under a DOM shim to assert the trend widget renders an <svg>
 * with a <polyline>. Zero-run and single-run inputs must render without crashing. */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compile } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---- pure adapter: scoreTrend(dataset, domain) ---- */
const aCtx = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(join(ROOT, "engine.js"), "utf8"), aCtx);
const E = aCtx.module.exports;
const A = E.ADAPTERS["eval-scoring"];
const plain = (x) => JSON.parse(JSON.stringify(x));

const card = (run_id, cases) => ({ run_id, backend: "replay", model: "m", cases });
// run_ids sort lexicographically; viewRunsFor sorts+reverses (newest-first), so the
// adapter must hand them back oldest-first regardless of insertion order.
const bundle = {
  generated: "20260619120000", harness_commit: "deadbeef",
  domains: {
    generic: {
      runs: {
        "20260619-120000-generic-replay": card("20260619-120000-generic-replay", [{ case_id: "a", score: 1, passed: true }, { case_id: "b", score: 0.5, passed: false }]),
        "20260617-120000-generic-replay": card("20260617-120000-generic-replay", [{ case_id: "a", score: 0, passed: false }, { case_id: "b", score: 1, passed: true }]),
        "20260618-120000-generic-replay": card("20260618-120000-generic-replay", [{ case_id: "a", score: 0.5, passed: false }]),
      },
      transcripts: {},
    },
    empty: { runs: {}, transcripts: {} },
  },
};

test("scoreTrend returns the series in chronological (oldest-first) order", () => {
  const ds = E.mergeBundle(E.emptyDataset(), bundle);
  const series = plain(A.scoreTrend(ds, "generic"));
  assert.deepStrictEqual(series.map((p) => p.run_id), [
    "20260617-120000-generic-replay",
    "20260618-120000-generic-replay",
    "20260619-120000-generic-replay",
  ]);
});

test("scoreTrend each point carries score (total), passed, n", () => {
  const ds = E.mergeBundle(E.emptyDataset(), bundle);
  const series = plain(A.scoreTrend(ds, "generic"));
  assert.deepStrictEqual(series[0], { run_id: "20260617-120000-generic-replay", score: 1, passed: 1, n: 2 }); // 0+1, b passed
  assert.deepStrictEqual(series[1], { run_id: "20260618-120000-generic-replay", score: 0.5, passed: 0, n: 1 });
  assert.deepStrictEqual(series[2], { run_id: "20260619-120000-generic-replay", score: 1.5, passed: 1, n: 2 }); // 1+0.5, a passed
});

test("scoreTrend on a domain with zero runs returns []", () => {
  const ds = E.mergeBundle(E.emptyDataset(), bundle);
  assert.deepStrictEqual(plain(A.scoreTrend(ds, "empty")), []);
});

test("scoreTrend on an unknown domain returns [] (no throw)", () => {
  const ds = E.mergeBundle(E.emptyDataset(), bundle);
  assert.deepStrictEqual(plain(A.scoreTrend(ds, "nope")), []);
});

test("scoreTrend single-run domain returns one point", () => {
  const single = { domains: { solo: { runs: { "20260619-120000-solo-replay": card("20260619-120000-solo-replay", [{ case_id: "a", score: 0.8, passed: true }]) }, transcripts: {} } } };
  const ds = E.mergeBundle(E.emptyDataset(), single);
  const series = plain(A.scoreTrend(ds, "solo"));
  assert.equal(series.length, 1);
  assert.deepStrictEqual(series[0], { run_id: "20260619-120000-solo-replay", score: 0.8, passed: 1, n: 1 });
});

/* ---- widget render: boot a compiled trend-view spec under a DOM shim ---- */
const SPEC = `
kind: view
name: trend-demo
adapters: [eval-scoring]
views:
  - key: trend
    label: "Trend"
    select: {domain: true, run: false, case: false}
    widgets:
      - {widget: heading, value: "$domain"}
      - {widget: trend, source: "eval-scoring.scoreTrend(dataset, domain)"}
`;

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
function serialize(node) {
  if (!node) return "";
  let s = (node._html || "") + (node.textContent || "");
  for (const c of node.children || []) s += serialize(c);
  return s;
}

function bootView(dataObj) {
  const { html } = compile({ specText: SPEC, dataText: dataObj == null ? null : JSON.stringify(dataObj) });
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const embeddedSpec = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1].trim();
  const embeddedData = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/);
  const registry = {};
  for (const id of ["#tabs", "#pickers", "#themeBtn", "#view", "#subtitle", "#loader", "#bar", "#foot",
    "#drop", "#file", "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  registry["#embedded-spec"].textContent = embeddedSpec;
  registry["#embedded-data"].textContent = embeddedData ? embeddedData[1].trim() : "";
  const store = new Map();
  const ctx = {
    document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(code, ctx); // boot() -> mountView renders the trend view
  return serialize(registry["#view"]);
}

test("trend widget renders an <svg> with a <polyline> for a multi-run domain", () => {
  const view = bootView(bundle);
  assert.match(view, /<svg/);
  assert.match(view, /<polyline/);
});

test("trend widget on a single-run domain renders without crashing (svg, no polyline needed)", () => {
  const single = { domains: { generic: { runs: { "20260619-120000-generic-replay": card("20260619-120000-generic-replay", [{ case_id: "a", score: 0.8, passed: true }]) }, transcripts: {} } } };
  const view = bootView(single);
  assert.match(view, /<svg/);          // a single point still draws axes + a marker dot
  assert.match(view, /run\b/);         // "1 run" footer
});

test("trend widget with zero runs renders without crashing", () => {
  const view = bootView({ domains: { generic: { runs: {}, transcripts: {} } } });
  assert.equal(typeof view, "string");
});
