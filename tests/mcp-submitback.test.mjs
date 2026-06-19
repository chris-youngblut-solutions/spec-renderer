/* MCP form submit-back (SEP-1865). Boots a compiled FORM inside a mocked MCP host
 * (window.parent !== window) and verifies: a host-only "Submit to agent" button is
 * rendered; clicking it sends a View->Host ui/message whose params carry the PUBLIC
 * answers map as structuredContent (secrets excluded) plus a content[] text mirror
 * and the form-submit _meta tag; and that standalone (no host) renders no Submit
 * button and posts nothing. Mirrors mcp-bridge.test.mjs's host mock. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { compile } from "../scripts/compile-spec.mjs";

const SPEC = `
type: "object"
x-forge-kind: "form"
x-forge-name: "submitback-demo"
title: "Submit-back demo"
x-forge-outputs: ["env", "json"]
properties:
  PORT:
    type: "integer"
    default: "3000"
  API_KEY:
    type: "string"
    secret: true
    default: "shhh"
`;

const { html } = compile({ specText: SPEC, dataText: null });
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const embeddedSpec = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1].trim();

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

function setup(hosted) {
  // pre-seed the bar-button ids so the post-innerHTML $("#id") lookups resolve to
  // real (clickable) elements (the shim's innerHTML setter does not parse children).
  const registry = {};
  for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
    "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#formSubmit",
    "#drop", "#file", "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  registry["#embedded-spec"].textContent = embeddedSpec;
  const documentMock = {
    createElement: (t) => new El(t),
    querySelector: (s) => (s in registry ? registry[s] : new El("div")),
    documentElement: { dataset: {} }, body: { appendChild() {} },
  };
  const store = new Map();
  const sent = [];
  const self = {};
  const windowMock = {
    parent: hosted ? { postMessage: (m) => sent.push(m) } : self,
    addEventListener: () => {},
    postMessage() {},
  };
  if (!hosted) windowMock.parent = windowMock;
  const ctx = {
    document: documentMock, window: windowMock,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(code, ctx);
  return { registry, sent };
}

test("hosted: a Submit-to-agent button is rendered + wired in the form bar", () => {
  const { registry } = setup(true);
  assert.match(registry["#bar"].innerHTML, /id="formSubmit"/);
  assert.equal(typeof registry["#formSubmit"].onclick, "function");
});

test("standalone (no host): no Submit button, nothing posted", () => {
  const { registry, sent } = setup(false);
  assert.doesNotMatch(registry["#bar"].innerHTML, /formSubmit/);
  assert.equal(sent.length, 0);
});

test("hosted: clicking Submit posts a ui/message with the public answers map (secrets excluded)", () => {
  const { registry, sent } = setup(true);
  const before = sent.length;
  registry["#formSubmit"].onclick();
  const msgs = sent.slice(before).filter((m) => m.method === "ui/message");
  assert.equal(msgs.length, 1, "exactly one ui/message on submit");
  const p = msgs[0].params;
  assert.equal(p.structuredContent.PORT, "3000");
  assert.ok(!("API_KEY" in p.structuredContent), "secret field excluded from submit map");
});

test("hosted: the submit ui/message carries a content[] text mirror + the form-submit tag", () => {
  const { registry, sent } = setup(true);
  registry["#formSubmit"].onclick();
  const msg = sent.filter((m) => m.method === "ui/message").pop();
  const p = msg.params;
  assert.ok(Array.isArray(p.content) && p.content[0].type === "text");
  assert.match(p.content[0].text, /"PORT": "3000"/);  // == variables.json bytes
  assert.doesNotMatch(p.content[0].text, /API_KEY/);   // secrets not in the public json either
  assert.equal(p._meta["io.modelcontextprotocol/ui"].kind, "form-submit");
});
