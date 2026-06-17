/* Phase 0 — spec envelope + compile-spec round-trip.
 * Envelope: kind discrimination (explicit + inferred), meta extraction,
 * validation. Compile: a tiny spec inlines to one self-contained HTML whose
 * embedded-spec is JSON-parseable, the engine is the only attribute-less
 * <script>, and </ is escaped. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compile } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(join(ROOT, "engine.js"), "utf8"), ctx);
const { parseEnvelope, validateEnvelope, parseSpecText } = ctx.module.exports;
const plain = (x) => JSON.parse(JSON.stringify(x));

test("envelope: explicit kind:view from YAML", () => {
  const env = parseEnvelope("kind: view\nname: demo\ntitle: Demo\nviews: [a]");
  assert.equal(env.kind, "view");
  assert.equal(env.meta.name, "demo");
  assert.equal(env.meta.title, "Demo");
  assert.equal(validateEnvelope(env).length, 0);
});

test("envelope: form inferred from JSON-Schema shape", () => {
  const env = parseEnvelope({ type: "object", "x-forge-name": "cfg", title: "Cfg", properties: { A: { type: "string" } } });
  assert.equal(env.kind, "form");
  assert.equal(env.meta.name, "cfg");
  assert.equal(env.meta.title, "Cfg");
  assert.equal(validateEnvelope(env).length, 0);
});

test("envelope: view inferred from widgets", () => {
  const env = parseEnvelope({ name: "v", widgets: [{ widget: "stat-cards" }] });
  assert.equal(env.kind, "view");
});

test("envelope: validate flags missing kind", () => {
  const env = parseEnvelope({ name: "x" });
  const errs = validateEnvelope(env);
  assert.ok(errs.some((e) => /kind/.test(e)));
});

test("envelope: validate flags missing name", () => {
  const env = parseEnvelope({ kind: "view", views: [1] });
  const errs = validateEnvelope(env);
  assert.ok(errs.some((e) => /name/.test(e)));
});

test("envelope: form missing properties is invalid", () => {
  const env = parseEnvelope({ kind: "form", name: "c" });
  const errs = validateEnvelope(env);
  assert.ok(errs.some((e) => /properties/.test(e)));
});

test("parseSpecText detects JSON vs YAML vs markdown", () => {
  assert.equal(parseSpecText('{"a":1}').format, "json");
  assert.equal(parseSpecText("a: 1").format, "yaml");
  assert.equal(parseSpecText("---\na: 1\n---\nbody").format, "markdown");
});

test("compile: tiny view spec -> self-contained HTML", () => {
  const specText = "kind: view\nname: demo\ntitle: Demo\nviews:\n  - overview";
  const { html, env } = compile({ specText, dataText: null });
  assert.equal(env.kind, "view");

  // engine is the ONLY attribute-less <script> (the extraction regex depends on this)
  const codeMatches = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  assert.equal(codeMatches.length, 1);

  // embedded-spec is present and JSON-parseable back to the spec object
  const m = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, "embedded-spec tag present");
  const back = JSON.parse(m[1]);
  assert.equal(back.kind, "view");
  assert.equal(back.name, "demo");

  // CSS + JS were spliced (placeholders gone)
  assert.equal(html.includes("__ENGINE_CSS__"), false);
  assert.equal(html.includes("__ENGINE_JS__"), false);
  assert.ok(html.includes("--cabin-paper"));
  assert.ok(html.includes("function parseYaml"));
});

test("compile: </ inside a spec value is escaped, then JSON-parses back", () => {
  const specText = 'kind: view\nname: demo\nviews:\n  - "</script><b>x</b>"';
  const { html } = compile({ specText, dataText: null });
  // raw HTML must NOT contain an unescaped </script> inside the data tag region
  const m = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m);
  assert.ok(m[1].includes("<\\/script>"), "</ should be escaped to <\\/ in the embed");
  const back = JSON.parse(m[1]);
  assert.equal(back.views[0], "</script><b>x</b>");
});

test("compile: rejects an invalid spec", () => {
  assert.throws(() => compile({ specText: "name: nope", dataText: null }), /invalid/);
});

test("compile: embeds optional data", () => {
  const specText = "kind: view\nname: demo\nviews: [overview]";
  const dataText = JSON.stringify({ domains: { generic: {} } });
  const { html } = compile({ specText, dataText });
  const m = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m);
  const back = JSON.parse(m[1]);
  assert.deepStrictEqual(plain(back), { domains: { generic: {} } });
});
