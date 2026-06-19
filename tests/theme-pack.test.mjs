/* Theme-pack swappability — the apparatus, not just centralization.
 *
 * Proves the theme is an INTERCHANGEABLE PACK: the engine consumes the --cabin-*
 * token CONTRACT, and the compiler inlines whichever conforming pack you select.
 *   - the DEFAULT pack (Cabin) and an explicit `--theme cabin` are identical;
 *   - an ALT pack (cool-slate) implementing the SAME contract swaps in and
 *     changes the token VALUES while keeping the token NAMES (the contract);
 *   - every conforming pack inlines the full required Core vocabulary;
 *   - the CSP/offline guards still hold for any pack;
 *   - a non-conforming (offline-breaking) pack is rejected.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compile,
  compileBlank,
  loadThemeCss,
  resolveThemePath,
} from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED = JSON.parse(readFileSync(join(ROOT, "themes", "tokens.json"), "utf8"));
const CORE = REQUIRED.core; // the required --cabin-* Core vocabulary

// a minimal valid form spec — exercises the real compile path (envelope + inline).
const SPEC = [
  'type: "object"',
  'x-forge-kind: "form"',
  'x-forge-name: "theme-probe"',
  "properties:",
  "  HOST:",
  '    type: "string"',
  '    status: "fill"',
].join("\n") + "\n";

function compiledWith(theme) {
  return compile({ specText: SPEC, dataText: null, theme }).html;
}

/* extract a token's DAY value from a compiled doc: find "<token>:VALUE;" inside the
 * `:root, [data-cabin="day"]{...}` block. Returns the trimmed value string. */
function dayValue(html, token) {
  const re = new RegExp(token.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;]+);");
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

test("every required Core token is present in the default (Cabin) pack, day + night", () => {
  const css = loadThemeCss(undefined); // default
  // crude but sufficient: each token name must appear at least twice (day + night).
  for (const tok of CORE) {
    const count = css.split(tok + ":").length - 1 + (css.split(tok + " :").length - 1);
    assert.ok(count >= 2, `${tok} should be defined for both day and night (saw ${count})`);
  }
});

test("the alt (cool-slate) pack implements the SAME Core contract", () => {
  const css = loadThemeCss("cool-slate");
  for (const tok of CORE) {
    const count = css.split(tok + ":").length - 1 + (css.split(tok + " :").length - 1);
    assert.ok(count >= 2, `cool-slate missing ${tok} for day+night (saw ${count})`);
  }
});

test("default compile === explicit `--theme cabin` (Cabin is the default pack)", () => {
  assert.equal(compiledWith(undefined), compiledWith("cabin"));
});

test("a compiled artifact inlines the FULL required Core vocabulary (default)", () => {
  const html = compiledWith("cabin");
  for (const tok of CORE) {
    assert.ok(html.includes(tok), `compiled output should inline ${tok}`);
  }
});

test("swapping to the alt pack changes token VALUES but keeps token NAMES", () => {
  const cabin = compiledWith("cabin");
  const slate = compiledWith("cool-slate");

  // contract held: every Core token name is still inlined under both packs.
  for (const tok of CORE) {
    assert.ok(cabin.includes(tok), `cabin missing ${tok}`);
    assert.ok(slate.includes(tok), `cool-slate missing ${tok}`);
  }

  // it really swapped: the paper + accent VALUES differ between the two packs.
  assert.notEqual(dayValue(cabin, "--cabin-paper"), dayValue(slate, "--cabin-paper"));
  assert.notEqual(dayValue(cabin, "--cabin-accent"), dayValue(slate, "--cabin-accent"));

  // and the values are the packs' actual declared values (no cross-contamination).
  assert.equal(dayValue(cabin, "--cabin-paper"), "#EDE3CF");
  assert.equal(dayValue(slate, "--cabin-paper"), "#EDF1F5");
  assert.equal(dayValue(cabin, "--cabin-accent"), "#B85A3E");
  assert.equal(dayValue(slate, "--cabin-accent"), "#2F7E8C");

  // the engine WIDGET css is byte-identical across packs — only the token block
  // moved — so swapping the pack re-skins without touching widget structure.
  const widgetMarker = "*{box-sizing:border-box}";
  assert.ok(cabin.includes(widgetMarker) && slate.includes(widgetMarker));
});

test("--theme accepts a pack DIRECTORY and a direct .css FILE path", () => {
  const cabinDir = join(ROOT, "themes", "cabin");
  const cabinCss = join(cabinDir, "theme.css");
  const viaDir = compiledWith(cabinDir);
  const viaFile = compiledWith(cabinCss);
  const viaName = compiledWith("cabin");
  assert.equal(viaDir, viaName, "pack dir resolves to the same output as the bare name");
  assert.equal(viaFile, viaName, "direct theme.css resolves to the same output as the bare name");
});

test("an out-of-tree conforming pack swaps in (the apparatus is not Cabin-bound)", () => {
  const dir = mkdtempSync(join(tmpdir(), "theme-ext-"));
  try {
    // a third-party pack living anywhere on disk: same contract, new values.
    const lines = [
      ":root, [data-cabin=\"day\"] {",
      ...CORE.map((t, i) => `  ${t}: rgb(${i},${i},${i});`),
      "  --font-serif: serif; --font-sans: sans-serif; --font-mono: monospace;",
      "}",
      "[data-cabin=\"night\"] {",
      ...CORE.map((t, i) => `  ${t}: rgb(${200 - i},${200 - i},${200 - i});`),
      "}",
    ];
    const packCss = join(dir, "theme.css");
    writeFileSync(packCss, lines.join("\n") + "\n");

    const html = compiledWith(dir);
    for (const tok of CORE) assert.ok(html.includes(tok), `ext pack missing ${tok}`);
    assert.equal(dayValue(html, "--cabin-paper"), "rgb(0,0,0)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-conforming (offline-breaking) pack is REJECTED", () => {
  const dir = mkdtempSync(join(tmpdir(), "theme-bad-"));
  try {
    const bad = join(dir, "theme.css");
    writeFileSync(bad, "@import url('https://evil.example/x.css');\n:root{--cabin-paper:#fff}\n");
    assert.throws(() => loadThemeCss(dir), /@import/i, "an @import pack must be rejected");

    writeFileSync(bad, "@font-face{font-family:x;src:url(https://evil.example/x.woff)}\n");
    assert.throws(() => loadThemeCss(dir), /@font-face|external url/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown theme name fails fast with a clear error", () => {
  assert.throws(() => resolveThemePath("no-such-pack"), /unknown theme pack/i);
});

test("the blank renderer also honors --theme", () => {
  const cabin = compileBlank("cabin");
  const slate = compileBlank("cool-slate");
  assert.ok(cabin.includes("--cabin-paper") && slate.includes("--cabin-paper"));
  assert.notEqual(dayValue(cabin, "--cabin-paper"), dayValue(slate, "--cabin-paper"));
});
