#!/usr/bin/env node
/* jsonschema-to-spec.mjs — downconvert a JSON Schema (Draft 2020-12) object into
 * the spec-renderer FORM-spec subset, flagging every keyword dropped/approximated.
 *
 *   node scripts/jsonschema-to-spec.mjs <schema.json> [-o out.json] [--report report.txt] [--quiet]
 *
 * The output is a form spec (x-forge-kind: form) that the SAME engine.js validates
 * (loaded here under node:vm via loadEngineApi, exactly like compile-spec.mjs). The
 * converter NEVER invents an unsupported keyword: anything the renderer does not
 * understand is dropped and named in the drop report (stderr by default, or a
 * sidecar file). Dependency-free; mirrors compile-spec.mjs structure.
 *
 * Supported downconversion (the renderer's current subset):
 *   - root: type:object + properties           -> form spec (x-forge-kind: form)
 *   - root: title -> title, $id/title -> x-forge-name (slugified), required[] passthrough
 *   - scalar property type string|integer|number|boolean   (number kept — the engine has a number type)
 *   - enum / default / title / description      passthrough
 *   - format ipv4|email|uri                     passthrough; other formats dropped+flagged
 *   - minimum/maximum/minLength/maxLength/pattern  passthrough (the renderer ENFORCES these)
 *   - array with items.enum                     -> a multi-select checkbox-group array field
 *   - array with items.type=string              -> a one-value-per-line string-list array field
 *   - minItems/maxItems on an array             passthrough
 *   - required[]                                passthrough (only for kept keys)
 *
 * Dropped + flagged (NOT emitted): nested object properties, oneOf/anyOf/allOf/not,
 *   $ref/$defs, additionalProperties, patternProperties, propertyNames, tuple items
 *   (items as array), array without a usable items shape, const, contains,
 *   dependentSchemas, if/then/else, exclusiveMinimum/Maximum, multipleOf, etc.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEngineApi } from "./compile-spec.mjs";

const SCALAR_TYPES = new Set(["string", "integer", "number", "boolean"]);
const KEPT_FORMATS = new Set(["ipv4", "email", "uri"]);
/* per-property validation keywords the renderer now ENFORCES — passed through clean */
const KEPT_CONSTRAINTS = ["minimum", "maximum", "minLength", "maxLength", "pattern"];
/* per-property keywords the renderer can't model -> drop+flag */
const PROP_UNSUPPORTED = [
  "oneOf", "anyOf", "allOf", "not", "$ref", "if", "then", "else",
  "const", "patternProperties", "propertyNames", "additionalProperties",
  "dependentSchemas", "dependentRequired", "unevaluatedProperties",
  "unevaluatedItems", "contains", "uniqueItems", "prefixItems",
  "multipleOf", "exclusiveMinimum", "exclusiveMaximum",
];
const ROOT_UNSUPPORTED = [
  "oneOf", "anyOf", "allOf", "not", "$ref", "$defs", "definitions",
  "if", "then", "else", "patternProperties", "propertyNames",
  "additionalProperties", "dependentSchemas", "dependentRequired",
  "unevaluatedProperties",
];

function hasOwn(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
function isPlainObject(o) { return o != null && typeof o === "object" && !Array.isArray(o); }

function slugifyName(s) {
  return String(s)
    .replace(/^https?:\/\//, "").replace(/[#?].*$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "schema";
}

function makeReport() {
  const items = [];
  return {
    drop(where, keyword, reason) { items.push({ where, keyword, reason, kind: "drop" }); },
    approx(where, keyword, reason) { items.push({ where, keyword, reason, kind: "approx" }); },
    items,
    get droppedKeywords() { return items.filter((i) => i.kind === "drop").map((i) => i.keyword); },
    get approxKeywords() { return items.filter((i) => i.kind === "approx").map((i) => i.keyword); },
    text() {
      if (!items.length) return "jsonschema-to-spec: clean downconversion — nothing dropped or approximated.\n";
      const lines = items.map((i) => "  [" + i.kind + "] " + i.where + " · " + i.keyword + " — " + i.reason);
      const d = items.filter((i) => i.kind === "drop").length, a = items.length - d;
      return "jsonschema-to-spec: " + d + " dropped, " + a + " approximated:\n" + lines.join("\n") + "\n";
    },
  };
}

/* downconvert ONE property schema into a form-spec field object, or null (dropped). */
function convertProperty(key, p, report) {
  const where = "properties." + key;
  if (!isPlainObject(p)) { report.drop(where, "(non-object schema)", "property schema is not a mapping"); return null; }

  for (const k of PROP_UNSUPPORTED) if (hasOwn(p, k)) report.drop(where, k, "no renderer equivalent");

  if (p.type === "array") {
    if (isPlainObject(p.items) && Array.isArray(p.items.enum)) {
      return buildArrayField(key, p, { enum: p.items.enum.slice() });
    }
    if (isPlainObject(p.items) && p.items.type === "string") {
      return buildArrayField(key, p, { type: "string" });
    }
    if (Array.isArray(p.items)) { report.drop(where, "items[] (tuple)", "tuple typing not supported"); return null; }
    report.drop(where, "array", "only arrays with items.enum or items.type:string are supported"); return null;
  }

  if (p.type === "object" || hasOwn(p, "properties")) {
    report.drop(where, "object(properties)", "nested objects are not supported (form specs are flat); split into a separate spec");
    return null;
  }

  if (typeof p.type !== "string" || !SCALAR_TYPES.has(p.type)) {
    report.drop(where, "type=" + JSON.stringify(p.type), "type missing / union / unsupported");
    return null;
  }
  return buildScalarField(key, p, report, where);
}

function buildScalarField(key, p, report, where) {
  const field = { type: p.type }; // number kept — the engine has a number type/validator
  if (Array.isArray(p.enum)) field.enum = p.enum.slice();
  if (hasOwn(p, "default")) field.default = p.default;
  if (typeof p.title === "string") field.title = p.title;
  if (typeof p.description === "string") field.description = p.description;
  if (typeof p.format === "string") {
    if (KEPT_FORMATS.has(p.format)) field.format = p.format;
    else report.drop(where, "format=" + p.format, "only ipv4|email|uri are supported");
  }
  for (const k of KEPT_CONSTRAINTS) if (hasOwn(p, k)) field[k] = p[k]; // enforced by the renderer
  return field;
}

function buildArrayField(key, p, items) {
  const field = { type: "array", items };
  if (typeof p.title === "string") field.title = p.title;
  if (typeof p.description === "string") field.description = p.description;
  if (hasOwn(p, "default") && Array.isArray(p.default)) field.default = p.default.slice();
  if (typeof p.minItems === "number") field.minItems = p.minItems;
  if (typeof p.maxItems === "number") field.maxItems = p.maxItems;
  return field;
}

/* schema (object) -> { spec, report } : spec is a form-spec-subset object. */
export function convertSchema(schema, opts = {}) {
  const report = makeReport();
  if (!isPlainObject(schema)) throw new Error("input schema must be a JSON object (mapping)");
  if (schema.type !== "object") throw new Error('only "type":"object" schemas convert to a form spec (got ' + JSON.stringify(schema.type) + ")");
  if (!isPlainObject(schema.properties)) throw new Error('schema needs a "properties" object');

  for (const k of ROOT_UNSUPPORTED) if (hasOwn(schema, k)) report.drop("(root)", k, "no renderer equivalent");
  if (hasOwn(schema, "items")) report.drop("(root)", "items", "root is an object, not an array");

  const name = opts.name || slugifyName(schema.$id || schema.title || "schema");
  const spec = { type: "object", "x-forge-kind": "form", "x-forge-name": name };
  if (typeof schema.title === "string") spec.title = schema.title;
  if (typeof schema.$schema === "string") spec["$schema"] = schema.$schema; // harmless; the engine ignores it

  const props = {};
  const kept = new Set();
  for (const key of Object.keys(schema.properties)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") { report.drop("properties." + key, key, "dangerous property name dropped"); continue; }
    const field = convertProperty(key, schema.properties[key], report);
    if (field) { props[key] = field; kept.add(key); }
  }
  spec.properties = props;

  if (Array.isArray(schema.required)) {
    const req = [];
    for (const k of schema.required) {
      if (kept.has(k)) req.push(k);
      else report.drop("required", String(k), "required key references a dropped/unknown property");
    }
    if (req.length) spec.required = req;
  }
  return { spec, report };
}

/* ---- CLI (mirrors compile-spec.mjs) ---- */
function parseArgs(argv) {
  const a = { schema: null, out: null, report: null, quiet: false, name: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "-o" || v === "--out") a.out = argv[++i];
    else if (v === "--report") a.report = argv[++i];
    else if (v === "--name") a.name = argv[++i];
    else if (v === "--quiet") a.quiet = true;
    else if (!a.schema) a.schema = v;
    else throw new Error("unexpected argument: " + v);
  }
  if (!a.schema) throw new Error("usage: jsonschema-to-spec.mjs <schema.json> [-o out.json] [--report report.txt] [--name n] [--quiet]");
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const schema = JSON.parse(readFileSync(resolve(args.schema), "utf8"));
  const { spec, report } = convertSchema(schema, { name: args.name });

  // self-validate the produced spec through the SAME engine the browser runs.
  const api = loadEngineApi();
  const env = api.parseEnvelope(spec);
  const errs = api.validateEnvelope(env);
  if (errs.length) throw new Error("internal: produced spec failed engine validation:\n  - " + errs.join("\n  - "));

  const json = JSON.stringify(spec, null, 2) + "\n";
  if (args.out) writeFileSync(resolve(args.out), json);
  else process.stdout.write(json);

  if (args.report) writeFileSync(resolve(args.report), report.text());
  else if (!args.quiet) process.stderr.write(report.text());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
