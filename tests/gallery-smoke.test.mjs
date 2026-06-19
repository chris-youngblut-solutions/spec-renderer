/* Phase 4 — example-gallery smoke (survey + settings).
 * Compiles each shipped gallery form spec, boots it under a DOM shim, and asserts
 * the form renders: group titles, representative field keys, status badges, the
 * subtitle, and the export bar. Mirrors tests/form-smoke.test.mjs exactly (same
 * shim shape, same boot pattern). These specs exercise the form feature set
 * (textarea / array / x-forge-when / min-max-pattern / annotated-env); the
 * assertions ride on field-key presence + wiring (robust regardless of widget kind). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compile } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

class El {
  constructor(tag) {
    this.tag = tag; this.className = ""; this._html = ""; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.onclick = null; this.value = "";
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  remove() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function serialize(node) {
  if (!node) return "";
  let s = (node._html || "") + (node.textContent || "");
  for (const c of node.children || []) s += serialize(c);
  return s;
}

function boot(specFile) {
  const specText = readFileSync(join(ROOT, "specs", specFile), "utf8");
  const { html } = compile({ specText, dataText: null });
  const registry = {};
  for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
    "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#drop", "#file",
    "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  registry["#embedded-spec"].textContent = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1];
  const store = new Map();
  const ctx = {
    document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return {
    view: serialize(registry["#view"]),
    subtitle: serialize(registry["#subtitle"]),
    bar: serialize(registry["#bar"]),
  };
}

/* ---- survey.form.yaml ---- */
const survey = boot("survey.form.yaml");

test("survey: enum field renders (ROLE)", () => assert.match(survey.view, /ROLE/));
test("survey: boolean field renders (WANTS_FOLLOWUP)", () => assert.match(survey.view, /WANTS_FOLLOWUP/));
test("survey: array multi-select field renders (CHANNELS)", () => assert.match(survey.view, /CHANNELS/));
test("survey: textarea long-answer field renders (COMMENTS)", () => assert.match(survey.view, /COMMENTS/));
test("survey: x-forge-when follow-up field renders (FOLLOWUP_EMAIL)", () => assert.match(survey.view, /FOLLOWUP_EMAIL/));
test("survey: group titles render", () => { assert.match(survey.view, /About you/); assert.match(survey.view, /Your feedback/); });
test("survey: status badges render", () => { assert.match(survey.view, /b-fill/); assert.match(survey.view, /b-default/); });
test("survey: subtitle from spec title", () => assert.match(survey.subtitle, /Product feedback survey/));
test("survey: export bar has the four download buttons", () => {
  for (const id of ["dlEnv", "dlSecret", "dlJson", "dlAll"]) assert.match(survey.bar, new RegExp(id));
});

/* ---- settings.form.yaml ---- */
const settings = boot("settings.form.yaml");

test("settings: pattern-validated field renders (SERVICE_NAME)", () => assert.match(settings.view, /SERVICE_NAME/));
test("settings: integer min/max field renders (MAX_WORKERS)", () => assert.match(settings.view, /MAX_WORKERS/));
test("settings: number min/max field renders (REQUEST_TIMEOUT)", () => assert.match(settings.view, /REQUEST_TIMEOUT/));
test("settings: secret field renders (API_TOKEN)", () => assert.match(settings.view, /API_TOKEN/));
// "Limits & timeouts" renders through esc() as "Limits &amp; timeouts", so assert the &-free substring.
test("settings: group titles render", () => { assert.match(settings.view, /Identity/); assert.match(settings.view, /Limits/); });
test("settings: subtitle from spec title", () => assert.match(settings.subtitle, /Service settings/));
test("settings: export bar has the four download buttons", () => {
  for (const id of ["dlEnv", "dlSecret", "dlJson", "dlAll"]) assert.match(settings.bar, new RegExp(id));
});
test("settings: annotated-env export button is present (x-forge-outputs: env-annotated)", () => {
  assert.match(settings.bar, /dlEnvAnn/);
});
