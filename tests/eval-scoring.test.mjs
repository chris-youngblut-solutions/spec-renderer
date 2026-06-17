/* Phase 2 — eval-scoring adapter parity.
 * The six recompute fns must mirror agentic-eval-harness scoring.py. These are
 * the assertions the eval-dashboard recompute test pinned, now against the
 * engine's ADAPTERS["eval-scoring"]. vm-returned values are normalized through
 * plain() before structural comparison (cross-realm prototypes). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(join(ROOT, "engine.js"), "utf8"), ctx);
const A = ctx.module.exports.ADAPTERS["eval-scoring"];
const plain = (x) => JSON.parse(JSON.stringify(x));

const card = {
  run_id: "r1", backend: "replay", model: "m",
  cases: [
    { case_id: "a", metric: "alpha", score: 1.0, passed: true, hard_gate: false },
    { case_id: "a2", metric: "alpha", score: 0.5, passed: false, hard_gate: false },
    { case_id: "b", metric: "beta", score: 1.0, passed: true, hard_gate: false },
    { case_id: "g1", metric: null, score: 0.0, passed: false, hard_gate: true },
  ],
};

test("byMetric: first-appearance order, null -> (untagged)", () => {
  assert.deepStrictEqual(plain(A.byMetric(card)).map((r) => r.metric), ["alpha", "beta", "(untagged)"]);
});
test("byMetric: per-metric rollup shape + math", () => {
  assert.deepStrictEqual(plain(A.byMetric(card))[0], { metric: "alpha", n: 2, passed: 1, mean_score: 0.75 });
});
test("totalScore: sum of case scores", () => assert.equal(A.totalScore(card), 2.5));
test("passedCount: count of passed cases", () => assert.equal(A.passedCount(card), 2));
test("hardGateFailures: only hard_gate && !passed case_ids", () => {
  assert.deepStrictEqual(plain(A.hardGateFailures(card)), ["g1"]);
});

const before = { cases: [{ case_id: "a", score: 1 }, { case_id: "b", score: 0.5 }] };
const after = { cases: [{ case_id: "a", score: 0 }, { case_id: "b", score: 1 }, { case_id: "c", score: 0.7 }] };

test("diffRows: tallies + markers (scoring.diff_report semantics)", () => {
  const d = A.diffRows(before, after);
  assert.equal(d.regressions, 1);
  assert.equal(d.improvements, 1);
  const by = Object.fromEntries(d.rows.map((r) => [r.case_id, r]));
  assert.equal(by.a.marker, "REGRESSED");
  assert.equal(by.b.marker, "improved");
  assert.equal(by.c.marker, "new");
  assert.equal(by.c.before, null);
});
test("metricKey: untagged default", () => {
  assert.equal(A.metricKey({ metric: "x" }), "x");
  assert.equal(A.metricKey({ metric: null }), "(untagged)");
});
