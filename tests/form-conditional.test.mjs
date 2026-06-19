/* x-forge-when — declarative conditional visibility.
 * Pure API: a field with x-forge-when is inactive (excluded from exports +
 * validation) until its controlling field matches, then active. A malformed
 * when (array / nested object) is ignored (field always-active).
 * Booted DOM: toggling the controlling checkbox flips dependent rows'
 * style.display, mirroring form-boolean.test.mjs's shim conventions. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const specText = readFileSync(join(ROOT, "specs", "example-conditional.form.yaml"), "utf8");
const { html } = compile({ specText, dataText: null });

/* DOM shim — form-boolean's shim plus a querySelectorAll(".field") that walks
 * the subtree (formApplyConditions needs the row list). querySelector(".err")
 * keeps the throwaway-element behavior so formCheck no-ops. */
class El {
  constructor(tag) {
    this.tag = tag; this.className = ""; this._html = ""; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.onclick = null;
    this.value = ""; this.type = ""; this.checked = false; this._listeners = {};
    this.classList = {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains: (c) => false,
    };
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this._listeners[ev] || (this._listeners[ev] = [])).push(fn); }
  dispatch(ev) { for (const fn of this._listeners[ev] || []) fn(); }
  remove() {}
  querySelector(sel) { return new El("div"); } // .err lookups → throwaway, formCheck no-ops
  querySelectorAll(sel) {
    const out = [];
    const want = String(sel).replace(/^\./, "");
    const walk = (n) => {
      if (!n) return;
      if (n !== this && typeof n.className === "string" && (" " + n.className + " ").indexOf(" " + want + " ") >= 0) out.push(n);
      for (const c of n.children || []) walk(c);
    };
    walk(this);
    return out;
  }
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

/* find a rendered .field row by its data-key */
function rowFor(key) {
  let found = null;
  walk(registry["#view"], (n) => {
    if (n.tag === "div" && typeof n.className === "string" && n.className.indexOf("field") >= 0 && n.dataset && n.dataset.key === key) found = n;
  });
  return found;
}
/* find the controlling TLS checkbox */
function tlsCheckbox() {
  let cb = null;
  walk(registry["#view"], (n) => { if (n.tag === "input" && n.type === "checkbox") cb = n; });
  return cb;
}

test("DOM: a conditioned field is hidden by default (controller off)", () => {
  const cert = rowFor("TLS_CERT_PATH");
  assert.ok(cert, "TLS_CERT_PATH row rendered");
  assert.equal(cert.style.display, "none");
});

test("DOM: an unconditioned field is visible", () => {
  const storage = rowFor("STORAGE");
  assert.ok(storage);
  assert.notEqual(storage.style.display, "none");
});

test("DOM: toggling the controller on reveals dependent rows", () => {
  const cb = tlsCheckbox();
  assert.ok(cb, "TLS_ENABLED checkbox rendered");
  cb.checked = true;
  cb.dispatch("change");
  assert.equal(rowFor("TLS_CERT_PATH").style.display, "");
  assert.equal(rowFor("TLS_KEY_PATH").style.display, "");
});

test("DOM: toggling the controller back off re-hides dependent rows", () => {
  const cb = tlsCheckbox();
  cb.checked = false;
  cb.dispatch("change");
  assert.equal(rowFor("TLS_CERT_PATH").style.display, "none");
});

/* ---- pure API ---- */
const api = loadEngineApi();
const env = api.parseEnvelope(api.parseSpecText(specText).data);
const spec = env.spec;

test("formActive: inactive when controller's default doesn't match", () => {
  const cert = api.formFields(spec).find((f) => f.key === "TLS_CERT_PATH");
  const vals = api.formValues(spec, {}); // TLS_ENABLED default "false"
  assert.equal(api.formActive(cert, vals), false);
});

test("formActive: active when controller's answer matches", () => {
  const cert = api.formFields(spec).find((f) => f.key === "TLS_CERT_PATH");
  const vals = api.formValues(spec, { TLS_ENABLED: "true" });
  assert.equal(api.formActive(cert, vals), true);
});

test("formActive: active against a controller's matching DEFAULT (untouched)", () => {
  const bucket = api.formFields(spec).find((f) => f.key === "S3_BUCKET");
  assert.equal(api.formActive(bucket, api.formValues(spec, {})), false);
  assert.equal(api.formActive(bucket, api.formValues(spec, { STORAGE: "s3" })), true);
});

test("export: a hidden conditioned field is omitted from exports", () => {
  const out = JSON.parse(api.formExportJson(spec, {})); // TLS off, STORAGE local
  assert.equal("TLS_CERT_PATH" in out, false);
  assert.equal("TLS_KEY_PATH" in out, false);
  assert.equal("S3_BUCKET" in out, false);
  assert.equal(out.STORAGE, "local"); // unconditioned field present
});

test("export: a shown conditioned field is included in exports", () => {
  const out = JSON.parse(api.formExportJson(spec, { TLS_ENABLED: "true", STORAGE: "s3", S3_BUCKET: "my-bucket" }));
  assert.equal(out.TLS_CERT_PATH, "/etc/ssl/cert.pem"); // default flows through
  assert.equal(out.S3_BUCKET, "my-bucket");
});

test("validation: a hidden required-ish field doesn't count as invalid", () => {
  assert.equal(api.formInvalidCount(spec, {}), 0);
});

test("validation: the count tracks the active set, not a crash", () => {
  const n = api.formInvalidCount(spec, { TLS_ENABLED: "true" });
  assert.equal(typeof n, "number");
  assert.equal(n, 0);
});

test("malformed x-forge-when (array) is ignored → field always-active", () => {
  const notes = api.formFields(spec).find((f) => f.key === "NOTES");
  assert.equal(notes.when, null);
  assert.equal(api.formActive(notes, api.formValues(spec, {})), true);
  const out = JSON.parse(api.formExportJson(spec, { NOTES: "hi" }));
  assert.equal(out.NOTES, "hi");
});

test("malformed x-forge-when (nested object value) is ignored", () => {
  const f = api.parseEnvelope({
    type: "object", "x-forge-name": "x",
    properties: { A: { type: "string" }, B: { type: "string", "x-forge-when": { A: { nested: true } } } },
  });
  const fld = api.formFields(f.spec).find((x) => x.key === "B");
  assert.equal(fld.when, null);
  assert.equal(api.formActive(fld, api.formValues(f.spec, {})), true);
});

test("AND semantics: two-key when needs every entry to match", () => {
  const f = api.parseEnvelope({
    type: "object", "x-forge-name": "x",
    properties: {
      A: { type: "string", default: "1" }, B: { type: "string", default: "2" },
      C: { type: "string", "x-forge-when": { A: "1", B: "2" } },
    },
  });
  const fld = api.formFields(f.spec).find((x) => x.key === "C");
  assert.equal(api.formActive(fld, api.formValues(f.spec, {})), true);           // both defaults match
  assert.equal(api.formActive(fld, api.formValues(f.spec, { B: "x" })), false);  // one breaks => inactive
});

test("x-forge-when value coercion: numeric requiredValue compares by String", () => {
  const f = api.parseEnvelope({
    type: "object", "x-forge-name": "x",
    properties: {
      N: { type: "integer", default: "3" },
      D: { type: "string", "x-forge-when": { N: 3 } }, // numeric in spec → coerced to "3"
    },
  });
  const fld = api.formFields(f.spec).find((x) => x.key === "D");
  assert.equal(fld.when.N, "3");
  assert.equal(api.formActive(fld, api.formValues(f.spec, { N: "3" })), true);
});
