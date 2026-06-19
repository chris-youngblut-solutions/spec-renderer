# Changelog

All notable changes to spec-renderer are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to SemVer (Decision 5).

This file is **machine-generated** by `git-cliff` from Conventional
Commits at release time. Manual edits will be overwritten — change the
commit messages instead, or edit `cliff.toml` to change the format.

## [Unreleased]

<!-- new entries land here on every commit; cleared at release time -->

### Added

- Boolean form fields (`type: boolean`, no `enum`) now render as a real HTML
  checkbox instead of a true/false `<select>`.
- Multi-line string form fields: `format: textarea` (or `x-forge-multiline: true`)
  renders a `<textarea>`; multi-line values export to `.env` on a single physical
  line with dotenv `\n` escaping.
- Form validation subset: `type: number` (float), `minimum`/`maximum`,
  `minLength`/`maxLength`, and a guarded `pattern` regex.
- Array form fields (`type: array`): `items.enum` renders a multi-select checkbox
  group, `items.type: string` renders a one-value-per-line list. Exports as a JSON
  array (`variables.json`) and a comma-joined scalar (`variables.env`).
- Conditional form fields: a property may declare `x-forge-when` (a flat
  `{KEY: value}` equality map) to show only when its controlling fields match; hidden
  fields are excluded from validation and all exports.
- Forms accept `--data` (a flat `{key: value}` map) to prefill initial answers,
  turning the renderer into a config editor (precedence: saved edits > `--data` >
  default; a "Reset to provided" button when `--data` was embedded).
- Richer form exports via `x-forge-outputs`: annotated `.env` (`env-annotated`), flat
  `yaml`, and flat `toml`; secrets stay routed to the secrets export, and the default
  env+json+secrets buttons are unchanged.
- A `trend` view widget — a hand-rolled SVG line chart of total score across a
  domain's runs — backed by the new `eval-scoring.scoreTrend` adapter.
- `case-table` views gain a client-side case-id filter box and sortable
  `case` / `score` / `turns` column headers (engine-owned; no spec change).
- Accessibility pass: form controls are labelled (`<label for>` + ids), flip
  `aria-invalid` on error, and are grouped with `role=group`; view tabs are a
  keyboard-navigable `role=tablist`, table headers carry `scope=col`, and the theme
  toggle + transcript affordance get accessible names.
- Author-time spec linter (`scripts/validate-spec.mjs`, `just validate`) that checks a
  spec against the authoring contract beyond the envelope validator.
- `scripts/jsonschema-to-spec.mjs` (`just convert-schema`): downconverts a
  Draft-2020-12 JSON Schema to the form-spec subset, flagging every dropped/
  approximated keyword.
- Two shipped example specs — `specs/survey.form.yaml` and `specs/settings.form.yaml`
  — compiled into `dist/` by `just build`, exercising the form feature set.
- `compile-spec --watch` (`just watch`) recompiles on every save to the spec,
  `--data`, or any engine source, debounced via Node's built-in `fs.watch` (no deps);
  a spec error is logged without stopping the watch.
- MCP hosts (SEP-1865) get a form **Submit to agent** button that returns the
  assembled public answers as a `ui/message` `structuredContent` map; standalone
  `file://` renders are unaffected.
- **Live data for views (opt-in)** via `x-forge-datasource` (`{url, mode, intervalMs,
  auth}`): a view can poll (or stream over SSE) a **read-only internal endpoint** that
  returns the data-bundle shape; the engine validates and merges each payload, reusing the
  MCP host-push path. The browser never touches a database and **no credential is ever read
  from the spec** — auth rides the user's session (`credentials: 'include'`) or network
  membership. **Default-absent means zero network**: a view without `x-forge-datasource`
  stays fully offline. See `specs/example-live.view.yaml`.
- **Content-Security-Policy** baked into every compiled output: a hash-pinned `script-src`
  (no `'unsafe-inline'`) so an injected inline script/handler — e.g. a malicious view
  `footer` — cannot run, and a `connect-src` egress lock (`'none'` for an inert artifact, the
  declared origin for a live view, open only on the `render.html` loader for `?spec=URL`).
  The linter (`validate-spec`) now checks `x-forge-datasource` and warns on any credential key.

---

<!-- generated entries below this line -->
