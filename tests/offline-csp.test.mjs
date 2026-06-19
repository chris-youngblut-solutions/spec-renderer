/* offline / CSP-clean regression guard. The whole identity of the tool is a
 * single self-contained HTML file with no network egress: no external stylesheet
 * or script, no web font, no @import. This pins that invariant on the engine
 * sources and on a compiled output so a future change can't silently regress it. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileBlank } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "engine.css"), "utf8");
const blank = compileBlank(); // default (Cabin) theme inlined, empty spec/data — purely structural

test("engine.css has no @import directive, @font-face, or external url()", () => {
  assert.doesNotMatch(css, /@import\s+(url|['"])/i); // real directive (not the word in a comment)
  assert.doesNotMatch(css, /@font-face/i);
  assert.doesNotMatch(css, /url\(\s*['"]?(https?:|\/\/)/i);
});

/* The theme tokens (and font stacks) now live in swappable THEME PACKS, so the
 * offline invariant must follow them: EVERY bundled pack must be offline/CSP-clean.
 * Strip /* *​/ comments first so a pack header may mention the forbidden shapes. */
test("every bundled theme pack is offline / CSP-clean", () => {
  const themesDir = join(ROOT, "themes");
  const packs = readdirSync(themesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(themesDir, d.name, "theme.css"));
  assert.ok(packs.length >= 2, "expected at least the default + one alternate pack");
  for (const p of packs) {
    const bare = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(bare, /@import\s+(url|['"])/i, p);
    assert.doesNotMatch(bare, /@font-face/i, p);
    assert.doesNotMatch(bare, /url\(\s*['"]?(https?:|\/\/)/i, p);
  }
});

test("the compiled blank renderer references no external resources", () => {
  assert.doesNotMatch(blank, /<link\b/i);                 // no stylesheet/font links
  assert.doesNotMatch(blank, /<script\b[^>]*\bsrc=/i);    // no external script
  assert.doesNotMatch(blank, /@import\s+(url|['"])/i);
  assert.doesNotMatch(blank, /https?:\/\//);              // no absolute http(s) URL anywhere
});
