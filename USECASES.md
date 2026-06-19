# Use cases

spec-renderer turns a single authored spec into a self-contained HTML form or view
that runs offline from `file://` and, unchanged, inside an MCP host. These are the
situations it is built for.

## What makes it a fit

Two properties, together, decide where spec-renderer earns its place over a
hand-built page or a hosted form builder:

- **One spec, two surfaces.** A `form` collects input and exports `.env` / JSON; a
  `view` renders a read-only dashboard over JSON data. Both come from one
  dependency-free engine, so the authoring cost is a spec, not a build.
- **Self-contained and portable.** The compiled output is a single HTML file with no
  network calls, no web fonts, no runtime dependencies, and a clean CSP. It opens
  from `file://`, and the same file is what an MCP host renders.

If you need neither offline portability nor an MCP surface, a hosted form builder is
simpler. spec-renderer is for the cases below, where one or both of those properties
is load-bearing.

## Agent ↔ human UI (MCP)

An LLM authors a spec mid-conversation, the host renders it as a real UI, and the
result returns to the conversation.

- **Configuration intake** — an agent that needs structured config (an `.env`, a
  connection map) renders a form; the human fills it; the values come back.
- **Decision / triage surfaces** — a list of findings or candidate actions rendered
  as a checklist the human dispositions, with notes.
- **Approval gates** — a form that surfaces exactly what an agent is about to do and
  collects an explicit go / no-go before it proceeds.
- **Scoping intake** — a multi-section form instead of a long back-and-forth in chat.
- **Result dashboards** — an agent that produces JSON (eval scores, run summaries)
  renders a view the human reads, rather than pasting tables into chat.

When a form runs inside an MCP host, a **Submit** button returns the assembled
(public) answers to the host as a structured tool result, closing the loop: the agent
renders a form, the human fills it, and the values come back as data the agent can act
on — no copy-paste, no re-parsing.

## Single-file offline artifacts

The compiled HTML is a file you can hand to someone.

- **Air-gapped / regulated / OT environments** — a form or dashboard that must run
  with no network and no installed toolchain.
- **Field / forward-deployed use** — open the file on whatever machine is in front of
  you; no server, no install.
- **Hand-off intake** — send a single file; the recipient fills it and returns the
  exported `.env` / JSON.
- **Static-site embedding** — drop the compiled file alongside static assets; it
  needs nothing else.

## Form vs view

- Reach for a **form** when collecting or editing structured values: config intake,
  settings, surveys, checklists, approval input. Forms support text / multi-line /
  number / checkbox / single- and multi-select / conditional fields, validate against
  a JSON-Schema subset (bounds, length, pattern), persist in-progress edits locally,
  prefill from `--data` (so the form is a config *editor*, not just an authoring tool),
  and export `.env` / JSON / YAML / TOML / annotated-env.
- Reach for a **view** when presenting JSON data read-only: dashboards, run
  comparisons, per-metric rollups, score trends, transcripts. Views bind widgets
  (including filterable/sortable tables and a score-over-runs line chart) to a data
  bundle; any computation lives in a named engine adapter, never in the spec.

## Where it is not the right tool

- A form that needs custom client logic, third-party widgets, or a live backend
  round-trip on every keystroke — spec-renderer is declarative and offline by design.
- A dashboard that needs charts the widget catalog does not cover — add an engine
  widget plus an adapter; do not push logic into the spec.
- A generic hosted form with no offline or MCP requirement — a SaaS form builder is
  less work.

## Status

Current. Forms and views both ship; the MCP Apps server (SEP-1865) exposes
`render_form` / `render_view` and forms can submit their answers back to the host.
Author-time tooling: a spec linter (`validate-spec`), a JSON-Schema → form-spec
converter (`jsonschema-to-spec`), and a `--watch` recompile loop. See `SPEC.md` for
the authoring format and `README.md` for compiling.
