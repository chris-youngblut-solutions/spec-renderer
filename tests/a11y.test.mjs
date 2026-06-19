/* a11y — accessibility wiring for form + view.
 * FORM: every rendered control has an id and an associated <label for> (or its
 * key is the label); aria-invalid flips true/false with validity; cards are
 * role=group/aria-labelledby; the export bar is a labelled toolbar.
 * VIEW: tabs are role=tab + aria-selected + roving tabindex; theme toggle has an
 * aria-label; table <th> carry scope=col; the transcript cell is a role=button.
 * Mirrors the form-boolean/form-smoke shim, extended with setAttribute/getAttribute
 * /focus so attr() is observable (the other test shims lack setAttribute, so attr()
 * no-ops there and those tests are unaffected). */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

/* ---- DOM shim (form-boolean shim + setAttribute/getAttribute/focus) ---- */
class El {
  constructor(tag) {
    this.tag = tag; this.className = ""; this._html = ""; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.onclick = null;
    this.value = ""; this.type = ""; this.checked = false; this._listeners = {};
    this._attrs = {};
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this._listeners[ev] || (this._listeners[ev] = [])).push(fn); }
  dispatch(ev, arg) { for (const fn of this._listeners[ev] || []) fn(arg); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  focus() {}
  remove() {}
  querySelector() { return new El("div"); }
  querySelectorAll() { return []; }
}
function walk(node, fn) { if (!node) return; fn(node); for (const c of node.children || []) walk(c, fn); }

function boot(html) {
  const registry = {};
  for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
    "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#drop", "#file",
    "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  registry["#embedded-spec"].textContent = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1];
  const dm = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/);
  if (dm) registry["#embedded-data"].textContent = dm[1];
  const lsStore = new Map();
  const ctx = {
    document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
    localStorage: { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, v), removeItem: (k) => lsStore.delete(k) },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return { registry, lsStore };
}

/* ====================== FORM ====================== */
const FORM_SPEC = `
type: "object"
x-forge-kind: "form"
x-forge-name: "a11y-form"
title: "A11y form"
required: ["HOST"]
properties:
  HOST:
    type: "string"
    title: "Host name"
    description: "the bind address"
    status: "fill"
  FEATURE_FLAG:
    type: "boolean"
    default: "false"
  MODE:
    type: "string"
    enum: ["a", "b"]
    default: "a"
`;

const form = boot(compile({ specText: FORM_SPEC, dataText: null }).html);

function controls(reg) {
  const out = [];
  walk(reg["#view"], (n) => { if (n.tag === "input" || n.tag === "select") out.push(n); });
  return out;
}

test("every rendered control gets a non-empty id", () => {
  const cs = controls(form.registry);
  assert.ok(cs.length >= 3); // HOST input, FEATURE_FLAG checkbox, MODE select
  for (const c of cs) assert.ok(c.getAttribute("id"), c.tag + " has an id");
});

test("control ids are unique", () => {
  const ids = controls(form.registry).map((c) => c.getAttribute("id"));
  assert.equal(new Set(ids).size, ids.length);
});

test("a titled field renders a <label for> matching its control id", () => {
  const host = controls(form.registry).find((c) => c.tag === "input" && c.type !== "checkbox");
  const id = host.getAttribute("id");
  const labelFor = new RegExp('<label class="label" for="' + id + '"');
  let found = false;
  walk(form.registry["#view"], (n) => { if ((n._html || "").match(labelFor)) found = true; });
  assert.ok(found, "label[for] points at the control id");
});

test("an untitled field uses its key span as the <label for>", () => {
  let found = false;
  walk(form.registry["#view"], (n) => { if ((n._html || "").match(/<label class="key" for="f-FEATURE_FLAG/)) found = true; });
  assert.ok(found);
});

test("controls carry aria-describedby pointing at their err node", () => {
  for (const c of controls(form.registry)) {
    const db = c.getAttribute("aria-describedby");
    const id = c.getAttribute("id");
    assert.ok(db && db.indexOf(id + "-err") >= 0, "describedby includes the err id");
  }
});

test("aria-invalid is 'true' on an empty required field, 'false' once filled", () => {
  const host = controls(form.registry).find((c) => c.getAttribute("id") === "f-HOST-0");
  assert.equal(host.getAttribute("aria-invalid"), "true");
  host.value = "localhost";
  host.dispatch("input");
  assert.equal(host.getAttribute("aria-invalid"), "false");
  host.value = "";
  host.dispatch("input");
  assert.equal(host.getAttribute("aria-invalid"), "true");
});

test("cards are role=group labelled by their title", () => {
  const cards = form.registry["#view"].children;
  assert.ok(cards.length >= 1);
  for (const card of cards) {
    assert.equal(card.getAttribute("role"), "group");
    const labelledby = card.getAttribute("aria-labelledby");
    assert.ok(labelledby, "card has aria-labelledby");
    const title = card.children.find((ch) => ch.getAttribute && ch.getAttribute("id") === labelledby);
    assert.ok(title, "the labelledby id resolves to a child title node");
  }
});

test("export bar is a labelled toolbar; the four buttons keep their text names", () => {
  const bar = form.registry["#bar"];
  assert.equal(bar.getAttribute("role"), "toolbar");
  assert.ok(bar.getAttribute("aria-label"));
  for (const id of ["dlEnv", "dlSecret", "dlJson", "dlAll"]) assert.match(bar._html, new RegExp(id));
  assert.match(bar._html, /variables\.env/);
});

test("theme toggle gets an aria-label once the theme is applied", () => {
  const tb = form.registry["#themeBtn"];
  if (tb.onclick) tb.onclick(); // toggleTheme -> applyTheme sets the label
  assert.ok(tb.getAttribute("aria-label"));
});

/* ====================== VIEW ====================== */
const VIEW_SPEC = `
kind: "view"
name: "a11y-view"
adapters: ["eval-scoring"]
views:
  - key: "overview"
    label: "Overview"
    select: {domain: true, run: "after"}
    widgets:
      - {widget: "case-table", source: "card"}
  - key: "second"
    label: "Second"
    select: {domain: true, run: "after"}
    widgets:
      - {widget: "heading", value: "$domain"}
`;
const VIEW_DATA = JSON.stringify({
  generated: "20260619", harness_commit: "deadbeef",
  domains: { generic: {
    runs: { "20260619-000000-generic-replay": { run_id: "20260619-000000-generic-replay", cases: [{ case_id: "c1", score: 1, passed: true, stop_reason: "done", turns: 2 }] } },
    transcripts: { c1: [{ role: "user", content: "hi" }] },
  } },
});

const view = boot(compile({ specText: VIEW_SPEC, dataText: VIEW_DATA }).html);
const reactivateOverview = () => { const ov = view.registry["#tabs"].children.find((t) => (t._html || "") === "Overview"); if (ov && ov.onclick) ov.onclick(); };

test("tabs are role=tablist with role=tab children", () => {
  const nav = view.registry["#tabs"];
  assert.equal(nav.getAttribute("role"), "tablist");
  assert.equal(nav.children.length, 2);
  for (const t of nav.children) assert.equal(t.getAttribute("role"), "tab");
});

test("the active tab carries aria-selected=true and tabindex=0; others -1", () => {
  const tabs = view.registry["#tabs"].children;
  const active = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
  assert.equal(active.length, 1);
  assert.equal(active[0].getAttribute("tabindex"), "0");
  const inactive = tabs.filter((t) => t.getAttribute("aria-selected") === "false");
  assert.equal(inactive.length, 1);
  assert.equal(inactive[0].getAttribute("tabindex"), "-1");
});

test("ArrowRight on a tab activates the next view (aria-selected moves)", () => {
  const before = view.registry["#tabs"].children.findIndex((t) => t.getAttribute("aria-selected") === "true");
  view.registry["#tabs"].children[before].dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  const after = view.registry["#tabs"].children.findIndex((t) => t.getAttribute("aria-selected") === "true");
  assert.notEqual(after, before);
  reactivateOverview();
});

test("case-table headers carry scope=col", () => {
  reactivateOverview();
  const ths = [];
  walk(view.registry["#view"], (n) => { if (n.tag === "th") ths.push(n); });
  assert.ok(ths.length >= 1, "headers rendered");
  assert.ok(ths.every((th) => th.getAttribute("scope") === "col"), "every th has scope=col");
});

test("the transcript cell is a keyboard-activable role=button", () => {
  reactivateOverview();
  let found = false;
  walk(view.registry["#view"], (n) => { if ((n._html || "").indexOf('role="button"') >= 0 && (n._html || "").indexOf("data-case") >= 0) found = true; });
  assert.ok(found, "transcript span is role=button with a data-case");
});

/* ---- regression guard: a11y wiring does not change exports ---- */
const api = loadEngineApi();
test("a11y wiring does not change exports", () => {
  const env = api.parseEnvelope(api.parseSpecText(FORM_SPEC).data);
  const json = JSON.parse(api.formExportJson(env.spec, { HOST: "h", FEATURE_FLAG: "false", MODE: "a" }));
  assert.equal(json.HOST, "h");
  assert.equal(json.FEATURE_FLAG, "false");
});
