/* Phase 2 — view dataset model + binding resolver.
 * The resolver is the fragile piece: it MUST support only {path} lookups,
 * $selector, and adapter.fn(args) — and nothing else. These tests pin that
 * boundary (incl. rejecting unknown adapter calls) so it can't quietly grow. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(join(ROOT, "engine.js"), "utf8"), ctx);
const E = ctx.module.exports;
const plain = (x) => JSON.parse(JSON.stringify(x));

const bundle = {
  generated: "20260617120000", harness_commit: "abc123",
  domains: {
    generic: {
      runs: { "20260617-120000-generic-replay": { run_id: "20260617-120000-generic-replay", backend: "replay", model: "m", cases: [{ case_id: "x", score: 1, passed: true }] } },
      transcripts: { x: [{ role: "user", content: "hi" }] },
    },
  },
};

test("mergeBundle builds a normalized dataset", () => {
  const ds = E.mergeBundle(E.emptyDataset(), bundle);
  assert.deepStrictEqual(plain(E.viewDomains(ds)), ["generic"]);
  assert.equal(ds.generated, "20260617120000");
  assert.equal(ds.harness_commit, "abc123");
});

test("accessors: runsFor newest-first, cardOf, transcriptOf", () => {
  const ds = E.mergeBundle(E.emptyDataset(), bundle);
  const runs = E.viewRunsFor(ds, "generic");
  assert.equal(runs.length, 1);
  assert.equal(E.viewCardOf(ds, "generic", runs[0]).run_id, "20260617-120000-generic-replay");
  assert.deepStrictEqual(plain(E.viewTranscriptOf(ds, "generic", "x")), [{ role: "user", content: "hi" }]);
});

test("isBundle / isScorecard discriminate", () => {
  assert.equal(E.isBundle(bundle), true);
  assert.equal(E.isScorecard(bundle), false);
  assert.equal(E.isScorecard({ run_id: "r", cases: [] }), true);
  assert.equal(E.isBundle({ run_id: "r", cases: [] }), false);
});

test("domainFromRunId parses YYYYMMDD-HHMMSS-<domain>-<backend>", () => {
  assert.equal(E.domainFromRunId("20260617-120000-trust_safety-live"), "trust_safety");
  assert.equal(E.domainFromRunId("20260617-120000-multi-word-domain-replay"), "multi-word-domain");
  assert.equal(E.domainFromRunId("garbage"), "(dropped)");
});

// --- resolver ---
const card = { run_id: "r1", backend: "replay", cases: [{ score: 1, passed: true }, { score: 0, passed: false }] };
const rctx = { domain: "generic", caseId: "x", card, before: card, after: card };

test("resolver: {path} lookup", () => {
  assert.equal(E.resolveBinding("{card.run_id}", rctx), "r1");
  assert.equal(E.resolveBinding("{card.backend}", rctx), "replay");
});
test("resolver: $selector", () => {
  assert.equal(E.resolveBinding("$domain", rctx), "generic");
  assert.equal(E.resolveBinding("$caseId", rctx), "x");
});
test("resolver: adapter.fn(contextKey)", () => {
  assert.equal(E.resolveBinding("eval-scoring.totalScore(card)", rctx), 1);
  assert.equal(E.resolveBinding("eval-scoring.passedCount(card)", rctx), 1);
});
test("resolver: adapter.fn with two args", () => {
  const d = E.resolveBinding("eval-scoring.diffRows(before, after)", rctx);
  assert.equal(d.regressions, 0);
  assert.equal(d.rows.length, 2);
});
test("resolver: bare literal passes through", () => {
  assert.equal(E.resolveBinding("just text", rctx), "just text");
  assert.equal(E.resolveBinding("Overview", rctx), "Overview");
});
test("resolver: non-string passes through", () => {
  assert.equal(E.resolveBinding(42, rctx), 42);
});
test("resolver: unknown adapter call throws (not silently a literal)", () => {
  assert.throws(() => E.resolveBinding("nope.fn(card)", rctx), /unknown adapter call/);
  assert.throws(() => E.resolveBinding("eval-scoring.missingFn(card)", rctx), /unknown adapter call/);
});
