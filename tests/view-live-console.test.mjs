/* view-live-console — the reusable LIVE-CONSOLE view template.
 *
 * Compiles specs/live-console.view.yaml (with a baked data bundle) and boots it
 * under the same DOM shim the other view tests use, then asserts the three
 * audience surfaces render from the FIXED widget catalog + the eval-scoring
 * adapter ONLY:
 *   - Scorecard (exec): pass count + score stat-cards, hard-gate banner,
 *     per-metric rollup, score-over-runs trend (<svg>).
 *   - Drilldown (operator): the interactive case-table (filter input + sortable
 *     headers) and the before/after regression diff.
 *   - Transcript: the plan-act-observe loop (observed output + final answer).
 *   - Fleet: latest run per domain (cross-grid) across every domain.
 *
 * Plus the LIVE contract (compile-time, no network): the spec normalizes to a
 * same-origin datasource, the compiled CSP locks connect-src to 'self' and
 * hash-pins script-src, and the template uses no widget outside the catalog and
 * no adapter outside eval-scoring (the no-logic-in-spec invariant). Keyless +
 * offline: a baked fixture, never a real fetch. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = readFileSync(join(ROOT, "specs/live-console.view.yaml"), "utf8");

/* A small, self-contained bundle: two runs in one domain (so trend + diff have
 * something to chew on) + one transcript. Same {domains:{...}} shape the harness
 * emits and a live endpoint would return — no network, baked at compile time. */
const DATA = JSON.stringify({
  generated: "20260619000000",
  harness_commit: "deadbeefcafe",
  domains: {
    industrial: {
      runs: {
        "20260619-090000-industrial-replay": {
          run_id: "20260619-090000-industrial-replay", backend: "replay", model: "claude-opus-4-8",
          cases: [
            { case_id: "decode-eec1", score: 1, passed: true, stop_reason: "answered", turns: 2, tools_called: ["decode_frame"], metric: "signal_decode_accuracy", hard_gate: false },
            { case_id: "safety-estop", score: 0, passed: false, stop_reason: "answered", turns: 4, tools_called: ["decode_frame"], metric: "safety_gate", hard_gate: true },
          ],
        },
        "20260619-100000-industrial-live": {
          run_id: "20260619-100000-industrial-live", backend: "live", model: "claude-opus-4-8",
          cases: [
            { case_id: "decode-eec1", score: 1, passed: true, stop_reason: "answered", turns: 2, tools_called: ["decode_frame"], metric: "signal_decode_accuracy", hard_gate: false },
            { case_id: "safety-estop", score: 1, passed: true, stop_reason: "answered", turns: 3, tools_called: ["decode_frame"], metric: "safety_gate", hard_gate: true },
          ],
        },
      },
      transcripts: {
        "safety-estop": [
          { role: "user", content: "Is the e-stop frame asserting a fault?" },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "decode_frame", input: { frame: "0xFF00" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: "fault=false" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "submit_answer", input: { answer: "no fault" } }] },
        ],
      },
    },
    trust_safety: {
      runs: {
        "20260619-100000-trust_safety-live": {
          run_id: "20260619-100000-trust_safety-live", backend: "live", model: "claude-opus-4-8",
          cases: [
            { case_id: "policy-escalate", score: 1, passed: true, stop_reason: "answered", turns: 2, tools_called: [], metric: "policy_routing", hard_gate: false },
          ],
        },
      },
      transcripts: {},
    },
  },
});

const { html, env } = compile({ specText: SPEC, dataText: DATA });

/* ---------- DOM shim (querySelectorAll walks the subtree) ---------- */
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
  querySelectorAll(sel) {
    const out = [];
    const want = /\[data-case\]/.test(sel);
    const walk = (n) => { if (!n) return; if (want && n.dataset && n.dataset.case != null) out.push(n); for (const c of n.children || []) walk(c); };
    for (const c of this.children) walk(c);
    return out;
  }
}
function walk(node, fn) { if (!node) return; fn(node); for (const c of node.children || []) walk(c, fn); }
function serialize(node) {
  if (!node) return "";
  let s = (node._html || "") + (node.textContent || "");
  for (const c of node.children || []) s += serialize(c);
  return s;
}

const registry = {};
for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
  "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#drop", "#file",
  "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
registry["#embedded-spec"].textContent = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1];
registry["#embedded-data"].textContent = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/)[1];

const lsStore = new Map();
const ctx = {
  document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
  localStorage: { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, v), removeItem: (k) => lsStore.delete(k) },
  location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  // NOTE: no `fetch`, no `setInterval`, no `EventSource` in this context — the
  // live poller is a guarded no-op, so the test exercises the rendered surface
  // with the BAKED fixture and never touches the network.
};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx); // boot() -> mountView

function clickTab(label) {
  const tab = registry["#tabs"].children.find((t) => (t._html || "") === label);
  assert.ok(tab && tab.onclick, 'tab "' + label + '" not rendered');
  tab.onclick();
  return serialize(registry["#view"]);
}

/* ---------- the compiled artifact: shape + live/CSP contract ---------- */

test("compiles to a view named live-console with the four audience tabs", () => {
  assert.equal(env.kind, "view");
  assert.equal(env.meta.name, "live-console");
  assert.equal(registry["#tabs"].children.length, 4); // scorecard, drilldown, transcript, fleet
  const labels = registry["#tabs"].children.map((t) => t._html);
  assert.deepEqual(labels, ["Scorecard", "Drilldown", "Transcript", "Fleet"]);
});

test("declares a same-origin live datasource and the compiled CSP locks it down", () => {
  // declarative datasource normalized to the four recognized keys only
  assert.ok(env.dataSource, "datasource normalized");
  assert.equal(env.dataSource.url, "/api/eval-data");
  assert.equal(env.dataSource.mode, "poll");
  assert.equal(env.dataSource.auth, "session");
  // a root-relative same-origin path -> connect-src 'self'; script-src hash-pinned
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  // the spec carries NO credential key (the artifact is public)
  const spec = env.spec;
  for (const k of Object.keys(spec["x-forge-datasource"])) {
    assert.ok(["url", "mode", "intervalMs", "auth"].includes(k), "unexpected datasource key: " + k);
  }
});

test("template stays inside the fixed catalog: known widgets + only the eval-scoring adapter", () => {
  const KNOWN = new Set(["heading", "caption", "chips", "stat-cards", "hard-gate-banner",
    "metric-rollup", "case-table", "regression-diff", "transcript", "cross-grid", "trend"]);
  assert.deepEqual(Array.from(env.spec.adapters), ["eval-scoring"]);
  for (const v of env.spec.views) {
    for (const w of v.widgets) assert.ok(KNOWN.has(w.widget), "widget outside catalog: " + w.widget);
  }
  // no-logic-in-spec: every adapter binding names ONLY eval-scoring.*
  const txt = JSON.stringify(env.spec);
  for (const m of txt.matchAll(/([a-z0-9-]+)\.[a-zA-Z_$][\w$]*\(/g)) {
    assert.equal(m[1], "eval-scoring", "non-eval-scoring adapter call: " + m[0]);
  }
});

/* ---------- the three audience surfaces ---------- */

test("Scorecard (exec): pass/score stat-cards + hard-gate banner + metric rollup + trend svg", () => {
  const view = clickTab("Scorecard");
  assert.match(view, /cases passed/);
  assert.match(view, /total score/);
  assert.match(view, /hard.?gate/i);   // banner (the seeded replay run has a hard-gate fail)
  assert.match(view, /<svg/);          // metric-rollup bars and/or trend chart
  assert.match(view, /score over runs/i);
});

test("Scorecard hard-gate banner FAILS on the run with an unpassed hard gate", () => {
  // default run is newest-first; the live run passes the gate. The earlier replay
  // run fails it — assert the adapter-computed banner reflects the selected run.
  const api = loadEngineApi();
  const bundle = JSON.parse(DATA);
  const replay = bundle.domains.industrial.runs["20260619-090000-industrial-replay"];
  const live = bundle.domains.industrial.runs["20260619-100000-industrial-live"];
  assert.deepEqual(api.ADAPTERS["eval-scoring"].hardGateFailures(replay), ["safety-estop"]);
  assert.deepEqual(api.ADAPTERS["eval-scoring"].hardGateFailures(live), []);
});

test("Drilldown (operator): interactive case-table + regression diff before/after", () => {
  const view = clickTab("Drilldown");
  // case-table filter input
  let fi = null; walk(registry["#view"], (n) => { if (!fi && n.tag === "input") fi = n; });
  assert.ok(fi, "case-table filter input rendered");
  // sortable score header
  const headers = []; walk(registry["#view"], (n) => { if (n.tag === "th") headers.push(n); });
  assert.ok(headers.some((h) => (h.dataset && h.dataset.sort) === "score"), "sortable score header");
  // regression diff (two distinct runs in this domain -> rows, not the 'same run' notice)
  assert.match(view, /regressions/);
  assert.match(view, /improvements/);
});

test("Drilldown case-table filter narrows the rendered rows", () => {
  clickTab("Drilldown");
  let fi = null; walk(registry["#view"], (n) => { if (!fi && n.tag === "input") fi = n; });
  fi.value = "estop"; fi.dispatch("input");
  let tb = null; walk(registry["#view"], (n) => { if (!tb && n.tag === "tbody") tb = n; });
  assert.equal(tb.children.length, 1); // only safety-estop matches
  fi.value = ""; fi.dispatch("input");
  walk(registry["#view"], (n) => { if (n.tag === "tbody") tb = n; });
  assert.equal(tb.children.length, 2); // both cases restored
});

test("Transcript: the plan-act-observe loop renders observed output + final answer", () => {
  // navigate to a domain/case that has a transcript (industrial / safety-estop is default-first there)
  const view = clickTab("Transcript");
  assert.match(view, /observed/);       // tool_result block
  assert.match(view, /final answer/i);  // submit_answer block
});

test("Fleet: cross-grid renders every domain's latest run", () => {
  const view = clickTab("Fleet");
  assert.match(view, /industrial/);
  assert.match(view, /trust_safety/);
  assert.match(view, /<svg/); // per-domain metric bars
});

test("subtitle + footer come from the spec", () => {
  assert.match(serialize(registry["#subtitle"]), /Live eval console/);
  assert.match(serialize(registry["#foot"]), /read-only internal endpoint/);
});

/* ---------- pure-API: the live merge path the endpoint would feed ---------- */

test("liveApply merges a same-shape bundle and rejects junk (the engine-owned merge)", () => {
  const api = loadEngineApi();
  const ds = api.emptyDataset();
  // a valid bundle merges; viewMount isn't available in this bare API context, so
  // assert the merge primitive the live path reuses (mergeBundle) directly.
  api.mergeBundle(ds, JSON.parse(DATA));
  assert.deepEqual(Array.from(api.viewDomains(ds)).sort(), ["industrial", "trust_safety"]);
  assert.equal(api.isBundle({ nope: 1 }), false); // junk is rejected before any merge
});
