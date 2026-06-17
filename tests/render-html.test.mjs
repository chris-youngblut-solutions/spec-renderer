/* Phase 4 — generic render.html ("bring your own spec").
 * Boots the blank renderer (empty embedded spec) under a DOM shim: it shows the
 * loader prompt, and pasting a spec drives loadSpecText -> mount -> render. This
 * exercises the full generic loader path (wireLoader -> pasteBtn -> render). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "render.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class El {
  constructor(tag) { this.tag = tag; this.className = ""; this._html = ""; this.textContent = ""; this.style = {}; this.dataset = {}; this.children = []; this.onclick = null; this.value = ""; this.classList = { add() {}, remove() {}, contains: () => false }; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {} remove() {} querySelector() { return null; } querySelectorAll() { return []; }
}
function serialize(n) { if (!n) return ""; let s = (n._html || "") + (n.textContent || ""); for (const c of n.children || []) s += serialize(c); return s; }

const registry = {};
for (const id of ["#tabs", "#pickers", "#themeBtn", "#view", "#subtitle", "#loader", "#bar", "#foot",
  "#drop", "#file", "#paste", "#pasteBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll",
  "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");

const store = new Map();
const ctx = {
  document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
};
vm.runInNewContext(code, ctx); // boot() -> empty embed -> loader prompt; wireLoader() armed

test("blank renderer shows the loader prompt", () => {
  assert.match(serialize(registry["#view"]), /No spec loaded/);
});

test("pasting a form spec renders the form", () => {
  registry["#paste"].value = "type: object\nx-forge-name: demo\ntitle: Demo Form\nproperties:\n  HOST:\n    type: string\n    status: fill\n  PORT:\n    type: integer\n    default: \"8080\"\n    status: default";
  assert.ok(typeof registry["#pasteBtn"].onclick === "function", "pasteBtn wired by wireLoader");
  registry["#pasteBtn"].onclick();
  const view = serialize(registry["#view"]);
  assert.match(view, /HOST/);
  assert.match(view, /PORT/);
  assert.match(view, /b-fill/); // status badge -> it's a form
});
