/* Phase 1 — richer form exports (annotated env / YAML / TOML).
 * Mirrors form-boolean.test.mjs conventions exactly: node:test + node:vm + the El
 * DOM shim + an id registry + an lsStore Map; compile() and loadEngineApi() come
 * from compile-spec.mjs. Two halves:
 *   (1) pure-API: assert the new exporters' shapes, the secrets split, the YAML
 *       round-trip through parseYaml, and that env/json bytes are unchanged for a
 *       spec that does NOT request the new outputs.
 *   (2) boot-under-shim: a spec that DOES request the extras renders the extra
 *       buttons; a spec that does not renders exactly the default four. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const api = loadEngineApi();

/* a spec that opts INTO every new output, with a group title + descriptions +
 * a secret field, so we can assert section headers, comment lines, and the
 * secrets exclusion all at once. */
const RICH = `
"$schema": "https://json-schema.org/draft/2020-12/schema"
type: "object"
x-forge-kind: "form"
x-forge-name: "rich-exports"
title: "Rich exports demo"
x-forge-outputs: ["env", "json", "yaml", "toml", "env-annotated"]
x-forge-groups:
  - {id: "server", title: "Server settings"}
  - {id: "auth", title: "Auth"}
required: ["PORT"]
properties:
  PORT:
    type: "integer"
    description: "TCP port the server binds"
    default: "3000"
    group: "server"
  GREETING:
    type: "string"
    description: "shown on the landing page"
    default: "hello world"
    group: "server"
  DEBUG:
    type: "boolean"
    default: "false"
    group: "server"
  API_TOKEN:
    type: "string"
    secret: true
    default: "s3cr3t"
    group: "auth"
`;

/* a spec that does NOT request any new output — must keep today's bytes/buttons. */
const PLAIN = `
type: "object"
x-forge-kind: "form"
x-forge-name: "plain-exports"
title: "Plain"
x-forge-outputs: ["env", "json"]
properties:
  PORT:
    type: "integer"
    default: "3000"
  API_TOKEN:
    type: "string"
    secret: true
    default: "s3cr3t"
`;

const richSpec = api.parseEnvelope(api.parseSpecText(RICH).data).spec;
const plainSpec = api.parseEnvelope(api.parseSpecText(PLAIN).data).spec;

/* ---- (1) pure-API assertions ---- */

test("formOutputs honors the vocabulary and always includes env+json", () => {
  const o = api.formOutputs(richSpec);
  for (const k of ["env", "json", "yaml", "toml", "env-annotated"]) assert.equal(o.has(k), true);
  const p = api.formOutputs(plainSpec);
  assert.equal(p.has("env"), true);
  assert.equal(p.has("json"), true);
  assert.equal(p.has("yaml"), false);
  assert.equal(p.has("toml"), false);
  assert.equal(p.has("env-annotated"), false);
});

test("annotated env: description -> comment line, group title -> section header", () => {
  const t = api.formExportEnvAnnotated(richSpec, {});
  assert.match(t, /# == Server settings ==/);            // group header
  assert.match(t, /# TCP port the server binds\nPORT=3000/); // desc comment directly above its KEY
  assert.match(t, /# shown on the landing page\nGREETING=/);
});

test("annotated env: KEY=value lines are byte-identical to variables.env", () => {
  const ann = api.formExportEnvAnnotated(richSpec, {});
  const env = api.formExportEnv(richSpec, {});
  const vars = (s) => s.split("\n").filter((l) => l && l[0] !== "#");
  assert.deepEqual(vars(ann), vars(env));
});

test("YAML export round-trips through parseYaml to the same public string map", () => {
  const answers = { PORT: "8080", GREETING: "a: tricky # value", DEBUG: "true" };
  const yaml = api.formExportYaml(richSpec, answers);
  const parsed = api.parseYaml(yaml);
  const expected = Object.fromEntries(api.formBuckets(richSpec, answers).pub);
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(expected).sort());
  for (const k of Object.keys(expected)) assert.equal(parsed[k], expected[k]);
});

test("YAML export keeps string-typed values from coercing (number/bool/empty)", () => {
  const yaml = api.formExportYaml(richSpec, { PORT: "3000", DEBUG: "true", GREETING: "" });
  const parsed = api.parseYaml(yaml);
  assert.strictEqual(parsed.PORT, "3000");   // NOT the number 3000
  assert.strictEqual(parsed.DEBUG, "true");  // NOT the boolean true
  assert.strictEqual(parsed.GREETING, "");   // empty stays the empty string
});

test("TOML export shape: key = \"value\", escapes embedded quotes/backslashes", () => {
  const t = api.formExportToml(richSpec, { PORT: "3000", GREETING: 'say "hi"\\n' });
  assert.match(t, /^PORT = "3000"$/m);
  assert.match(t, /^GREETING = "say \\"hi\\"\\\\n"$/m);
});

test("secrets are absent from EVERY public format and present in the secrets export", () => {
  for (const fn of ["formExportEnv", "formExportJson", "formExportYaml", "formExportToml", "formExportEnvAnnotated"]) {
    const t = api[fn](richSpec, {});
    assert.doesNotMatch(t, /API_TOKEN/, fn + " must not contain the secret key");
    assert.doesNotMatch(t, /s3cr3t/, fn + " must not contain the secret value");
  }
  const sec = api.formExportSecrets(richSpec, {}, "secret");
  assert.match(sec, /API_TOKEN=/);
});

test("env/json bytes are UNCHANGED for a spec that does not request new outputs", () => {
  const env = api.formExportEnv(plainSpec, {});
  const json = api.formExportJson(plainSpec, {});
  assert.equal(env, "# generated by spec-renderer from spec 'plain-exports'\n\nPORT=3000\n");
  assert.equal(json, '{\n  "PORT": "3000"\n}\n');
});

/* ---- (2) boot-under-shim: button gating ---- */

class El {
  constructor(tag) {
    this.tag = tag; this.className = ""; this._html = ""; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.onclick = null;
    this.value = ""; this.type = ""; this.checked = false; this.disabled = false; this._listeners = {};
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

function bootBar(specText) {
  const { html } = compile({ specText, dataText: null });
  const registry = {};
  for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
    "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#dlEnvAnn", "#dlYaml",
    "#dlToml", "#drop", "#file", "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  registry["#embedded-spec"].textContent = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1];
  const lsStore = new Map();
  const ctx = {
    document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
    localStorage: { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, v), removeItem: (k) => lsStore.delete(k) },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return registry["#bar"].innerHTML;
}

test("a spec requesting yaml/toml/env-annotated renders the extra buttons", () => {
  const bar = bootBar(RICH);
  for (const id of ["dlEnv", "dlSecret", "dlJson", "dlAll", "dlEnvAnn", "dlYaml", "dlToml"]) {
    assert.match(bar, new RegExp('id="' + id + '"'), "expected button #" + id);
  }
});

test("a spec NOT requesting extras renders exactly the default four buttons", () => {
  const bar = bootBar(PLAIN);
  for (const id of ["dlEnv", "dlSecret", "dlJson", "dlAll"]) assert.match(bar, new RegExp('id="' + id + '"'));
  for (const id of ["dlEnvAnn", "dlYaml", "dlToml"]) assert.doesNotMatch(bar, new RegExp('id="' + id + '"'));
});
