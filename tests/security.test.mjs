/* Regression tests for the pre-ship review's high/medium security findings:
 * attribute-context escaping, status whitelisting, and prototype-pollution
 * defenses in the YAML parser and binding resolver. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(join(ROOT, "engine.js"), "utf8"), ctx);
const E = ctx.module.exports;

test("esc escapes quotes (no attribute-context breakout)", () => {
  assert.equal(E.esc('"'), "&quot;");
  assert.equal(E.esc("'"), "&#39;");
  assert.equal(E.esc("<x>&"), "&lt;x&gt;&amp;");
  assert.equal(E.esc('x" onclick="alert(1)'), "x&quot; onclick=&quot;alert(1)");
});

test("form status is whitelisted (malicious status cannot reach the b-<status> class)", () => {
  const spec = { type: "object", "x-forge-name": "x", properties: { A: { type: "string", status: 'evil" onclick="alert(1)' } } };
  const env = E.parseEnvelope(spec);
  const f = E.formFields(env.spec).find((x) => x.key === "A");
  assert.equal(["known", "default", "fill", "scoped-out"].includes(f.status), true);
  assert.doesNotMatch(f.status, /onclick/);
});

test("YAML __proto__ key does not pollute Object.prototype (block + flow)", () => {
  E.parseYaml("__proto__:\n  polluted: true\nother: 1");
  E.parseYaml('a: {__proto__: {polluted: true}}');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test("resolveBinding rejects prototype-y adapter access", () => {
  const c = { card: { score: 1 } };
  assert.throws(() => E.resolveBinding("eval-scoring.constructor(card)", c), /unknown adapter call/);
  assert.throws(() => E.resolveBinding("constructor.x(card)", c), /unknown adapter call/);
});

test("lookup does not walk the prototype chain", () => {
  assert.equal(E.lookup({ a: { b: 2 } }, "a.b"), 2);
  assert.equal(E.lookup({}, "__proto__"), undefined);
  assert.equal(E.lookup({}, "constructor"), undefined);
  assert.equal(E.lookup({ a: 1 }, "a.constructor"), undefined);
});

test("$selector only returns own context keys", () => {
  const c = { domain: "generic" };
  assert.equal(E.resolveBinding("$domain", c), "generic");
  assert.equal(E.resolveBinding("$constructor", c), undefined);
  assert.equal(E.resolveBinding("$toString", c), undefined);
});
