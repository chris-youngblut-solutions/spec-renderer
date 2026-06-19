/* offline / CSP-clean regression guard. The whole identity of the tool is a
 * single self-contained HTML file with no network egress: no external stylesheet
 * or script, no web font, no @import. This pins that invariant on the engine
 * sources and on a compiled output so a future change can't silently regress it. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileBlank } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "engine.css"), "utf8");
const blank = compileBlank(); // engine inlined, empty spec/data — purely structural

test("engine.css has no @import directive, @font-face, or external url()", () => {
  assert.doesNotMatch(css, /@import\s+(url|['"])/i); // real directive (not the word in a comment)
  assert.doesNotMatch(css, /@font-face/i);
  assert.doesNotMatch(css, /url\(\s*['"]?(https?:|\/\/)/i);
});

test("the compiled blank renderer references no external resources", () => {
  assert.doesNotMatch(blank, /<link\b/i);                 // no stylesheet/font links
  assert.doesNotMatch(blank, /<script\b[^>]*\bsrc=/i);    // no external script
  assert.doesNotMatch(blank, /@import\s+(url|['"])/i);
  assert.doesNotMatch(blank, /https?:\/\//);              // no absolute http(s) URL anywhere
});
