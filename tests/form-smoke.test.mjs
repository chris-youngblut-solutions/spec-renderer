/* Phase 1 — form render smoke (generic example).
 * Compiles the public example form spec, boots it under a DOM shim, and asserts
 * the form renders: group titles, field keys, status badges, and the export bar. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compile } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const specText = readFileSync(join(ROOT, "specs", "example-app-env.form.yaml"), "utf8");
const { html } = compile({ specText, dataText: null });

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
const view = serialize(registry["#view"]);

test("form renders a known/default field with its key", () => assert.match(view, /NODE_ENV/));
test("form renders an enum field", () => assert.match(view, /LOG_LEVEL/));
test("form renders a group title", () => assert.match(view, /Server/));
test("form renders status badges", () => { assert.match(view, /b-default/); assert.match(view, /b-fill/); });
test("form sets the subtitle from the spec title", () => assert.match(serialize(registry["#subtitle"]), /Web app environment/));
test("export bar has the four download buttons", () => {
  const bar = serialize(registry["#bar"]);
  for (const id of ["dlEnv", "dlSecret", "dlJson", "dlAll"]) assert.match(bar, new RegExp(id));
});
test("a secret field renders (password input path)", () => assert.match(view, /SESSION_SECRET/));
