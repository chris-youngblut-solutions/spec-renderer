#!/usr/bin/env node
/* spec-renderer MCP server — MCP Apps (SEP-1865) integration.
 *
 * Exposes the spec-renderer engine to an MCP host: the baked single-file
 * renderers (config-forge, eval-dashboard) and on-demand render_form /
 * render_view tools are surfaced as `ui://` resources with mimeType
 * `text/html;profile=mcp-app`, so an LLM can render a form or dashboard live
 * inside Claude/ChatGPT from a spec.
 *
 * Dependency-free: hand-rolled JSON-RPC 2.0 over newline-delimited stdio (the
 * project's no-deps ethos; the rendered artifact stays build-free). The pure
 * dispatcher createServer().handle(req) is unit-tested without any transport.
 *
 * Contract verified 2026-06-17 against the live SEP-1865 spec
 * (modelcontextprotocol/ext-apps specification/2026-01-26/apps.mdx + the MCP
 * Apps blog): ui:// scheme, text/html;profile=mcp-app, _meta.ui.csp
 * (connectDomains/resourceDomains/frameDomains/baseUriDomains) + prefersBorder,
 * tool->UI via _meta.ui.resourceUri, handshake ui/initialize ->
 * McpUiInitializeResult -> ui/notifications/initialized, tool data via
 * ui/notifications/tool-result, View->Host ui/message; ext id
 * io.modelcontextprotocol/ui.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI_MIME = "text/html;profile=mcp-app";
const UI_EXT = "io.modelcontextprotocol/ui";
const PROTOCOL = "2026-01-26";

/* CSP for an offline, self-contained artifact: no external connections of any
 * kind (everything is inlined). Matches the renderer's CSP-clean invariant. */
function uiMeta() {
  return { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }, prefersBorder: true } };
}
function rpcError(code, message) { const e = new Error(message); e.rpc = { code, message }; return e; }

export function createServer() {
  const dynamic = new Map(); // ui:// uri -> { html, name }
  let counter = 0;

  function baked() {
    const out = [];
    for (const [name, file] of [["eval-dashboard", "eval-dashboard.html"]]) {
      const p = join(ROOT, file);
      if (existsSync(p)) out.push({ uri: "ui://spec-renderer/" + name, name, file: p });
    }
    return out;
  }

  // Only the baked renderers are listable. Dynamic render_form/render_view
  // outputs are tool-result artifacts delivered via _meta.ui.resourceUri and
  // read by uri — not advertised in resources/list (so no resources/list_changed
  // churn, and the dynamic Map can be bounded without a visible list shrinking).
  function listResources() {
    return { resources: baked().map((b) => ({ uri: b.uri, name: b.name, mimeType: UI_MIME, _meta: uiMeta() })) };
  }

  function readResource(uri) {
    for (const b of baked()) if (b.uri === uri) return { contents: [{ uri, mimeType: UI_MIME, text: readFileSync(b.file, "utf8"), _meta: uiMeta() }] };
    if (dynamic.has(uri)) { const r = dynamic.get(uri); return { contents: [{ uri, mimeType: UI_MIME, text: r.html, _meta: uiMeta() }] }; }
    throw rpcError(-32602, "unknown resource: " + uri);
  }

  const TOOLS = [
    {
      name: "render_form",
      description: "Compile a FORM spec (JSON-Schema subset + x-forge extensions) into a self-contained UI; returns a ui:// resource the host renders. The submitted values come back via the host's ui/message channel.",
      inputSchema: { type: "object", required: ["spec"], properties: { spec: { type: "string", description: "form spec text (YAML / JSON / markdown-with-frontmatter)" }, data: { type: "string", description: "optional JSON data" } } },
      _meta: uiMeta(),
    },
    {
      name: "render_view",
      description: "Compile a VIEW spec into a self-contained dashboard UI; returns a ui:// resource the host renders.",
      inputSchema: { type: "object", required: ["spec"], properties: { spec: { type: "string", description: "view spec text (YAML / JSON / markdown-with-frontmatter)" }, data: { type: "string", description: "optional JSON dataset" } } },
      _meta: uiMeta(),
    },
  ];

  function callTool(name, args) {
    const want = name === "render_form" ? "form" : name === "render_view" ? "view" : null;
    if (!want) throw rpcError(-32602, "unknown tool: " + name);
    if (args.spec == null) throw rpcError(-32602, "missing required argument: spec");
    let compiled;
    try { compiled = compile({ specText: args.spec, dataText: args.data != null ? args.data : null }); }
    catch (e) { throw rpcError(-32602, "spec failed to compile: " + e.message); }
    if (compiled.env.kind !== want) throw rpcError(-32602, "spec kind '" + compiled.env.kind + "' does not match " + name);
    const uri = "ui://spec-renderer/" + want + "-" + (++counter);
    dynamic.set(uri, { html: compiled.html, name: compiled.env.meta.name || want });
    while (dynamic.size > 64) dynamic.delete(dynamic.keys().next().value); // FIFO cap — bound memory across the server's lifetime
    return {
      content: [{ type: "text", text: "Rendered " + want + " '" + (compiled.env.meta.name || "") + "' as " + uri }],
      _meta: { ui: { resourceUri: uri } },
    };
  }

  function handle(req) {
    if (!req || typeof req !== "object" || Array.isArray(req) || typeof req.method !== "string") {
      return { jsonrpc: "2.0", id: req && typeof req === "object" ? (req.id != null ? req.id : null) : null, error: { code: -32600, message: "Invalid Request" } };
    }
    const { id, method, params } = req;
    if (method.indexOf("notifications/") === 0) return null; // notifications get no response
    const need = (p) => { if (!p || typeof p !== "object") throw rpcError(-32602, "missing params"); return p; };
    try {
      let result;
      switch (method) {
        case "initialize":
          result = {
            protocolVersion: params && params.protocolVersion === PROTOCOL ? params.protocolVersion : PROTOCOL,
            capabilities: { resources: {}, tools: {}, extensions: { [UI_EXT]: {} } },
            serverInfo: { name: "spec-renderer", version: "0.1.0" },
          };
          break;
        case "ping": result = {}; break;
        case "resources/list": result = listResources(); break;
        case "resources/read": result = readResource(need(params).uri); break;
        case "tools/list": result = { tools: TOOLS }; break;
        case "tools/call": result = callTool(need(params).name, params.arguments || {}); break;
        default: throw rpcError(-32601, "method not found: " + method);
      }
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return { jsonrpc: "2.0", id, error: e.rpc || { code: -32603, message: String((e && e.message) || e) } };
    }
  }

  return { handle, listResources, readResource, callTool, TOOLS, dynamic };
}

/* newline-delimited JSON-RPC over stdio */
function main() {
  const srv = createServer();
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let req;
      try { req = JSON.parse(line); } catch (e) { continue; }
      const res = srv.handle(req);
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
