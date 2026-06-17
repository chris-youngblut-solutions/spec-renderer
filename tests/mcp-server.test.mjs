/* Phase 3 — MCP server (SEP-1865) contract.
 * Drives the pure JSON-RPC dispatcher (no transport) and asserts the MCP Apps
 * contract: ui:// resources at text/html;profile=mcp-app with _meta.ui, the
 * render_form / render_view tools, and that calling a tool compiles a fresh
 * ui:// resource referenced via _meta.ui.resourceUri and readable back. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "../mcp-server/server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI_MIME = "text/html;profile=mcp-app";
const formSpec = readFileSync(join(ROOT, "specs", "example-app-env.form.yaml"), "utf8");
const viewSpec = readFileSync(join(ROOT, "specs", "eval.view.yaml"), "utf8");
const viewData = readFileSync(join(ROOT, "data", "eval-sample.json"), "utf8");

const rpc = (srv, method, params, id = 1) => srv.handle({ jsonrpc: "2.0", id, method, params });

test("initialize negotiates the MCP Apps extension", () => {
  const r = rpc(createServer(), "initialize", { protocolVersion: "2026-01-26" }).result;
  assert.equal(r.protocolVersion, "2026-01-26");
  assert.ok(r.capabilities.extensions["io.modelcontextprotocol/ui"], "ui extension declared");
  assert.ok(r.capabilities.resources && r.capabilities.tools);
  assert.equal(r.serverInfo.name, "spec-renderer");
});

test("notifications get no response", () => {
  assert.equal(createServer().handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("resources/list exposes baked ui:// renderers with mcp-app mime + _meta.ui", () => {
  const r = rpc(createServer(), "resources/list").result;
  const uris = r.resources.map((x) => x.uri);
  assert.ok(uris.includes("ui://spec-renderer/eval-dashboard"));
  for (const res of r.resources) {
    assert.equal(res.mimeType, UI_MIME);
    assert.deepEqual(Object.keys(res._meta.ui.csp).sort(), ["baseUriDomains", "connectDomains", "frameDomains", "resourceDomains"]);
    assert.equal(res._meta.ui.prefersBorder, true);
  }
});

test("resources/read returns the compiled HTML body at the mcp-app mime", () => {
  const r = rpc(createServer(), "resources/read", { uri: "ui://spec-renderer/eval-dashboard" }).result;
  assert.equal(r.contents[0].mimeType, UI_MIME);
  assert.match(r.contents[0].text, /function parseYaml/);     // the inlined engine
  assert.match(r.contents[0].text, /embedded-spec/);
});

test("resources/read on an unknown uri errors", () => {
  const r = rpc(createServer(), "resources/read", { uri: "ui://nope" });
  assert.ok(r.error && /unknown resource/.test(r.error.message));
});

test("tools/list declares render_form + render_view", () => {
  const r = rpc(createServer(), "tools/list").result;
  const names = r.tools.map((t) => t.name);
  assert.deepEqual(names.sort(), ["render_form", "render_view"]);
  for (const t of r.tools) assert.ok(t.inputSchema.required.includes("spec"));
});

test("tools/call render_view compiles a fresh ui:// resource, referenced + readable", () => {
  const srv = createServer();
  const call = rpc(srv, "tools/call", { name: "render_view", arguments: { spec: viewSpec, data: viewData } }).result;
  const uri = call._meta.ui.resourceUri;
  assert.match(uri, /^ui:\/\/spec-renderer\/view-\d+$/);
  const read = rpc(srv, "resources/read", { uri }).result;
  assert.equal(read.contents[0].mimeType, UI_MIME);
  assert.match(read.contents[0].text, /agentic-eval-harness/);
});

test("tools/call render_form compiles the example form", () => {
  const srv = createServer();
  const call = rpc(srv, "tools/call", { name: "render_form", arguments: { spec: formSpec } }).result;
  assert.match(call._meta.ui.resourceUri, /^ui:\/\/spec-renderer\/form-\d+$/);
  const read = rpc(srv, "resources/read", { uri: call._meta.ui.resourceUri }).result;
  assert.match(read.contents[0].text, /webapp-env/);
});

test("tools/call rejects a kind mismatch (view spec to render_form)", () => {
  const r = rpc(createServer(), "tools/call", { name: "render_form", arguments: { spec: viewSpec, data: viewData } });
  assert.ok(r.error && /does not match render_form/.test(r.error.message));
});

test("tools/call rejects an invalid spec", () => {
  const r = rpc(createServer(), "tools/call", { name: "render_view", arguments: { spec: "name: nope" } });
  assert.ok(r.error && /failed to compile/.test(r.error.message));
});

test("unknown method -> method not found", () => {
  const r = rpc(createServer(), "frobnicate", {});
  assert.equal(r.error.code, -32601);
});
