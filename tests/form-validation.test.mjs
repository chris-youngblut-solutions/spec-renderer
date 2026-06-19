/* form-validation — JSON-Schema validation subset.
 * Pure-API coverage for the keywords added to formNormField + formFieldError:
 * minimum/maximum (integer AND number/float), minLength/maxLength, pattern (with
 * an invalid-pattern degrade-safe case), the new type:number (accepts floats,
 * rejects non-numbers) coexisting with integer (still rejects floats), inclusive
 * boundary equality, and a ReDoS cap that skips the regex on absurd input. Plus a
 * boot-through-DOM smoke that a number field renders a text input (no checkbox
 * regression). */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const api = loadEngineApi();

const SPEC = `
"$schema": "https://json-schema.org/draft/2020-12/schema"
type: "object"
x-forge-kind: "form"
x-forge-name: "valid-demo"
title: "Validation demo"
x-forge-outputs: ["env", "json"]
required: ["WORKERS"]
properties:
  WORKERS:
    type: "integer"
    minimum: 1
    maximum: 64
    default: "4"
  RATIO:
    type: "number"
    minimum: 0.1
    maximum: 1.0
    default: "0.5"
  NAME:
    type: "string"
    minLength: 3
    maxLength: 8
    default: "abcd"
  SLUG:
    type: "string"
    pattern: "^[a-z]+$"
    default: "ok"
  BADPAT:
    type: "string"
    pattern: "([a-z"
    default: "anything"
  PLAIN:
    type: "string"
    default: "x"
`;

const env = api.parseEnvelope(api.parseSpecText(SPEC).data);
const spec = env.spec;
const fieldOf = (k) => api.formFields(spec).find((f) => f.key === k);
const errOf = (k, v) => api.formFieldError(fieldOf(k), v);

/* ---- integer: bounds + still integer-only ---- */
test("integer minimum is inclusive (boundary equality passes)", () => {
  assert.equal(errOf("WORKERS", "1"), null);
});
test("integer below minimum fails with a terse message", () => {
  assert.equal(errOf("WORKERS", "0"), "must be >= 1");
});
test("integer maximum is inclusive; above fails", () => {
  assert.equal(errOf("WORKERS", "64"), null);
  assert.equal(errOf("WORKERS", "65"), "must be <= 64");
});
test("integer still rejects a float (integer-only preserved)", () => {
  assert.equal(errOf("WORKERS", "4.5"), "must be an integer");
});

/* ---- number (float) type ---- */
test("number accepts a float", () => assert.equal(errOf("RATIO", "0.5"), null));
test("number accepts an integer-looking value", () => assert.equal(errOf("RATIO", "1"), null));
test("number rejects a non-number", () => assert.equal(errOf("RATIO", "abc"), "must be a number"));
test("number rejects junk like 1.2.3", () => assert.equal(errOf("RATIO", "1.2.3"), "must be a number"));
test("number minimum inclusive boundary passes", () => assert.equal(errOf("RATIO", "0.1"), null));
test("number below minimum fails", () => assert.equal(errOf("RATIO", "0.05"), "must be >= 0.1"));
test("number above maximum fails", () => assert.equal(errOf("RATIO", "1.5"), "must be <= 1"));

/* ---- string length ---- */
test("minLength: too short fails", () => assert.equal(errOf("NAME", "ab"), "too short (min 3)"));
test("minLength: boundary length passes", () => assert.equal(errOf("NAME", "abc"), null));
test("maxLength: too long fails", () => assert.equal(errOf("NAME", "abcdefghi"), "too long (max 8)"));
test("maxLength: boundary length passes", () => assert.equal(errOf("NAME", "abcdefgh"), null));

/* ---- pattern ---- */
test("pattern match passes", () => assert.equal(errOf("SLUG", "abc"), null));
test("pattern no-match fails with a terse message", () => assert.equal(errOf("SLUG", "ABC"), "must match pattern"));
test("an invalid pattern degrades safely (treated as no pattern)", () => {
  const f = fieldOf("BADPAT");
  assert.equal(f.patternRe, null);            // compile failed -> null, never throws
  assert.equal(api.formFieldError(f, "anything"), null);
});
test("a field with no validation keywords is unaffected", () => {
  const f = fieldOf("PLAIN");
  assert.equal(f.min, null); assert.equal(f.max, null);
  assert.equal(f.minLen, null); assert.equal(f.maxLen, null);
  assert.equal(f.patternRe, null);
  assert.equal(api.formFieldError(f, "literally anything"), null);
});

/* ---- ReDoS cap: an absurdly long input skips the regex (treated as pass) ---- */
test("pattern is not run over an absurdly long input (ReDoS cap)", () => {
  const huge = "Z".repeat(20000); // would FAIL ^[a-z]+$ if tested; cap makes it pass
  assert.equal(errOf("SLUG", huge), null);
});

/* ---- ReDoS SHAPE guard: a catastrophic-backtracking pattern is rejected up front
 *      (degrades to no-pattern) so it can never run — the input cap alone does NOT
 *      bound exponential backtracking, which blows up at tiny inputs. ---- */
test("a catastrophic nested-quantifier pattern is rejected (degrades to no pattern), validates instantly", () => {
  const spec = api.parseEnvelope(api.parseSpecText(`
type: "object"
x-forge-kind: "form"
x-forge-name: "redos"
properties:
  EVIL:
    type: "string"
    pattern: "^(a+)+$"
`).data).spec;
  const f = api.formFields(spec).find((x) => x.key === "EVIL");
  assert.equal(f.patternRe, null, "catastrophic shape compiled to null");
  const t0 = process.hrtime.bigint();
  const r = api.formFieldError(f, "a".repeat(40) + "!"); // would hang if the regex ran
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r, null, "no pattern => no error");
  assert.ok(ms < 50, "returned in " + ms.toFixed(1) + "ms (no backtracking)");
});

test("a safe bounded pattern with a group is NOT over-rejected", () => {
  // (abc)+ has a quantified group but NO inner unbounded quantifier or alternation -> allowed.
  const spec = api.parseEnvelope(api.parseSpecText(`
type: "object"
x-forge-kind: "form"
x-forge-name: "safe"
properties:
  REP:
    type: "string"
    pattern: "^(abc)+$"
`).data).spec;
  const f = api.formFields(spec).find((x) => x.key === "REP");
  assert.ok(f.patternRe, "safe quantified-group pattern still compiles");
  assert.equal(api.formFieldError(f, "abcabc"), null);
  assert.equal(api.formFieldError(f, "abcx"), "must match pattern");
});

test("an overlapping-alternation pattern under a repetition is rejected (ReDoS)", () => {
  const spec = api.parseEnvelope(api.parseSpecText(`
type: "object"
x-forge-kind: "form"
x-forge-name: "alt"
properties:
  EVIL2:
    type: "string"
    pattern: "^(a|a)+$"
`).data).spec;
  const f = api.formFields(spec).find((x) => x.key === "EVIL2");
  assert.equal(f.patternRe, null, "alternation-under-repetition compiled to null");
  const t0 = process.hrtime.bigint();
  assert.equal(api.formFieldError(f, "a".repeat(40) + "!"), null);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 50, "instant (no backtracking)");
});

/* ---- empty / required interaction unchanged ---- */
test("empty required integer is 'required', not a bounds error", () => {
  assert.equal(errOf("WORKERS", ""), "required");
});
test("empty optional number is clean (guard returns before numeric branch)", () => {
  assert.equal(errOf("RATIO", ""), null);
});

/* ---- existing example fields unaffected (no new keywords, same verdicts) ---- */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const exSpec = api.parseEnvelope(api.parseSpecText(
  readFileSync(join(ROOT, "specs", "example-app-env.form.yaml"), "utf8")).data).spec;
test("example PORT (integer, no bounds) validates as before", () => {
  const f = api.formFields(exSpec).find((x) => x.key === "PORT");
  assert.equal(f.min, null); assert.equal(f.max, null);
  assert.equal(api.formFieldError(f, "3000"), null);
  assert.equal(api.formFieldError(f, "3.5"), "must be an integer");
});
test("example ADMIN_EMAIL (format:email) validates as before", () => {
  const f = api.formFields(exSpec).find((x) => x.key === "ADMIN_EMAIL");
  assert.equal(api.formFieldError(f, "a@b.co"), null);
  assert.equal(api.formFieldError(f, "nope"), "must be an email address");
});

/* ---- boot-through-DOM: a number field renders a text input (no checkbox regression). ---- */
const DOM_SPEC = `
"$schema": "https://json-schema.org/draft/2020-12/schema"
type: "object"
x-forge-kind: "form"
x-forge-name: "num-dom"
title: "Number DOM"
x-forge-outputs: ["env", "json"]
properties:
  RATE:
    type: "number"
    minimum: 0
    default: "1.5"
`;
const { html } = compile({ specText: DOM_SPEC, dataText: null });

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
function walk(node, fn) { if (!node) return; fn(node); for (const c of node.children || []) walk(c, fn); }

const registry = {};
for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
  "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#drop", "#file",
  "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
registry["#embedded-spec"].textContent = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1];

const lsStore = new Map();
const ctx = {
  document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
  localStorage: { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, v), removeItem: (k) => lsStore.delete(k) },
  location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);

const inputs = [];
walk(registry["#view"], (n) => { if (n.tag === "input") inputs.push(n); });
test("a number field renders a text input, not a checkbox", () => {
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].type, "text");
});
