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
(`string`/`integer`/`number`/`boolean`/`array`), `format` (`ipv4` / `email` / `uri`
validators, or `textarea` for a multi-line input), `enum`, `default`, `title` (the
field label), `description` (help text). A `boolean` property (with no `enum`)
renders as a checkbox; its exported value is the string `"true"` or `"false"`, and an
unchecked box is the present value `"false"` (give a boolean a `default: "false"` so
an untouched field exports `"false"` rather than an empty string). A `string` property renders a
single-line text input by default; `format: textarea` (or the alias
`x-forge-multiline: true`) renders a multi-line `<textarea>` (newlines preserved). An
`array` property renders by its `items`: `items: {enum: [...]}` is a multi-select
**checkbox group**; `items: {type: string}` is a **one-value-per-line** list. Its
answer is a JSON array — exported as a real array in `variables.json` and a
comma-joined scalar in `variables.env`; `minItems` / `maxItems` constrain the count
and a required array must be non-empty.

**Validation keywords (per property):** `minimum` / `maximum` (inclusive bounds,
on `integer` and `number`); `minLength` / `maxLength` (string length); `pattern` (a
regular expression the string must match). `type: number` validates as a finite
number (accepts floats); `type: integer` stays integer-only. A `pattern` is compiled
once when the spec loads — an invalid regex is ignored, a catastrophic-backtracking
shape (a repetition over a group that itself contains an unbounded quantifier or an
alternation, e.g. `(a+)+` or `(a|a)+`) is rejected up front, and the regex is never
run over inputs longer than 4096 characters — three guards so a hostile `pattern` in
a dropped spec cannot freeze the renderer. (The shape guard is conservative — a safe
disjoint alternation like `(cat|dog)+` is rejected too; rewrite it without a
repetition over an alternation.) Values still travel as strings, so quote numeric
`default`s.

**Extension keywords (per property):**

| keyword | values | effect |
|---|---|---|
| `status` | `known` / `default` / `fill` / `scoped-out` | badge + lifecycle. `scoped-out` excludes the field from rendering and from all exports. |
| `secret` | `true` | routes the field to the secrets export and renders a password input. |
| `group` | a group id | which group the field renders under. |
| `x-forge-multiline` | `true` | render a multi-line `<textarea>` for a string field (alias for `format: textarea`). |
| `x-forge-when` | a flat map `{KEY: value, ...}` | conditional visibility. The field is shown only when, for **every** entry, the current value of property `KEY` equals `value` (string comparison; AND of equalities). A hidden field is excluded from validation and from all exports. Equality only — no operators, ranges, negation, or nesting. To gate on a checkbox, compare against `"true"` / `"false"`. |

**Top-level extensions:** `x-forge-name`, `x-forge-version`, `x-forge-outputs`
(which export buttons to offer — see **Exports** below), `x-forge-groups`
(`[{id, title, note?}]` — group order +
headings), and optional banner overrides `x-forge-env-banner` /
`x-forge-secret-banner` / `x-forge-secret-banner-all` (used as the file headers;
default to a generic spec-renderer banner).

A field is **required** iff its key is in `required[]`. Field order within a
group, and group order, are taken from property insertion order and
`x-forge-groups` order — both are load-bearing for export ordering. All values
are treated as strings (a `type: integer` field validates as an integer but its
value travels as a string; quote numeric `default`s so they stay strings).

**Conditional fields (`x-forge-when`).** A property may declare `x-forge-when` — a
flat map of `OTHER_KEY: requiredValue` pairs. The field is *active* only when every
controlling property's current value (its answer, or its `default` if untouched)
string-equals the required value. While inactive, its row is hidden and it is omitted
from validation counts and every export — like `scoped-out`, but recomputed live as
answers change. This is **equality only**; anything that is not a flat map of scalar
values is ignored (the field stays always-active). Author acyclic conditions (there
is no cycle detection).

### Prefilling a form (config editor)

A form spec compiled with `--data` becomes a config **editor**: the data file is a
flat `{key: value}` map (string values; arrays for array fields) that prefills the
form's initial answers. Precedence, highest first: **saved edits** (localStorage) >
**embedded `--data`** > the property **`default`**. A **Reset to provided** button
appears when the form was compiled with `--data`. The data map is interpolated only
into input values, never into markup. A shipped example pairs
`specs/example-app-env.form.yaml` with `specs/example-app-env.vars.json`:

```sh
node scripts/compile-spec.mjs specs/example-app-env.form.yaml \
  --data specs/example-app-env.vars.json -o example-app-env-prefilled.html
```

**Exports:** the form always offers `variables.env` (public fields, `KEY=value`,
dotenv quoting — multi-line values are emitted on one physical line with `\n`/`\r`/
`\t`/`\\` escaped), `variables-secrets.env` (secret fields, shown only when the form
has any), and `variables.json` (public fields only). `x-forge-outputs` opts a form
into additional public formats, each surfaced as an extra download button and included
in **Download all**:

| `x-forge-outputs` value | file | format |
|---|---|---|
| `env` | `variables.env` | dotenv (always on) |
| `json` | `variables.json` | JSON object (always on) |
| `env-annotated` | `variables.annotated.env` | dotenv with each `description` as a `# comment` and each group title as a `# == Section ==` header |
| `yaml` | `variables.yaml` | flat `key: value` YAML (values quoted so they parse back unchanged) |
| `toml` | `variables.toml` | flat `key = "value"` TOML |

In **every** public format, secret fields are excluded and routed to
`variables-secrets.env`; values outside this vocabulary are ignored.

**MCP host submit-back.** When a form is rendered inside an MCP host (via the
`render_form` tool of `mcp-server/server.mjs`), the export bar shows an extra **Submit
to agent** button. Clicking it returns the assembled **public** answers (the
`variables.json` map; secrets excluded) to the host as a `ui/message`, so the agent
can consume the values and continue. Standalone (`file://`) renders never show Submit
and never call out. No spec keyword controls this; it is automatic and host-gated.

### Example gallery

Two shipped form specs demonstrate the form feature set end-to-end (compiled into
`dist/` by `just build`):

- `specs/survey.form.yaml` — a feedback survey: an `enum`, a `boolean` checkbox, an
  `array` multi-select, a `textarea` long answer, and a follow-up field gated by
  `x-forge-when`, organized into groups.
- `specs/settings.form.yaml` — a service settings panel: `secret` fields,
  `integer`/`number` with `minimum`/`maximum`, a `pattern`-validated string, and the
  annotated-env output.

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
`regression-diff`, `transcript` (the plan-act-observe timeline), `cross-grid`,
`trend` (a hand-rolled SVG line chart of score across a domain's runs).

`case-table` is interactive: it renders a case-id filter box (case-insensitive
substring) and sortable `case` / `score` / `turns` column headers (click to toggle
ascending/descending). The `trend` widget reads its series from the engine adapter
`eval-scoring.scoreTrend(dataset, domain)` (which returns `[{run_id, score, passed,
n}]` chronologically) — the widget holds no logic, in keeping with the
no-logic-in-bindings rule. Both behaviors are engine-owned and fixed; the spec
supplies only `{widget: ..., source: ...}`.

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

### Live data (opt-in)

By default a view is **fully offline**: its data is baked in at compile time (`--data`)
or pushed by an MCP host. A view may instead pull **live** updates from a read-only
internal endpoint by declaring `x-forge-datasource` (alias: `dataSource`):

```yaml
kind: view
name: eval-live
adapters: [eval-scoring]
x-forge-datasource:
  url: /api/eval-data        # absolute https URL, or a root-relative same-origin path
  mode: poll                 # poll (default) | sse
  intervalMs: 15000          # poll cadence; clamped to 1s..1h (default 15s)
  auth: session              # session (sends the user's cookies) | none (default)
views:
  - key: overview
    label: Overview
    select: {domain: true, run: after}
    widgets: [{widget: case-table, source: card}]
```

The engine fetches the endpoint, **validates the payload is a data bundle** (the same
`{domains: {...}}` shape `--data` uses), merges it, and re-renders — reusing the exact merge
path an MCP host push uses. `mode: sse` opens an `EventSource` and merges each event instead
of polling.

> **This is the one deliberate relaxation of the offline invariant.** With `x-forge-datasource`
> **absent**, a compiled view performs **zero network I/O** and stays the self-contained file it
> has always been. Only an explicit `x-forge-datasource` opts a view into a single, declared
> network egress.

**Security model — the browser never touches the database:**

- The dashboard fetches a **read-only internal endpoint** (a thin backend-for-frontend, or a
  pre-baked materialized view) that returns the bundle shape. The browser issues **no SQL** and
  never holds a database credential.
- **No credential is ever read from the spec or embedded in the artifact** — the file *is* the
  artifact, so anything in it is public. Authentication rides the **user's own session**
  (`auth: session` → `fetch(credentials: 'include')`) or **network membership** (a tailnet, or
  an access proxy such as Cloudflare Access / IAP in front of the endpoint).
- The compiled file carries a **CSP `connect-src` allowlist** locked to exactly the declared
  endpoint origin (a same-origin path locks to `'self'`). Every other compiled artifact is inert
  with `connect-src 'none'` — it can phone nobody. `script-src` is hash-pinned in all cases, so
  the artifact cannot be coerced into running injected script regardless.
- Recommended deployment: serve the dashboard and its endpoint behind a tailnet or an access
  proxy, so the endpoint has **zero public attack surface** and the `.html` holds nothing
  sensitive.

`x-forge-datasource` is **declarative connection data only**. Inside an MCP host the live fetch
is disabled (data still arrives via the host push). A live dashboard must be **served over
http(s)** — a `file://` page has no usable origin for credentialed cross-origin fetches.

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
  render their own fixed structure; they are not containers you nest into. Any
  interactivity a composite widget offers (e.g. `case-table`'s filter and column
  sort) is engine-owned and fixed — never declared, parameterized, or scripted by
  the spec.
- **No logic in `x-forge-when`.** Conditional visibility is a flat map of equality
  targets, never an expression. There are no `>`, `!=`, `or`, regex, or nested
  clauses. If a visibility rule needs real logic, it is an engine change (a named
  predicate), not a spec keyword.
- **No logic (or credentials) in `x-forge-datasource`.** It is declarative connection
  data — a URL, a mode, an interval, and an auth mode — never a query, a header set, a
  token, or an expression. Any credential key is ignored, by design (the artifact is
  public). The fetch/poll/SSE/merge is engine-owned; a different payload shape or auth
  scheme is an engine change, not a spec keyword.

## Compiling

```sh
just compile specs/<spec>.yaml out.html                              # a form (no prefill)
node scripts/compile-spec.mjs specs/<form>.yaml --data vars.json -o out.html   # a form, prefilled (config editor)
node scripts/compile-spec.mjs specs/<view>.yaml --data data.json -o out.html   # a view (with data)
node scripts/compile-spec.mjs specs/<spec>.yaml --theme cool-slate -o out.html # pick a theme pack
node scripts/compile-spec.mjs --blank -o render.html                 # generic "bring your own spec"
```

`--theme <pack>` selects the **theme pack** to inline — a bare name (a directory under
`themes/`, e.g. `cabin` or `cool-slate`), a pack directory, or a direct `.css` file. A
theme pack supplies the `--cabin-*` token vocabulary the engine's widget CSS consumes;
the default is Cabin. The widget styles use only tokens, so a conforming pack re-skins the
whole artifact with no other change. Packs stay offline (no `@import`/web fonts) — the
compiler rejects one that would break that. See `themes/THEMES.md`.

The output is single-file, offline, and CSP-clean (a hash-pinned `script-src`, and
`connect-src 'none'` unless a view opts into live data — see **Live data** above). The
sole exception is a view that declares `x-forge-datasource`, whose `connect-src` is locked
to that one endpoint. `render.html` ships with an empty spec and accepts a dropped/pasted
spec or `?spec=URL` (`&data=URL`); it keeps `connect-src` open for that loader but still
hash-pins `script-src`.

Pass `--watch` to recompile on every save while authoring (`just watch <spec> <out>`):
it compiles once, then rebuilds whenever the spec, the `--data` file, the selected
theme pack, or any engine source (`engine.js` / `engine.css` / `engine.html.tmpl`)
changes. Saves are debounced
(~100 ms); a spec error is logged without stopping the watch. It uses Node's built-in
`fs.watch` only — no dependencies. `--watch` requires a real spec (not `--blank`).

## Linting

`scripts/validate-spec.mjs` checks a spec against this contract before you compile it
(`just validate <spec>`). It parses with the same engine, runs the envelope validator,
then lints further. **Errors** (exit nonzero) are contract violations that misrender or
break export: bad `kind`; missing `name`; a form with no `properties`; a property
`group` that resolves to no `x-forge-groups` id; a `default` not in the property's
`enum`; a `required` key absent from `properties`; a `status` outside the enum; an
`x-forge-outputs` value outside the vocabulary; an `x-forge-when` referencing a
non-existent property. **Warnings** (exit zero) are likely mistakes: unknown top-level
keys, unknown per-property keywords, an unsupported `type`/`format`/`widget`. The
linter's allowlists mirror this document — keep them in lockstep.

## Generating a form spec from JSON Schema

`scripts/jsonschema-to-spec.mjs` downconverts a Draft-2020-12 JSON Schema
(`{type: object, properties}`) into the form-spec subset, and reports every keyword it
drops or approximates (`just convert-schema schema.json out.json`). It never emits a
keyword the renderer does not understand, so the result always validates as a form
envelope. **Mapped through:** scalar `type` (`string`/`integer`/`number`/`boolean`),
`enum`/`default`/`title`/`description`, `format` `ipv4`/`email`/`uri`,
`minimum`/`maximum`/`minLength`/`maxLength`/`pattern`, `required`, and an `array` whose
`items.enum` or `items.type:string` is set. **Dropped + flagged:** nested object
properties (form specs are flat), `oneOf`/`anyOf`/`allOf`/`not`, `$ref`/`$defs`,
`additionalProperties`, tuple `items`, `exclusiveMinimum`/`exclusiveMaximum`,
`multipleOf`, and any unrecognized `format`.

## Accessibility

The rendered output is keyboard- and screen-reader-navigable; you author the spec, the
engine handles the wiring (there is no keyword to enable or disable it).

- **Forms.** Every control gets a unique id and an associated `<label>` (the field
  `title`, or the property key when there is no title). Validation errors set
  `aria-invalid` on the control and are pointed at by `aria-describedby` (which also
  references the `description`). Each group card is a `role="group"` labelled by its
  title; the export buttons keep their text names inside a labelled toolbar, and the
  live field count is announced.
- **Views.** Tabs are a `role="tablist"` — Left/Right (or Up/Down), Home, End move
  between them and Enter/Space activates; only the active tab is in the tab order.
  Table headers carry `scope="col"`, and the "transcript →" affordance is an
  Enter/Space-activable button.
