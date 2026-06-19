/* compile-spec --watch helpers.
 * fs.watch end-to-end is OS/timing-flaky, so we unit-test the two cleanly-factored
 * pieces it is built from:
 *   - debounce(): a burst of N calls within the window fires fn exactly ONCE, with
 *     the LAST argument; spaced-out calls fire once each; .cancel() drops a pending fire.
 *   - compileOnce(): the shared read->compile->write unit writes a byte-identical
 *     artifact to compile().html, proving the non-watch path stayed identical.
 * The fs.watch wiring itself is verified manually (documented in the design). */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile, compileOnce, debounce } from "../scripts/compile-spec.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("debounce collapses a burst into ONE call with the last argument", async () => {
  let calls = 0;
  let lastSeen = null;
  const d = debounce((arg) => { calls++; lastSeen = arg; }, 40);
  d("a"); d("b"); d("c");
  assert.equal(calls, 0, "does not fire synchronously");
  await sleep(80);
  assert.equal(calls, 1, "fires exactly once after the quiet window");
  assert.equal(lastSeen, "c", "fires with the LAST argument");
});

test("debounce fires once per spaced-out call", async () => {
  let calls = 0;
  const d = debounce(() => { calls++; }, 20);
  d("x");
  await sleep(60);
  d("y");
  await sleep(60);
  assert.equal(calls, 2, "two well-separated calls => two fires");
});

test("debounce .cancel() drops a pending fire", async () => {
  let calls = 0;
  const d = debounce(() => { calls++; }, 30);
  d("z");
  d.cancel();
  await sleep(60);
  assert.equal(calls, 0, "cancelled before the window elapsed => never fires");
});

test("compileOnce writes a byte-identical artifact to compile().html", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-watch-"));
  try {
    const specPath = join(dir, "demo.form.yaml");
    const outPath = join(dir, "out.html");
    const specText = [
      'type: "object"',
      'x-forge-kind: "form"',
      'x-forge-name: "watch-demo"',
      'title: "Watch demo"',
      "properties:",
      "  HOST:",
      '    type: "string"',
      '    status: "fill"',
    ].join("\n") + "\n";
    writeFileSync(specPath, specText);

    const { html } = compile({ specText, dataText: null });
    const res = compileOnce({ spec: specPath, data: null, out: outPath, blank: false, watch: false });

    assert.equal(res.out, outPath, "honors -o out path");
    assert.equal(res.kind, "form");
    assert.equal(res.name, "watch-demo");
    assert.equal(res.bytes, html.length, "reported byte count matches compile()");
    assert.equal(readFileSync(outPath, "utf8"), html, "written file is byte-identical to compile().html");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
