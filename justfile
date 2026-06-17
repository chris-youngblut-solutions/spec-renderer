# spec-renderer — author-time tasks (the rendered artifacts are no-build).
# `compile` inlines engine + spec into a single self-contained HTML.

# run all node:test files (no deps, no browser — node:vm + DOM shim).
# glob the files explicitly: `node --test tests/` (a dir arg) errors on node 22.
test:
    node --test tests/*.test.mjs

# compile one spec to a self-contained HTML
#   just compile specs/eval.view.yaml out.html
compile spec out:
    node scripts/compile-spec.mjs {{spec}} -o {{out}}

# compile the shipped examples to their self-contained outputs.
# data/eval-sample.json is a public agentic-eval-harness snapshot.
embed:
    node scripts/compile-spec.mjs specs/example-app-env.form.yaml -o example-app-env.html
    node scripts/compile-spec.mjs specs/eval.view.yaml --data data/eval-sample.json -o eval-dashboard.html
    node scripts/compile-spec.mjs --blank -o render.html

# run the MCP Apps server (SEP-1865) over stdio — exposes the renderers as
# ui:// resources + render_form / render_view tools to an MCP host
mcp:
    node mcp-server/server.mjs

# full check: tests (compiled-output validity is asserted inside the tests)
check: test
