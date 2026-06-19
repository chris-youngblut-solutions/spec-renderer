#!/usr/bin/env node
/* validate-spec.mjs — author-time spec linter.
 *
 *   node scripts/validate-spec.mjs <spec.(yaml|yml|json|md)> [--quiet] [--no-warn]
 *
 * Parses the spec with the SAME engine.js as compile-spec.mjs (loaded under
 * node:vm via loadEngineApi), runs validateEnvelope, then lints BEYOND it.
 * ERRORS (exit 1) are contract violations that will misrender or break export;
 * WARNINGS (exit 0) are likely mistakes. The report is written to stderr; the
 * exit code reflects errors only. Dependency-free; mirrors compile-spec.mjs's
 * parseArgs / main() / import.meta.url shape.
 *
 * The allowlists below MUST stay in sync with SPEC.md (the authoring contract).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEngineApi } from "./compile-spec.mjs";

/* ---- vocabularies (keep in lockstep with SPEC.md) ---- */

// documented top-level keys (JSON-Schema subset the renderer reads + x-forge-*)
const TOP_KEYS = new Set([
  "$schema", "type", "properties", "required",
  "kind", "name", "title", "version", "adapters", "views", "widgets",
  "dataSource", "x-forge-datasource", "footer", "select",
  "x-forge-kind", "x-forge-name", "x-forge-version", "x-forge-outputs",
  "x-forge-groups", "x-forge-env-banner", "x-forge-secret-banner",
  "x-forge-secret-banner-all",
]);

// documented per-property keywords (JSON-Schema subset + x-forge-* allowlist)
const PROP_KEYS = new Set([
  // JSON-Schema subset
  "type", "format", "enum", "default", "title", "description",
  // validation subset
  "minimum", "maximum", "minLength", "maxLength", "pattern",
  // array shape
  "items", "minItems", "maxItems",
  // per-property extensions
  "status", "secret", "group", "x-forge-multiline", "x-forge-when",
]);

const STATUSES = new Set(["known", "default", "fill", "scoped-out"]);
// mirrors FORM_OUTPUTS in engine.js
const OUTPUTS = new Set(["env", "json", "secrets", "yaml", "toml", "env-annotated"]);
const PROP_TYPES = new Set(["string", "integer", "number", "boolean", "array"]);
// validating formats + the `textarea` rendering hint (no validator)
const FORMATS = new Set(["ipv4", "email", "uri", "textarea"]);
const KNOWN_WIDGETS = new Set([
  "heading", "caption", "chips", "stat-cards", "hard-gate-banner",
  "metric-rollup", "case-table", "regression-diff", "transcript", "cross-grid", "trend",
]);
// the declarative live-data keys (the engine reads ONLY these); modes + auth values.
const DATASOURCE_KEYS = new Set(["url", "mode", "intervalMs", "auth"]);
const DATASOURCE_MODES = new Set(["poll", "sse"]);
const DATASOURCE_AUTH = new Set(["session", "none"]);
// keys an author might add expecting them to authenticate — they are IGNORED (the
// artifact is public), so warn loudly rather than ship a dead/leaked secret.
const DATASOURCE_CRED_KEYS = new Set(["token", "apikey", "api_key", "key", "secret", "password", "headers", "header", "authorization", "auth_token", "bearer", "cookie"]);

/* ---- the linter ---- */

function lint(api, specText) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  let parsed, env, validateErrs;
  try {
    parsed = api.parseSpecText(specText);
    env = api.parseEnvelope(parsed.data);
    validateErrs = api.validateEnvelope(env);
  } catch (e) {
    return { errors: ["spec failed to parse: " + e.message], warnings, env: null };
  }
  for (const m of validateErrs) E(m); // fold the engine's structural checks in

  const spec = env.spec;
  if (!spec || typeof spec !== "object") return { errors, warnings, env };

  lintTopKeys(spec, W);
  if (env.kind === "form") lintForm(spec, E, W);
  else if (env.kind === "view") lintView(spec, E, W);

  return { errors, warnings, env };
}

function lintTopKeys(spec, W) {
  for (const k of Object.keys(spec)) {
    if (!TOP_KEYS.has(k)) W("unknown top-level key: " + k);
  }
}

function lintForm(spec, E, W) {
  const props = spec.properties && typeof spec.properties === "object" ? spec.properties : {};
  const propKeys = new Set(Object.keys(props));
  const groupIds = new Set(formGroupIds(spec));

  const outputs = spec["x-forge-outputs"];
  if (Array.isArray(outputs)) {
    for (const o of outputs) if (!OUTPUTS.has(o)) E("x-forge-outputs value outside vocabulary (" + fmtKeys(OUTPUTS) + "): " + JSON.stringify(o));
  } else if (outputs != null) {
    W("x-forge-outputs should be an array (e.g. [env, json])");
  }
  // json explicitly requested without ANY env-family output => the secret only lands
  // in the secrets file (env-annotated counts as an env-family public output).
  const exportsJsonOnly = Array.isArray(outputs)
    && outputs.indexOf("env") < 0 && outputs.indexOf("env-annotated") < 0
    && outputs.indexOf("json") >= 0;

  if (Array.isArray(spec.required)) {
    for (const r of spec.required) if (!propKeys.has(r)) E("required key absent from properties: " + JSON.stringify(r));
  }

  for (const key of propKeys) {
    const p = props[key];
    if (!p || typeof p !== "object") { W("property is not a mapping: " + key); continue; }

    for (const k of Object.keys(p)) {
      if (!PROP_KEYS.has(k)) W("unknown keyword on property '" + key + "': " + k);
    }

    if (p.type != null && !PROP_TYPES.has(p.type)) W("property '" + key + "' has unsupported type: " + JSON.stringify(p.type));
    if (p.format != null && !FORMATS.has(p.format)) W("property '" + key + "' has unsupported format: " + JSON.stringify(p.format));

    if (p.status != null && !STATUSES.has(p.status)) E("property '" + key + "' status outside enum (" + fmtKeys(STATUSES) + "): " + JSON.stringify(p.status));

    if (p.group != null && !groupIds.has(p.group)) E("property '" + key + "' references group that does not resolve: " + JSON.stringify(p.group));

    if (Array.isArray(p.enum) && "default" in p && p.default != null && !p.enum.includes(p.default)) {
      E("property '" + key + "' default not in enum: " + JSON.stringify(p.default));
    }

    // x-forge-when is a flat {controlKey: value} map; every key must be a property.
    if ("x-forge-when" in p) {
      const w = p["x-forge-when"];
      if (w && typeof w === "object" && !Array.isArray(w)) {
        for (const ref of Object.keys(w)) if (!propKeys.has(ref)) E("property '" + key + "' x-forge-when references non-existent key: " + JSON.stringify(ref));
      } else {
        W("property '" + key + "' x-forge-when should be a flat {key: value} map (ignored otherwise)");
      }
    }

    if (p.secret === true && exportsJsonOnly) {
      W("property '" + key + "' is secret but x-forge-outputs is json-only (json carries public fields only — the secret lands only in variables-secrets.env)");
    }
  }
}

function lintView(spec, E, W) {
  const views = Array.isArray(spec.views) ? spec.views : [];
  for (const v of views) {
    if (!v || typeof v !== "object") { W("view entry is not a mapping"); continue; }
    for (const w of Array.isArray(v.widgets) ? v.widgets : []) {
      if (!w || typeof w !== "object" || w.widget == null) { W("widget entry missing 'widget' key in view " + JSON.stringify(v.key)); continue; }
      if (!KNOWN_WIDGETS.has(w.widget)) W("unknown widget '" + w.widget + "' in view " + JSON.stringify(v.key) + " (renders nothing)");
    }
  }
  lintDataSource(spec["x-forge-datasource"] || spec.dataSource, W);
}

// x-forge-datasource is declarative {url, mode, intervalMs, auth}. A malformed source is
// silently ignored at runtime (the view stays offline), so flag it as a WARNING here; a
// credential-like key is a louder warning (it is dropped — the artifact is public).
function lintDataSource(ds, W) {
  if (ds == null) return;
  if (typeof ds !== "object" || Array.isArray(ds)) { W("x-forge-datasource should be a {url, mode, intervalMs, auth} mapping (ignored otherwise — view stays offline)"); return; }
  const url = typeof ds.url === "string" ? ds.url.trim() : "";
  if (!(/^https?:\/\//i.test(url) || url[0] === "/")) W("x-forge-datasource.url must be an absolute http(s) URL or a root-relative '/path' (ignored otherwise — view stays offline)");
  if (ds.mode != null && !DATASOURCE_MODES.has(ds.mode)) W("x-forge-datasource.mode outside vocabulary (" + fmtKeys(DATASOURCE_MODES) + "): " + JSON.stringify(ds.mode) + " (defaults to poll)");
  if (ds.auth != null && !DATASOURCE_AUTH.has(ds.auth)) W("x-forge-datasource.auth outside vocabulary (" + fmtKeys(DATASOURCE_AUTH) + "): " + JSON.stringify(ds.auth) + " (defaults to none)");
  if (ds.intervalMs != null && typeof ds.intervalMs !== "number") W("x-forge-datasource.intervalMs should be a number of milliseconds (defaults to 15000)");
  for (const k of Object.keys(ds)) {
    if (DATASOURCE_CRED_KEYS.has(String(k).toLowerCase())) W("x-forge-datasource.'" + k + "' is IGNORED — credentials are never read from a spec (the artifact is public); auth is session/network only");
    else if (!DATASOURCE_KEYS.has(k)) W("unknown x-forge-datasource key: " + JSON.stringify(k) + " (ignored)");
  }
}

/* ---- helpers ---- */

// the resolvable group id set: x-forge-groups ids + the implicit null group.
function formGroupIds(spec) {
  const ids = [null];
  const groups = spec["x-forge-groups"];
  if (Array.isArray(groups)) for (const g of groups) { if (g && g.id != null) ids.push(g.id); }
  return ids;
}

function fmtKeys(set) { return Array.from(set).join(" / "); }

/* ---- report + CLI ---- */

function report(out, errors, warnings, showWarnings) {
  const w = (s) => out.write(s + "\n");
  if (showWarnings) for (const m of warnings) w("warning: " + m);
  for (const m of errors) w("error: " + m);
  w("");
  w(errors.length + " error" + (errors.length === 1 ? "" : "s")
    + ", " + warnings.length + " warning" + (warnings.length === 1 ? "" : "s"));
}

function parseArgs(argv) {
  const a = { spec: null, quiet: false, warn: true };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--quiet") a.quiet = true;
    else if (v === "--no-warn") a.warn = false;
    else if (!a.spec) a.spec = v;
    else throw new Error("unexpected argument: " + v);
  }
  if (!a.spec) throw new Error("usage: validate-spec.mjs <spec.(yaml|yml|json|md)> [--quiet] [--no-warn]");
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const specText = readFileSync(resolve(args.spec), "utf8");
  const api = loadEngineApi();
  const { errors, warnings, env } = lint(api, specText);
  if (!args.quiet) {
    if (env) process.stderr.write("linting " + (env.kind || "?") + " '" + ((env.meta && env.meta.name) || "?") + "'\n");
    report(process.stderr, errors, warnings, args.warn);
  }
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { lint, parseArgs, TOP_KEYS, PROP_KEYS, STATUSES, OUTPUTS };
