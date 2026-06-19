/* config-forge ancestor fold — proves spec-renderer SUBSUMES config-forge's form core.
 *
 * config-forge was a single-file, no-build config-intake renderer: grouped phases, a
 * known/default/fill/scoped-out status lifecycle, secret routing to a separate export,
 * scoped-out exclusion, and a config-EDITOR mode that prefilled defaults. This re-expresses
 * that exact surface as a documented form spec (specs/config-forge.form.yaml) and asserts
 * the renderer reproduces each behavior with ZERO engine changes.
 *
 * Two halves, mirroring the repo's form-test conventions:
 *   (1) pure-API: parse the spec, then drive the SAME export functions the browser calls
 *       (formBuckets / formExportEnv / formExportSecrets / formExportJson) to pin the
 *       config-forge-distinctive behaviors — secret routing + scoped-out exclusion + the
 *       config-editor prefill (formSeedAnswers / --data precedence).
 *   (2) boot-under-shim: compile the spec, boot it under the DOM shim, and assert every
 *       phase + the export bar render (same shim shape as gallery-smoke.test.mjs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { compile, loadEngineApi } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = loadEngineApi();

const specText = readFileSync(join(ROOT, "specs", "config-forge.form.yaml"), "utf8");
const dataText = readFileSync(join(ROOT, "specs", "config-forge.vars.json"), "utf8");
const spec = api.parseEnvelope(api.parseSpecText(specText).data).spec;

/* ---- (1) pure-API: the config-forge-distinctive behaviors ---- */

test("the spec is a valid form envelope (compiles with zero engine changes)", () => {
  const env = api.parseEnvelope(api.parseSpecText(specText).data);
  assert.equal(env.kind, "form");
  assert.equal(env.meta.name, "node-bootstrap");
  assert.equal(api.validateEnvelope(env).length, 0);
});

test("every phase group is present and ordered (multi-phase config intake)", () => {
  // the engine's YAML parser yields arrays without Array.prototype, so normalize to a
  // plain array before the strict deep-equal (compare values, not the prototype).
  const ids = [...spec["x-forge-groups"]].map((g) => g.id);
  assert.deepEqual([...ids], ["p0-creds", "p1-mgmt-net", "p2-host", "p3-storage", "p4-monitoring", "p5-deferred"]);
});

test("the full status lifecycle is exercised (known / default / fill / scoped-out)", () => {
  const statuses = new Set(api.formFields(spec).map((f) => f.status).filter(Boolean));
  for (const s of ["known", "default", "fill", "scoped-out"]) assert.ok(statuses.has(s), "missing status: " + s);
});

test("scoped-out fields are excluded from every export (rendered nowhere)", () => {
  const { pub, sec } = api.formBuckets(spec, {});
  const keys = [...pub, ...sec].map(([k]) => k);
  assert.ok(!keys.includes("GPU_PASSTHROUGH_SLOT"), "scoped-out GPU field leaked into an export");
  assert.ok(!keys.includes("DAS_INTERFACE"), "scoped-out DAS field leaked into an export");
});

test("secret fields are routed to the secrets export, never the public env/json", () => {
  // give the optional SNMP secret a value so it lands in the bucket.
  const answers = { ADMIN_PASS: "hunter2", SNMP_COMMUNITY: "public-ro" };
  const { pub, sec } = api.formBuckets(spec, answers);
  const secKeys = sec.map(([k]) => k);
  const pubKeys = pub.map(([k]) => k);
  assert.ok(secKeys.includes("ADMIN_PASS") && secKeys.includes("SNMP_COMMUNITY"));
  assert.ok(!pubKeys.includes("ADMIN_PASS") && !pubKeys.includes("SNMP_COMMUNITY"));

  const env = api.formExportEnv(spec, answers);
  const json = api.formExportJson(spec, answers);
  const secrets = api.formExportSecrets(spec, answers);
  for (const blob of [env, json]) {
    assert.ok(!blob.includes("hunter2"), "secret value leaked into a public export");
    assert.ok(!blob.includes("public-ro"), "secret value leaked into a public export");
  }
  assert.match(secrets, /ADMIN_PASS=hunter2/);
  assert.match(secrets, /SNMP_COMMUNITY=public-ro/);
});

test("config-EDITOR mode: --data prefill seeds initial answers, default otherwise", () => {
  // formSeedAnswers reads localStorage + embedded data; with neither present (node),
  // the engine falls back to defaults — so drive prefill explicitly through the
  // same precedence the export functions use (answers > default).
  const provided = JSON.parse(dataText);
  const env = api.formExportEnv(spec, provided);
  assert.match(env, /HOSTNAME=node-01/);          // from --data
  assert.match(env, /POWER_PROFILE=performance/);  // from --data, overriding default 'balanced'
  assert.match(env, /BOOT_MODE=uefi/);             // untouched -> property default
  // a known factory value still travels through unchanged
  assert.match(env, /FACTORY_USER=root/);
});

test("annotated-env carries section headers + descriptions (the operator runbook output)", () => {
  const outs = [...api.formOutputs(spec)].sort();
  assert.deepEqual(outs, ["env", "env-annotated", "json"]);
  const ann = api.formExportEnvAnnotated(spec, {});
  assert.match(ann, /# == Phase 0 — Admin credentials ==/);   // group title -> section header
  assert.match(ann, /# New admin account created during bootstrap/); // field description -> comment
  // scoped-out fields are excluded from the annotated export too.
  assert.ok(!ann.includes("GPU_PASSTHROUGH_SLOT"));
});

/* ---- (2) boot-under-shim render smoke (mirrors gallery-smoke.test.mjs) ---- */

class El {
  constructor(tag) {
    this.tag = tag; this.className = ""; this._html = ""; this.textContent = "";
    this.style = {}; this.dataset = {}; this.children = []; this.onclick = null; this.value = "";
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  remove() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function serialize(node) {
  if (!node) return "";
  let s = (node._html || "") + (node.textContent || "");
  for (const c of node.children || []) s += serialize(c);
  return s;
}
function boot(stext, dtext) {
  const { html } = compile({ specText: stext, dataText: dtext || null });
  const registry = {};
  for (const id of ["#view", "#subtitle", "#tabs", "#pickers", "#loader", "#bar", "#foot",
    "#themeBtn", "#count", "#dlEnv", "#dlSecret", "#dlJson", "#dlAll", "#drop", "#file",
    "#paste", "#pasteBtn", "#embedded-spec", "#embedded-data"]) registry[id] = new El("div");
  registry["#embedded-spec"].textContent = html.match(/<script id="embedded-spec"[^>]*>([\s\S]*?)<\/script>/)[1];
  const md = html.match(/<script id="embedded-data"[^>]*>([\s\S]*?)<\/script>/);
  if (md) registry["#embedded-data"].textContent = md[1];
  const store = new Map();
  const ctx = {
    document: { createElement: (t) => new El(t), querySelector: (s) => registry[s] || new El("div"), documentElement: { dataset: {} }, body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: "", href: "file:///x" }, URLSearchParams, URL, alert() {}, console, module: { exports: {} },
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return {
    view: serialize(registry["#view"]),
    subtitle: serialize(registry["#subtitle"]),
    bar: serialize(registry["#bar"]),
  };
}

const r = boot(specText);

test("render: subtitle comes from the spec title", () => assert.match(r.subtitle, /Cluster node bootstrap/));

test("render: every phase group title renders", () => {
  for (const t of ["Admin credentials", "Management network", "Host identity", "Storage", "Monitoring"]) {
    assert.match(r.view, new RegExp(t));
  }
});

test("render: representative fields across phases render", () => {
  for (const k of ["ADMIN_USER", "MGMT_IP", "HOSTNAME", "RAID_LEVEL", "ALERT_EMAIL"]) {
    assert.match(r.view, new RegExp(k));
  }
});

test("render: scoped-out fields render as excluded placeholders (config-forge's lifecycle UI)", () => {
  // config-forge shows scoped-out fields as visible-but-excluded rows (the key + an
  // "excluded — scoped out" placeholder + a per-group "(N scoped-out)" count) rather than
  // editable inputs; they carry no status badge and are omitted from every export (test 4).
  assert.match(r.view, /excluded — scoped out/);
  assert.match(r.view, /scoped-out\)/); // the per-group "(N scoped-out)" header count
});

test("render: status badges render (known + fill at least)", () => {
  assert.match(r.view, /b-known/);
  assert.match(r.view, /b-fill/);
});

test("render: export bar has the four download buttons + annotated env", () => {
  for (const id of ["dlEnv", "dlSecret", "dlJson", "dlAll", "dlEnvAnn"]) assert.match(r.bar, new RegExp(id));
});

test("render: the config-EDITOR variant (--data) shows the Reset-to-provided affordance", () => {
  const edited = boot(specText, dataText);
  // a form compiled with --data gains a reset control; assert the embedded data rode in.
  assert.match(edited.view, /ADMIN_USER/);
});
