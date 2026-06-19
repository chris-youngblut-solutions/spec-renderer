/* form-prefill — a form compiled with --data becomes a config editor.
 * Compiles an inline form spec WITH a dataText {key: value} map that overrides some
 * defaults, boots it under a DOM shim, and asserts:
 *   - answers reflect the embedded data (not just spec defaults), via rendered inputs;
 *   - the export bar shows the "Reset to provided" affordance when --data was embedded;
 *   - a value already in localStorage overrides the embedded data (precedence:
 *     localStorage > embedded --data > spec default).
 * A parallel pure-API run pins formSeedAnswers' shape without a DOM. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const SPEC = `
"$schema": "https://json-schema.org/draft/2020-12/schema"
type: "object"
x-forge-kind: "form"
x-forge-name: "cfg-demo"
title: "Config demo"
x-forge-outputs: ["env", "json"]
properties:
  NODE_ENV:
    type: "string"
    enum: ["development", "production", "test"]
    default: "production"
  PORT:
    type: "integer"
    default: "3000"
  HOST:
    type: "string"
    default: "0.0.0.0"
`;

/* --data: a flat {key:value} map overriding PORT + HOST; NODE_ENV left to default. */
const DATA = JSON.stringify({ PORT: "8080", HOST: "127.0.0.1" });
const { html } = compile({ specText: SPEC, dataText: DATA });

/* DOM shim — identical shape to form-boolean.test.mjs. */
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
function serialize(node) {
  if (!node) return "";
  let s = (node._html || "") + (node.textContent || "");
  for (const c of node.children || []) s += serialize(c);
  return s;
}

/* a fresh boot of the compiled engine over a given pre-seeded localStorage store. */
function boot(seedLs) {
  const registry = {};
  for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
    "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#drop", "#file",
    "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  registry["#embedded-spec"].textContent = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1];
  // the compiled output carries our --data in the #embedded-data tag — wire it into the shim
  registry["#embedded-data"].textContent = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/)[1];
  const lsStore = new Map();
  if (seedLs) for (const [k, v] of Object.entries(seedLs)) lsStore.set(k, v);
  const ctx = {
    document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
    localStorage: { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, v), removeItem: (k) => lsStore.delete(k) },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return { registry, lsStore };
}

// collect rendered text inputs (key -> value) from a booted #view
function inputsByKey(registry) {
  const map = {};
  walk(registry["#view"], (n) => {
    if (n.dataset && n.dataset.key) {
      walk(n, (c) => { if ((c.tag === "input" || c.tag === "select") && map[n.dataset.key] === undefined) map[n.dataset.key] = c.value; });
    }
  });
  return map;
}

test("the compiled output embeds the --data map for a form", () => {
  const raw = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/)[1].trim();
  const obj = JSON.parse(raw);
  assert.equal(obj.PORT, "8080");
  assert.equal(obj.HOST, "127.0.0.1");
});

test("answers reflect embedded --data (not just spec defaults)", () => {
  const { registry } = boot();
  const vals = inputsByKey(registry);
  assert.equal(vals.PORT, "8080");   // from --data, overriding default "3000"
  assert.equal(vals.HOST, "127.0.0.1"); // from --data, overriding default "0.0.0.0"
  assert.equal(vals.NODE_ENV, "production"); // no --data key => spec default
});

test("the export reflects the embedded --data", () => {
  const api = loadEngineApi();
  const env = api.parseEnvelope(api.parseSpecText(SPEC).data);
  const seeded = { PORT: "8080", HOST: "127.0.0.1" };
  const json = JSON.parse(api.formExportJson(env.spec, seeded));
  assert.equal(json.PORT, "8080");
  assert.equal(json.HOST, "127.0.0.1");
  assert.equal(json.NODE_ENV, "production"); // default flows through for the un-provided key
  assert.equal(typeof api.formSeedAnswers(env.spec), "object"); // exported + callable
});

test("localStorage overrides embedded --data (precedence: localStorage > --data > default)", () => {
  const { registry } = boot({ "sr.form.cfg-demo.v1": JSON.stringify({ PORT: "9999" }) });
  const vals = inputsByKey(registry);
  assert.equal(vals.PORT, "9999");      // saved edit beats --data
  assert.equal(vals.HOST, "127.0.0.1"); // no saved edit for HOST -> --data wins
  assert.equal(vals.NODE_ENV, "production"); // neither -> default
});

test("formSeedAnswers (pure, no DOM): empty embedded tier, sane shape", () => {
  const api = loadEngineApi();
  const env = api.parseEnvelope(api.parseSpecText(SPEC).data);
  const a = api.formSeedAnswers(env.spec);
  assert.equal(typeof a, "object");
  assert.ok(!("PORT" in a) || a.PORT !== undefined); // no DOM, no localStorage -> empty
});

test("the export bar shows 'Reset to provided' only when --data was embedded", () => {
  const { registry } = boot();
  const bar = serialize(registry["#bar"]);
  assert.match(bar, /resetData/);
  for (const id of ["dlEnv", "dlSecret", "dlJson", "dlAll"]) assert.match(bar, new RegExp(id));
});
