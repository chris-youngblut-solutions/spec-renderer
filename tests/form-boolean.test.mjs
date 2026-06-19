/* Phase 1 — boolean form fields render as a real HTML checkbox.
 * Compiles an inline form spec with a boolean field (no enum) plus an enum field,
 * boots it under a DOM shim that records input.type/.checked and dispatches the
 * "change" event, and asserts: the boolean renders an input[type=checkbox];
 * toggling checked drives answers[key] to "true"/"false"; formExportJson reflects
 * that; and an enum field still renders a <select> (no regression). */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const SPEC = `
"$schema": "https://json-schema.org/draft/2020-12/schema"
type: "object"
x-forge-kind: "form"
x-forge-name: "bool-demo"
title: "Boolean demo"
x-forge-outputs: ["env", "json"]
properties:
  FEATURE_FLAG:
    type: "boolean"
    title: "Feature flag"
    default: "false"
  MODE:
    type: "string"
    enum: ["a", "b", "c"]
    default: "a"
`;

const { html } = compile({ specText: SPEC, dataText: null });

/* DOM shim — richer than the smoke shim: tracks type/checked and supports
 * dispatching a "change" event to the registered listeners. */
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
  // .err lookups during formCheck — return a throwaway element so it no-ops cleanly
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

// collect rendered inputs by tag/type
const checkboxes = [];
const selects = [];
walk(registry["#view"], (n) => {
  if (n.tag === "input" && n.type === "checkbox") checkboxes.push(n);
  if (n.tag === "select") selects.push(n);
});

test("a type:boolean field renders an input[type=checkbox]", () => {
  assert.equal(checkboxes.length, 1);
  assert.equal(checkboxes[0].type, "checkbox");
});

test("an enum field still renders a <select> (no regression)", () => {
  assert.equal(selects.length, 1);
  assert.equal(selects[0].children.length, 3); // a, b, c
});

/* The change handler writes answers[key] then calls formPersist, which does
 * localStorage.setItem(stateKey, JSON.stringify(answers)). We observe the booted
 * engine's real answers object by reading back what it persisted. */
function persistedAnswers() {
  // exactly one form-state key is written by formPersist
  for (const [, v] of lsStore) {
    try { const o = JSON.parse(v); if (o && typeof o === "object" && "FEATURE_FLAG" in o) return o; } catch (e) {}
  }
  return null;
}

test("dispatching change with checked=true sets answers[key] to \"true\"", () => {
  const cb = checkboxes[0];
  cb.checked = true;
  cb.dispatch("change");
  assert.equal(persistedAnswers().FEATURE_FLAG, "true");
});

test("dispatching change with checked=false sets answers[key] to \"false\"", () => {
  const cb = checkboxes[0];
  cb.checked = false;
  cb.dispatch("change");
  assert.equal(persistedAnswers().FEATURE_FLAG, "false");
});

/* Parallel pure-API run: build spec + answers ourselves to assert formExportJson
 * reflects the boolean as "true"/"false" exactly as the change handler would set it. */
const api = loadEngineApi();
const env = api.parseEnvelope(api.parseSpecText(SPEC).data);
const spec = env.spec;

test("formExportJson reflects a boolean answer of \"true\"", () => {
  const json = JSON.parse(api.formExportJson(spec, { FEATURE_FLAG: "true", MODE: "a" }));
  assert.equal(json.FEATURE_FLAG, "true");
});

test("formExportJson reflects a boolean answer of \"false\"", () => {
  const json = JSON.parse(api.formExportJson(spec, { FEATURE_FLAG: "false", MODE: "a" }));
  assert.equal(json.FEATURE_FLAG, "false");
});

test("an unchecked required-or-not boolean is a present value (\"false\"), validates clean", () => {
  // formFieldError treats "false" as present (non-empty) and a valid boolean
  const f = api.formFields(spec).find((x) => x.key === "FEATURE_FLAG");
  assert.equal(api.formFieldError(f, "false"), null);
  assert.equal(api.formFieldError(f, "true"), null);
});
