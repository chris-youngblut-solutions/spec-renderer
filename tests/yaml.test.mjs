/* Phase 0 — YAML-subset parser parity.
 * Loads engine.js under node:vm (no document => no boot) and runs the design
 * test matrix (tests/yaml-fixtures.json) plus frontmatter + out-of-scope cases.
 * Values come back from the vm realm, so normalize through plain() before
 * structural comparison (deepStrictEqual rejects cross-realm prototypes). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(join(ROOT, "engine.js"), "utf8"), ctx);
const { parseYaml, parseFrontmatter } = ctx.module.exports;

const plain = (x) => JSON.parse(JSON.stringify(x));
const fixtures = JSON.parse(readFileSync(join(ROOT, "tests", "yaml-fixtures.json"), "utf8"));

for (const f of fixtures) {
  test("yaml: " + f.name, () => {
    const got = parseYaml(f.inputYaml);
    const want = JSON.parse(f.expectedJson);
    assert.deepStrictEqual(plain(got), want);
  });
}

test("parseFrontmatter splits data + markdown body", () => {
  const src = "---\nkind: view\nname: demo\n---\n# Heading\n\nbody text\n";
  const fm = parseFrontmatter(src);
  assert.equal(fm.hasFrontmatter, true);
  assert.deepStrictEqual(plain(fm.data), { kind: "view", name: "demo" });
  assert.equal(fm.body.startsWith("# Heading"), true);
});

test("parseFrontmatter: no fence => whole text is body, empty data", () => {
  const fm = parseFrontmatter("# just markdown\n\nno frontmatter\n");
  assert.equal(fm.hasFrontmatter, false);
  assert.deepStrictEqual(plain(fm.data), {});
  assert.equal(fm.body.startsWith("# just markdown"), true);
});

test("parseFrontmatter: terminator may be ...", () => {
  const fm = parseFrontmatter("---\na: 1\n...\nrest body\n");
  assert.equal(fm.hasFrontmatter, true);
  assert.deepStrictEqual(plain(fm.data), { a: 1 });
});

for (const [name, src] of [
  ["anchor", "a: &x 1\nb: *x"],
  ["tag", "a: !!str 5"],
  ["directive", "%YAML 1.2\n---\na: 1"],
  ["complex key", "? a\n: b"],
  ["tab in indentation", "a:\n\tb: 1"],
  ["multi-doc stream", "a: 1\n---\nb: 2"],
]) {
  test("yaml rejects out-of-scope: " + name, () => {
    assert.throws(() => parseYaml(src));
  });
}

test("yaml: unterminated flow throws", () => {
  assert.throws(() => parseYaml("opts: [a, b"));
});
