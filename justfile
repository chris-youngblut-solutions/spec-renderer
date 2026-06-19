# spec-renderer — author-time tasks (the rendered artifacts are no-build).
# `compile` inlines engine + spec into a single self-contained HTML.

# run all node:test files (no deps, no browser — node:vm + DOM shim).
# glob the files explicitly: `node --test tests/` (a dir arg) errors on node 22.
test:
    node --test tests/*.test.mjs

# compile one spec to a self-contained HTML (default theme pack = Cabin)
#   just compile specs/eval.view.yaml out.html
compile spec out:
    node scripts/compile-spec.mjs {{spec}} -o {{out}}

# compile one spec with a SELECTED theme pack (bare name, pack dir, or .css file)
#   just compile-theme specs/survey.form.yaml cool-slate out.html
compile-theme spec theme out:
    node scripts/compile-spec.mjs {{spec}} --theme {{theme}} -o {{out}}

# lint a spec against the authoring contract (errors exit nonzero, warnings exit 0)
#   just validate specs/example-app-env.form.yaml
validate spec:
    node scripts/validate-spec.mjs {{spec}}

# downconvert a JSON Schema (Draft 2020-12) into a form spec, flagging dropped keywords
#   just convert-schema schema.json webapp.form.json
convert-schema schema out:
    node scripts/jsonschema-to-spec.mjs {{schema}} -o {{out}}

# recompile on every save (spec / --data / engine sources); fs.watch, no deps.
#   just watch specs/example-app-env.form.yaml out.html
watch spec out:
    node scripts/compile-spec.mjs {{spec}} -o {{out}} --watch

# compile the shipped examples to their self-contained outputs.
# data/eval-sample.json is a public agentic-eval-harness snapshot.
embed:
    node scripts/compile-spec.mjs specs/example-app-env.form.yaml -o example-app-env.html
    node scripts/compile-spec.mjs specs/config-forge.form.yaml -o config-forge.html
    node scripts/compile-spec.mjs specs/survey.form.yaml -o survey.html
    node scripts/compile-spec.mjs specs/settings.form.yaml -o settings.html
    node scripts/compile-spec.mjs specs/eval.view.yaml --data data/eval-sample.json -o eval-dashboard.html
    node scripts/compile-spec.mjs specs/example-live.view.yaml -o example-live.html
    node scripts/compile-spec.mjs --blank -o render.html

# run the MCP Apps server (SEP-1865) over stdio — exposes the renderers as
# ui:// resources + render_form / render_view tools to an MCP host
mcp:
    node mcp-server/server.mjs

# full check: tests (compiled-output validity is asserted inside the tests)
check: test

# build the release artifacts (the compiled single-file renderers) into dist/
build: embed
    mkdir -p dist
    cp example-app-env.html config-forge.html survey.html settings.html eval-dashboard.html example-live.html render.html dist/
