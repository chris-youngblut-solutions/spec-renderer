# Authoring spec-renderer specs

A spec is a single YAML, JSON, or markdown-with-frontmatter document. It declares
either a **form** (an intake form that exports `.env` / JSON) or a **view** (a
read-only dashboard over JSON data). `scripts/compile-spec.mjs` inlines a spec
(and, for views, a data file) with the engine into one self-contained HTML file;
the MCP server (`mcp-server/server.mjs`) serves the same output as a `ui://`
resource to an MCP host.

A spec is parsed to an envelope `{ kind, meta, spec }`:

- `kind` — `form` or `view`. Set it explicitly with `kind:` (views) or
  `x-forge-kind:` (forms), or let it be inferred (`type: object` + `properties`
  ⇒ form; `views`/`widgets` ⇒ view).
- `meta.name` — required. Used for the localStorage key and the export banner.
  In a form spec, set `x-forge-name`. In a view spec, set `name` (or
  `x-forge-name`).
- `meta.title` — optional display title (`title:`).

## Form specs

A form spec is a JSON Schema object (a subset) plus extension keywords the
renderer reads and standard validators ignore.

**Supported JSON Schema:** `type: object`, `properties`, `required` (the array of
property keys that must be filled), and per-property `type`
(`string`/`integer`/`boolean`), `format` (`ipv4` / `email` / `uri`), `enum`,
`default`, `title` (the field label), `description` (help text).

**Extension keywords (per property):**

| keyword | values | effect |
|---|---|---|
| `status` | `known` / `default` / `fill` / `scoped-out` | badge + lifecycle. `scoped-out` excludes the field from rendering and from all exports. |
| `secret` | `true` | routes the field to the secrets export and renders a password input. |
| `group` | a group id | which group the field renders under. |

**Top-level extensions:** `x-forge-name`, `x-forge-version`, `x-forge-outputs`
(`[env, json]`), `x-forge-groups` (`[{id, title, note?}]` — group order +
headings), and optional banner overrides `x-forge-env-banner` /
`x-forge-secret-banner` / `x-forge-secret-banner-all` (used as the file headers;
default to a generic spec-renderer banner).

A field is **required** iff its key is in `required[]`. Field order within a
group, and group order, are taken from property insertion order and
`x-forge-groups` order — both are load-bearing for export ordering. All values
are treated as strings (a `type: integer` field validates as an integer but its
value travels as a string; quote numeric `default`s so they stay strings).

**Exports:** `variables.env` (public fields, `KEY=value`, dotenv quoting),
`variables-secrets.env` (secret fields), `variables.json` (public fields only).

```yaml
type: object
x-forge-kind: form
x-forge-name: webapp-env
title: Web app environment
x-forge-outputs: [env, json]
x-forge-groups:
  - {id: server, title: Server}
  - {id: auth, title: Auth & secrets}
required: [PORT, SESSION_SECRET]
properties:
  PORT:
    type: integer
    default: "3000"
    status: fill
    group: server
  SESSION_SECRET:
    type: string
    secret: true
    status: fill
    group: auth
```

## View specs

A view spec declares a data source, the adapters it uses, and an ordered set of
views (tabs), each an ordered list of widgets.

- `adapters` — the named adapters this view calls (e.g. `[eval-scoring]`). The
  engine ships adapters; specs reference them, they do not define them.
- `views` — `[{key, label, select, widgets}]`. `select` is `{domain, run, case}`
  where `run` is `after` (one run picker), `both` (before+after), or omitted.
- `footer` — optional HTML footer string.

Data is a grouped bundle: `{domains: {<name>: {runs: {<run_id>: scorecard},
transcripts: {<case_id>: turn[]}}}}`, supplied via `--data` at compile time or
pushed by an MCP host.

**Widget catalog:** `heading`, `caption`, `chips`, `stat-cards`,
`hard-gate-banner`, `metric-rollup` (hand-rolled SVG bars), `case-table`,
`regression-diff`, `transcript` (the plan-act-observe timeline), `cross-grid`.

**Bindings** appear in widget parameters and resolve against the current render
context (`card`, `before`, `after`, `transcript`, `domain`, `caseId`,
`dataset`). Three forms only:

- `{path}` — a dotted lookup, e.g. `{card.run_id}`.
- `$name` — a selector value, e.g. `$domain`.
- `adapter.fn(args)` — a named adapter call whose args are context keys, e.g.
  `eval-scoring.passedCount(card)`.

```yaml
kind: view
name: eval-dashboard
adapters: [eval-scoring]
views:
  - key: overview
    label: Overview
    select: {domain: true, run: after}
    widgets:
      - {widget: heading, value: "$domain"}
      - widget: stat-cards
        cards:
          - {value: "eval-scoring.passedCount(card)", denom: "{card.cases.length}", label: cases passed}
      - {widget: case-table, source: card}
```

## Anti-patterns

- **No logic in bindings.** Bindings are lookups, selectors, and named adapter
  calls — not expressions. No arithmetic, conditionals, or string building. If a
  value needs computing, it belongs in an adapter.
- **No new widgets or exporters in a spec.** The widget set and the export
  formats are fixed in the engine. A new widget or output format is an engine
  change, not a spec keyword.
- **No adapter code in a spec.** Adapters are named and shipped by the engine
  (not auto-discovered) — this is a security boundary for dropped specs.
- **No nested-layout language.** Views are flat ordered widget lists. Composite
  widgets (`transcript`, `case-table`, `cross-grid`) take one data binding and
  render their own fixed structure; they are not containers you nest into.

## Compiling

```sh
just compile specs/<spec>.yaml out.html                              # a form (no data)
node scripts/compile-spec.mjs specs/<view>.yaml --data data.json -o out.html   # a view (with data)
node scripts/compile-spec.mjs --blank -o render.html                 # generic "bring your own spec"
```

The output is single-file, offline, and CSP-clean. `render.html` ships with an
empty spec and accepts a dropped/pasted spec or `?spec=URL` (`&data=URL`).
