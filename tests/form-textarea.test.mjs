/* Phase 1 — multi-line string form fields render as a <textarea>.
 * Compiles an inline form spec with a `format: textarea` field, an
 * `x-forge-multiline: true` field, a plain string field, and an enum field, boots it
 * under a DOM shim that records tag/type/value and dispatches the "input" event, and
 * asserts: textarea fields render a <textarea> (not <input type=text>); the plain
 * string field still renders an <input type=text> (no regression); the enum field
 * still renders a <select>; an "input" event on the textarea drives answers[key];
 * a `format: textarea` field skips format validation cleanly (no validator); and a
 * multi-line value exports to .env on ONE physical line without corrupting later
 * KEY=value lines. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const SPEC = `
"$schema": "https://json-schema.org/draft/2020-12/schema"
type: "object"
x-forge-kind: "form"
x-forge-name: "textarea-demo"
title: "Textarea demo"
x-forge-outputs: ["env", "json"]
properties:
  APP_NAME:
    type: "string"
    title: "App name"
    default: "myapp"
  MOTD:
    type: "string"
    format: "textarea"
    title: "Message of the day"
  WELCOME_NOTE:
    type: "string"
    x-forge-multiline: true
    title: "Welcome note"
  MODE:
    type: "string"
    enum: ["a", "b", "c"]
    default: "a"
`;

const { html } = compile({ specText: SPEC, dataText: null });

/* DOM shim — tracks tag/type/value and dispatches "input" to registered listeners. */
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

// collect rendered inputs by tag/type
const textareas = [];
const textInputs = [];
const selects = [];
walk(registry["#view"], (n) => {
  if (n.tag === "textarea") textareas.push(n);
  if (n.tag === "input" && n.type === "text") textInputs.push(n);
  if (n.tag === "select") selects.push(n);
});

test("a format:textarea field and an x-forge-multiline field both render a <textarea>", () => {
  assert.equal(textareas.length, 2);
});

test("a plain string field still renders an <input type=text> (no regression)", () => {
  // APP_NAME is the only plain string field (MODE is enum, MOTD/WELCOME_NOTE are textareas)
  assert.equal(textInputs.length, 1);
  assert.equal(textInputs[0].type, "text");
});

test("an enum field still renders a <select> (no regression)", () => {
  assert.equal(selects.length, 1);
  assert.equal(selects[0].children.length, 3); // a, b, c
});

/* The input handler writes answers[key] then formPersist -> localStorage.setItem.
 * We read back the persisted answers to observe the booted engine's real state. */
function persistedAnswers() {
  for (const [, v] of lsStore) {
    try { const o = JSON.parse(v); if (o && typeof o === "object" && "MOTD" in o) return o; } catch (e) {}
  }
  return null;
}

test("an input event on a textarea drives answers[key], newlines preserved", () => {
  const ta = textareas[0];
  ta.value = "line one\nline two";
  ta.dispatch("input");
  assert.equal(persistedAnswers().MOTD, "line one\nline two");
});

/* Parallel pure-API run for validation + export assertions. */
const api = loadEngineApi();
const env = api.parseEnvelope(api.parseSpecText(SPEC).data);
const spec = env.spec;

test("a format:textarea field skips format validation cleanly (no validator collision)", () => {
  const f = api.formFields(spec).find((x) => x.key === "MOTD");
  // 'textarea' is not in FORM_FORMAT_VALID, so a multi-line value is never rejected
  // by ipv4/email/uri logic. A non-empty value validates clean.
  assert.equal(api.formFieldError(f, "any\nmulti-line\nvalue"), null);
  // empty + not required => null (optional). (MOTD is not in required[] here.)
  assert.equal(api.formFieldError(f, ""), null);
});

test("formEnvQuote keeps a multi-line value on one physical line", () => {
  const q = api.formEnvQuote("line one\nline two");
  // exactly one physical line, double-quoted, \n escaped to two chars
  assert.equal(q, '"line one\\nline two"');
  assert.equal(q.split("\n").length, 1);
});

test("a multi-line value exports without corrupting later KEY=value lines", () => {
  const text = api.formExportEnv(spec, { APP_NAME: "myapp", MOTD: "first\nsecond", WELCOME_NOTE: "hi", MODE: "a" });
  // body after banner: every KEY=value is exactly one physical line.
  const lines = text.split("\n").filter((l) => l.length && !l.startsWith("#"));
  // each kept line must look like KEY=... (no orphaned value tail leaking onto its own line)
  for (const l of lines) assert.match(l, /^[A-Z0-9_]+=/);
  // MOTD must be present as a single escaped line
  assert.ok(lines.some((l) => l === 'MOTD="first\\nsecond"'), "MOTD line:\n" + JSON.stringify(lines));
});

test("formEnvQuote is byte-identical for a single-line value with a space (no regression)", () => {
  assert.equal(api.formEnvQuote("has space"), '"has space"');
  assert.equal(api.formEnvQuote("plain"), "plain");
});
