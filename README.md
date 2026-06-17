# spec-renderer

One single-file, no-build, offline HTML renderer that an LLM drives from a
markdown / YAML / JSON **spec**. One engine renders two kinds of spec — a
**form** (a config-intake form that exports `.env` / JSON) and a **view** (a
read-only dashboard over JSON data). A spec compiles to a single self-contained
HTML file, or is served to an MCP host as a `ui://` resource. The repo ships a
web-app `.env` form example, an agentic-eval-harness dashboard, and a generic
"bring your own spec" renderer.

## How it works

- **`engine.js`** — the whole engine as one classic script: a dependency-free
  YAML-subset parser, the spec envelope, the shell (DOM helpers, Cabin theming,
  loaders), the form + view renderers, and a named adapter registry. It runs
  inlined in the browser and, unchanged, under `node:vm` for tests (pure
  functions are exposed via `module.exports`; `boot()` runs only when a document
  is present).
- **`engine.css`** — in^loop Cabin day/night tokens + widget styles. No
  `@import`, no web fonts — offline / CSP-clean.
- **`engine.html.tmpl`** — the skeleton, with splice points for CSS, JS, the
  embedded spec, and optional embedded data. The engine's logic is the single
  **attribute-less** `<script>`; the embedded spec/data tags carry attributes so
  the test harness's extraction regex skips them.
- **`scripts/compile-spec.mjs`** — author-time: inlines engine + spec (+ data)
  into one self-contained HTML. It parses the spec with the *same* `engine.js`
  (under `node:vm`), so author-time and runtime YAML parsing are identical. JSON
  payloads are embedded with `</` → `<\/` so a value containing `</script>` can
  never close the tag early.

## Spec kinds

- **`form`** — a JSON-Schema subset (`type`/`enum`/`required`/`properties`/
  `pattern`/`format`/`title`/`description`) **plus** inline extension keywords
  the renderer reads and standard validators ignore: `status`
  (`known`/`default`/`fill`/`scoped-out`), `secret`, `group`, `help`, and
  top-level `x-forge-*`. Valid JSON Schema, with a dual-use config-intake
  workflow (status/secret/grouping/exports) layered on top.
- **`view`** — a small bespoke widget vocabulary (stat-cards, banner, metric-bars
  [hand-rolled SVG], table, diff-table, timeline, cross-grid, key-value);
  bindings are lookups + named `adapter.fn` only. The eval recompute logic is the
  named `eval-scoring` adapter.

## MCP Apps

`mcp-server/server.mjs` is a dependency-free MCP server (JSON-RPC over stdio)
implementing the MCP Apps extension (SEP-1865). It exposes the renderers as
`ui://` resources (`text/html;profile=mcp-app`) and `render_form` / `render_view`
tools, so an MCP host can render a form or dashboard from a spec. The engine does
the `ui/initialize` handshake and accepts host-pushed data when embedded in a
host, and runs fully standalone otherwise.

## Build

```sh
just test                          # all node:test files (no deps, no browser)
just compile <spec> <out.html>     # inline one spec to a self-contained HTML
just embed                         # compile the shipped examples
just mcp                           # run the MCP Apps server over stdio
```

Outputs are single-file, offline, and CSP-clean. `render.html` ships with an
empty spec and accepts a dropped / pasted spec or `?spec=URL` (`&data=URL`).
Authoring guide: `SPEC.md`. **118 dependency-free tests** (`just test`).


## License

Licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or
  <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or
  <http://opensource.org/licenses/MIT>)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally
submitted for inclusion in this project by you, as defined in the
Apache-2.0 license, shall be dual licensed as above, without any
additional terms or conditions.
