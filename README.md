# spec-renderer

A no-build tool that compiles a markdown / YAML / JSON spec into a single, self-contained HTML form or read-only dashboard.

## What it does

Takes a spec — declared as markdown / YAML / JSON, and LLM-authorable — and
renders either a config-intake **form** or a read-only **dashboard**, compiled to
a single self-contained HTML file: no build step, no dependencies, works offline
(`file://`). One engine renders both kinds. A spec can also be served to an MCP
host as a `ui://` resource. The repo ships a web-app `.env` form, a survey form, a
settings panel, an agentic-eval-harness dashboard, and `render.html` — a blank
renderer you drop your own spec into.

## How it works

- **`engine.js`** — the whole engine as one classic script: a dependency-free
  YAML-subset parser, the spec envelope, the shell (DOM helpers, Cabin theming,
  loaders), the form + view renderers, and a named adapter registry. It runs
  inlined in the browser and, unchanged, under `node:vm` for tests (pure
  functions are exposed via `module.exports`; `boot()` runs only when a document
  is present).
- **`engine.css`** — Cabin day/night theme tokens + widget styles. No
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

- **`form`** — a JSON-Schema subset: per-property `type`
  (`string`/`integer`/`number`/`boolean`/`array`), `enum`, `required`,
  `properties`, `format` (`ipv4`/`email`/`uri`, or `textarea`), `title`,
  `description`, and the validation keywords `minimum`/`maximum`/`minLength`/
  `maxLength`/`pattern` — **plus** inline extension keywords the renderer reads and
  standard validators ignore: `status` (`known`/`default`/`fill`/`scoped-out`),
  `secret`, `group`, `x-forge-multiline`, `x-forge-when` (declarative conditional
  visibility), and top-level `x-forge-*`. Booleans render as checkboxes, arrays as
  multi-select / list widgets. Forms validate, persist edits locally, prefill from
  `--data` (config editor), and export `.env` / JSON / YAML / TOML / annotated-env.
- **`view`** — a fixed widget catalog (`heading`, `caption`, `chips`, `stat-cards`,
  `hard-gate-banner`, `metric-rollup` [hand-rolled SVG bars], `case-table` [with
  filter + sortable columns], `regression-diff`, `transcript`, `cross-grid`, `trend`
  [hand-rolled SVG line chart]); bindings are lookups + named `adapter.fn` only, and
  all computation lives in a named engine adapter (e.g. `eval-scoring`), never in the
  spec.

## MCP Apps

`mcp-server/server.mjs` is a dependency-free MCP server (JSON-RPC over stdio)
implementing the MCP Apps extension (SEP-1865). It exposes the renderers as
`ui://` resources (`text/html;profile=mcp-app`) and `render_form` / `render_view`
tools, so an MCP host can render a form or dashboard from a spec. The engine does
the `ui/initialize` handshake and accepts host-pushed data when embedded in a
host, and a rendered form shows a **Submit to agent** button that returns the
assembled public answers to the host (secrets excluded). It runs fully standalone
otherwise.

## Build

```sh
just test                          # the node:test suite (no deps, no browser)
just compile <spec> <out.html>     # inline one spec to a self-contained HTML
just watch <spec> <out.html>       # recompile on every save (fs.watch, no deps)
just validate <spec>               # lint a spec against the authoring contract
just convert-schema <schema> <out> # downconvert a JSON Schema into a form spec
just embed                         # compile the shipped examples
just build                         # compile + copy the artifacts into dist/
just mcp                           # run the MCP Apps server over stdio
```

Outputs are single-file, offline, and CSP-clean. `render.html` ships with an
empty spec and accepts a dropped / pasted spec or `?spec=URL` (`&data=URL`).
Authoring guide: `SPEC.md`; use cases: `USECASES.md`. The dependency-free
`node:test` suite runs with `just test` (`node --test`; several cases are
generated from fixture tables).

## Status

Shipped public at 0.1.0 (SemVer; Decision 5). Built: the single-file engine
(`engine.js`/`engine.css`/`engine.html.tmpl`), `form` and `view` renderers, the
`compile-spec.mjs` author-time compiler (with `--watch`), a spec linter
(`validate-spec.mjs`) and a JSON-Schema → form-spec converter
(`jsonschema-to-spec.mjs`), the `render.html` drop-in renderer, the MCP Apps server
(`mcp-server/server.mjs`, SEP-1865, with form submit-back), and the dependency-free
`node:test` suite. Shipped examples (the two ancestors spec-renderer generalizes plus a
feature gallery): a `config-forge` infrastructure-bootstrap **form** and the
agentic-eval-harness **view** dashboard — the config-intake renderer and the eval viewer
that spec-renderer folds into one engine — alongside a web-app `.env` form, a survey form,
and a settings panel.

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
