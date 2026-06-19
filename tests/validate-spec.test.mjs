/* validate-spec linter — a good spec lints clean (0 errors); a deliberately-bad
 * spec reports the specific errors + warnings the linter is contracted to find.
 * Pure-API: no DOM shim (the linter has no runtime surface) — it loads the engine
 * the same way compile-spec.mjs does and asserts on the structured lint result. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadEngineApi } from "../scripts/compile-spec.mjs";
import { lint } from "../scripts/validate-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = loadEngineApi();
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const some = (arr, rx) => arr.some((m) => rx.test(m));

/* ---- good shipped specs lint clean ---- */
test("the shipped example form spec lints with 0 errors", () => {
  const { errors } = lint(api, read("specs/example-app-env.form.yaml"));
  assert.equal(errors.length, 0, "unexpected errors: " + errors.join("; "));
});

test("the shipped example view spec lints with 0 errors", () => {
  const { errors } = lint(api, read("specs/eval.view.yaml"));
  assert.equal(errors.length, 0, "unexpected errors: " + errors.join("; "));
});

test("the conditional example form spec lints with 0 errors (x-forge-when refs resolve)", () => {
  const { errors } = lint(api, read("specs/example-conditional.form.yaml"));
  assert.equal(errors.length, 0, "unexpected errors: " + errors.join("; "));
});

/* ---- the deliberately-bad spec reports each contracted defect ---- */
const bad = lint(api, read("specs/example-bad.lint.yaml"));

test("bad spec: reports errors and exits nonzero (errors.length >= 6)", () => {
  assert.ok(bad.errors.length >= 6, "expected >=6 errors, got " + bad.errors.length + ": " + bad.errors.join("; "));
});

test("bad spec ERROR: x-forge-outputs value outside vocabulary", () => {
  assert.ok(some(bad.errors, /x-forge-outputs value outside vocabulary.*bogus-output/));
});
test("bad spec ERROR: required key absent from properties", () => {
  assert.ok(some(bad.errors, /required key absent from properties.*GHOST_KEY/));
});
test("bad spec ERROR: default not in enum", () => {
  assert.ok(some(bad.errors, /MODE.*default not in enum.*"z"/));
});
test("bad spec ERROR: status outside enum", () => {
  assert.ok(some(bad.errors, /MODE.*status outside enum.*"weird"/));
});
test("bad spec ERROR: group ref does not resolve", () => {
  assert.ok(some(bad.errors, /MODE.*group that does not resolve.*"no-such-group"/));
});
test("bad spec ERROR: x-forge-when references non-existent key", () => {
  assert.ok(some(bad.errors, /API_SECRET.*x-forge-when references non-existent key.*"MISSING_KEY"/));
});

test("bad spec WARNING: unknown top-level key", () => {
  assert.ok(some(bad.warnings, /unknown top-level key.*x-forge-bogus-top/));
});
test("bad spec WARNING: unknown per-property keyword", () => {
  assert.ok(some(bad.warnings, /unknown keyword on property 'MODE'.*nonsense/));
});
test("bad spec WARNING: secret field with json-only output", () => {
  assert.ok(some(bad.warnings, /API_SECRET.*secret.*json-only/));
});

/* ---- the engine's own structural checks fold in as errors ---- */
test("a spec missing name folds validateEnvelope into errors", () => {
  const { errors } = lint(api, "type: object\nproperties:\n  A: {type: string}\nx-forge-kind: form");
  assert.ok(some(errors, /name/), "expected a name error: " + errors.join("; "));
});

test("a spec with a bad kind folds validateEnvelope into errors", () => {
  const { errors } = lint(api, "name: x\n");
  assert.ok(some(errors, /kind/), "expected a kind error: " + errors.join("; "));
});

/* ---- a non-parseable spec yields a single parse error, no throw ---- */
test("an unparseable spec returns a parse error (does not throw)", () => {
  const { errors } = lint(api, "\tthis\tis: not yaml");
  assert.ok(errors.length >= 1);
  assert.ok(some(errors, /failed to parse|tab/i));
});
