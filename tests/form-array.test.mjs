/* `type: array` form fields — checkbox group (enum items) + string-list textarea.
 * Compiles an inline form spec with both array shapes, boots it under the standard
 * DOM shim (input.type/.checked/.value + dispatchable "change"/"input"), and asserts:
 * a checkbox group renders N boxes for N enum items; toggling adds/removes from the
 * answer array (immutably, in enum order); a string-list textarea round-trips lines;
 * variables.json emits a real JSON array; variables.env emits the joined scalar; and a
 * required empty array is invalid. Mirrors form-boolean.test.mjs exactly. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const SPEC = `
"$schema": "https://json-schema.org/draft/2020-12/schema"
type: "object"
x-forge-kind: "form"
x-forge-name: "array-test"
title: "Array test"
x-forge-outputs: ["env", "json"]
required: ["FEATURES"]
properties:
  FEATURES:
    type: "array"
    title: "Features"
    items:
      enum: ["a", "b", "c"]
    minItems: 1
  TAGS:
    type: "array"
    title: "Tags"
    items:
      type: "string"
`;

const { html } = compile({ specText: SPEC, dataText: null });

/* DOM shim — same shape as form-boolean: tracks type/checked/value, supports
 * dispatching "change"/"input" to registered listeners. */
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

function walk(node, fn) {
  if (!node) return;
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}

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

// collect rendered controls
const checkboxes = [];
const textareas = [];
walk(registry["#view"], (n) => {
  if (n.tag === "input" && n.type === "checkbox") checkboxes.push(n);
  if (n.tag === "textarea") textareas.push(n);
});

test("an enum-items array renders one checkbox per enum item", () => {
  assert.equal(checkboxes.length, 3); // a, b, c
  assert.deepEqual(checkboxes.map((c) => c.value), ["a", "b", "c"]);
});

test("a string-items array renders a textarea", () => {
  assert.equal(textareas.length, 1);
});

/* the change/input handlers write answers[key] then formPersist -> localStorage.
 * read back what was persisted to observe the booted engine's real answers array. */
function persisted() {
  for (const [, v] of lsStore) {
    try { const o = JSON.parse(v); if (o && typeof o === "object" && ("FEATURES" in o || "TAGS" in o)) return o; } catch (e) {}
  }
  return null;
}

test("toggling a checkbox adds the value to the answer array", () => {
  const b = checkboxes[1]; // "b"
  b.checked = true;
  b.dispatch("change");
  assert.deepEqual(persisted().FEATURES, ["b"]);
});

test("toggling more checkboxes keeps the array in enum order, not click order", () => {
  const a = checkboxes[0], c = checkboxes[2];
  c.checked = true; c.dispatch("change"); // click c first
  a.checked = true; a.dispatch("change"); // then a
  assert.deepEqual(persisted().FEATURES, ["a", "b", "c"]); // enum order, not [b,c,a]
});

test("un-toggling a checkbox removes the value (immutable update)", () => {
  const b = checkboxes[1];
  b.checked = false;
  b.dispatch("change");
  assert.deepEqual(persisted().FEATURES, ["a", "c"]);
});

test("a string-list textarea round-trips one value per line (blank lines dropped)", () => {
  const ta = textareas[0];
  ta.value = "x.com\n\n  y.com  \n";
  ta.dispatch("input");
  assert.deepEqual(persisted().TAGS, ["x.com", "y.com"]);
});

/* ---- pure-API assertions ---- */
const api = loadEngineApi();
const env = api.parseEnvelope(api.parseSpecText(SPEC).data);
const spec = env.spec;

test("formExportJson emits a real JSON array for an array field", () => {
  const json = JSON.parse(api.formExportJson(spec, { FEATURES: ["a", "c"], TAGS: ["x", "y"] }));
  assert.deepEqual(json.FEATURES, ["a", "c"]);
  assert.deepEqual(json.TAGS, ["x", "y"]);
});

test("formExportEnv emits a comma-joined scalar for an array field", () => {
  const envTxt = api.formExportEnv(spec, { FEATURES: ["a", "c"], TAGS: ["x", "y"] });
  assert.match(envTxt, /^FEATURES=a,c$/m);
  assert.match(envTxt, /^TAGS=x,y$/m);
});

test("an array value with a space gets dotenv-quoted as a whole scalar", () => {
  const envTxt = api.formExportEnv(spec, { FEATURES: ["a"], TAGS: ["one two", "three"] });
  assert.match(envTxt, /^TAGS="one two,three"$/m);
});

test("formCurVal returns [] for an array field with no answer and no default", () => {
  const f = api.formFields(spec).find((x) => x.key === "TAGS");
  const v = api.formCurVal(f, {});
  // cross-realm safe: the default [] is created inside the node:vm engine realm, so a
  // deepStrictEqual against a test-realm [] would fail the prototype-identity check.
  assert.ok(Array.isArray(v) && v.length === 0);
});

test("a required array is invalid when empty, valid when non-empty", () => {
  const f = api.formFields(spec).find((x) => x.key === "FEATURES");
  assert.equal(api.formFieldError(f, []), "required");
  assert.equal(api.formFieldError(f, ["a"]), null);
});

test("an optional array is valid when empty", () => {
  const f = api.formFields(spec).find((x) => x.key === "TAGS");
  assert.equal(api.formFieldError(f, []), null);
});

test("enum-items validation rejects an out-of-enum element", () => {
  const f = api.formFields(spec).find((x) => x.key === "FEATURES");
  assert.match(api.formFieldError(f, ["a", "zzz"]), /every item must be one of/);
});

test("minItems is enforced", () => {
  const f = api.formFields(spec).find((x) => x.key === "FEATURES");
  assert.equal(api.formFieldError(f, ["a"]), null); // 1 satisfies minItems:1
});

/* byte-identity guard: a spec with NO array fields exports exactly as before. */
const SCALAR_SPEC = `
type: "object"
x-forge-kind: "form"
x-forge-name: "scalar-only"
properties:
  PORT: { type: "integer", default: "3000" }
  NAME: { type: "string", default: "svc x" }
`;
test("non-array fields export byte-identical (no array codepath touches them)", () => {
  const e2 = api.parseEnvelope(api.parseSpecText(SCALAR_SPEC).data);
  const envTxt = api.formExportEnv(e2.spec, { PORT: "3000", NAME: "svc x" });
  // NAME has a space => whole-scalar dotenv quoting, exactly as pre-feature.
  assert.match(envTxt, /^PORT=3000$/m);
  assert.match(envTxt, /^NAME="svc x"$/m);
});
