/* Author-time JSON-Schema -> form-spec converter.
 * Feeds a schema mixing supported + unsupported keywords through convertSchema,
 * asserts the produced subset spec is a valid form envelope (validateEnvelope
 * clean through the unchanged engine), and that the drop report names every
 * unsupported keyword. Pure-API: no DOM shim (the converter never touches the
 * browser; it only reuses the engine's pure validator). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { convertSchema } from "../scripts/jsonschema-to-spec.mjs";
import { loadEngineApi } from "../scripts/compile-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = loadEngineApi();

const SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/mix.schema.json",
  "title": "Mixed schema",
  "type": "object",
  "required": ["PORT", "ADMIN_EMAIL", "NESTED"],
  "additionalProperties": false,
  "oneOf": [{ "required": ["PORT"] }],
  "properties": {
    "PORT": { "type": "integer", "title": "Port", "default": 3000, "minimum": 1, "maximum": 65535 },
    "RATE": { "type": "number", "default": 1.5, "minimum": 0.1 },
    "NODE_ENV": { "type": "string", "enum": ["development", "production", "test"], "default": "production" },
    "ADMIN_EMAIL": { "type": "string", "format": "email" },
    "HOMEPAGE": { "type": "string", "format": "hostname" },
    "FEATURE_FLAG": { "type": "boolean", "default": false },
    "REGIONS": { "type": "array", "items": { "enum": ["us", "eu", "ap"] }, "minItems": 1 },
    "TAGS": { "type": "array", "items": { "type": "string" } },
    "NESTED": { "type": "object", "properties": { "x": { "type": "string" } } },
    "EITHER": { "oneOf": [{ "type": "string" }, { "type": "integer" }] },
    "LINKED": { "$ref": "#/$defs/other" },
    "TUPLE": { "type": "array", "items": [{ "type": "string" }, { "type": "integer" }] }
  },
  "$defs": { "other": { "type": "string" } }
};

const { spec, report } = convertSchema(SCHEMA);
const env = api.parseEnvelope(spec);
const fields = () => Object.fromEntries(api.formFields(spec).map((x) => [x.key, x]));

test("produced spec is a valid FORM envelope (validateEnvelope clean)", () => {
  assert.equal(env.kind, "form");
  assert.ok(env.meta.name && env.meta.name.includes("mix")); // slugified from $id
  assert.equal(api.validateEnvelope(env).length, 0);
});

test("supported scalar properties pass through with type/enum/default/format", () => {
  const f = fields();
  assert.equal(f.PORT.jsType, "integer");
  assert.equal(f.PORT.def, 3000);
  assert.deepEqual(f.NODE_ENV.enum, ["development", "production", "test"]);
  assert.equal(f.NODE_ENV.def, "production");
  assert.equal(f.ADMIN_EMAIL.format, "email");
  assert.equal(f.FEATURE_FLAG.jsType, "boolean");
  assert.equal(f.PORT.title, "Port");
});

test("number type is preserved (the engine has a number type now)", () => {
  const f = fields();
  assert.ok(f.RATE, "RATE field is kept");
  assert.equal(f.RATE.jsType, "number");
  assert.equal(spec.properties.RATE.minimum, 0.1);
});

test("validation constraints pass through (the renderer enforces them)", () => {
  assert.equal(spec.properties.PORT.minimum, 1);
  assert.equal(spec.properties.PORT.maximum, 65535);
  // they are real, supported keywords now — not flagged as approximated/dropped
  assert.equal(report.droppedKeywords.includes("minimum"), false);
  assert.equal(report.approxKeywords.includes("minimum"), false);
});

test("array with items.enum becomes a multi-select array field", () => {
  const f = fields();
  assert.ok(f.REGIONS, "REGIONS field is kept");
  assert.equal(f.REGIONS.jsType, "array");
  assert.deepEqual(f.REGIONS.itemEnum, ["us", "eu", "ap"]);
  assert.equal(f.REGIONS.minItems, 1);
});

test("array with items.type:string becomes a string-list array field", () => {
  const f = fields();
  assert.ok(f.TAGS, "TAGS field is kept");
  assert.equal(f.TAGS.jsType, "array");
  assert.equal(f.TAGS.itemEnum, null); // string-list, not enum
});

test("unsupported property keywords are dropped + named in the report", () => {
  const dropped = report.droppedKeywords;
  assert.ok(dropped.includes("object(properties)"), "nested object flagged");
  assert.ok(dropped.includes("$ref"), "$ref flagged");
  assert.ok(dropped.includes("oneOf"), "oneOf flagged");
  assert.ok(dropped.includes("format=hostname"), "unsupported format flagged");
  assert.ok(dropped.includes("items[] (tuple)"), "tuple items flagged");
});

test("root-level unsupported keywords are dropped + named", () => {
  const dropped = report.droppedKeywords;
  assert.ok(dropped.includes("additionalProperties"), "additionalProperties flagged");
  assert.ok(dropped.includes("$defs"), "$defs flagged");
  assert.ok(dropped.includes("oneOf"), "root oneOf flagged");
});

test("dropped properties are NOT emitted into the spec; supported ones are kept", () => {
  const keys = Object.keys(spec.properties);
  for (const k of ["NESTED", "EITHER", "LINKED", "TUPLE"]) assert.equal(keys.includes(k), false, k + " should be dropped");
  for (const k of ["PORT", "RATE", "NODE_ENV", "ADMIN_EMAIL", "FEATURE_FLAG", "REGIONS", "TAGS", "HOMEPAGE"]) assert.ok(keys.includes(k), k + " should be kept");
  // HOMEPAGE is kept (string) but its unsupported format is stripped
  assert.equal(fields().HOMEPAGE.format, null);
});

test("required[] keeps only surviving keys, flags dropped requireds", () => {
  assert.deepEqual(spec.required, ["PORT", "ADMIN_EMAIL"]); // NESTED was required but dropped
  assert.ok(report.droppedKeywords.includes("NESTED"));     // flagged from required[]
});

test("report.text() lists keywords and counts", () => {
  const t = report.text();
  assert.match(t, /dropped/);
  assert.match(t, /\$ref/);
});

test("__proto__ property name is dropped, not emitted (prototype-pollution defense)", () => {
  // build via JSON.parse (the real CLI path) so "__proto__" is an OWN key — an object
  // literal would treat "__proto__": as the prototype-setter and Object.keys wouldn't see it.
  const input = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"SAFE":{"type":"string"}}}');
  const { spec: s, report: r } = convertSchema(input);
  assert.equal(Object.prototype.hasOwnProperty.call(s.properties, "__proto__"), false);
  assert.ok(Object.prototype.hasOwnProperty.call(s.properties, "SAFE"));
  assert.ok(r.droppedKeywords.includes("__proto__"));
});

test("the shipped example schema converts and validates", () => {
  const raw = readFileSync(join(ROOT, "specs", "example-jsonschema.schema.json"), "utf8");
  const { spec: s } = convertSchema(JSON.parse(raw));
  assert.equal(api.validateEnvelope(api.parseEnvelope(s)).length, 0);
});

test("non-object schema is rejected with a clear error", () => {
  assert.throws(() => convertSchema({ type: "array", items: { type: "string" } }), /type":"object"/);
  assert.throws(() => convertSchema("nope"), /JSON object/);
  assert.throws(() => convertSchema({ type: "object" }), /properties/);
});
