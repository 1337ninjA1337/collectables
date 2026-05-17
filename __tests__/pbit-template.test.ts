import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readZip } from "@/lib/zip-writer";
import {
  ANALYTICS_EVENTS_COLUMNS,
  PBIT_MEASURES,
  PBIT_PARAMETERS,
  buildAnalyticsEventsMExpression,
  buildContentTypesXml,
  buildDataModelSchema,
  buildPbitParts,
  createPbitBuffer,
} from "@/lib/pbit-template";

const EXPECTED_MEASURES = [
  "DAU",
  "ItemsAdded",
  "ListingsCreated",
  "ListingFunnelRate",
  "SignupsLast7d",
  "PremiumActivationsLast7d",
  "PremiumConversionRate7d",
];

describe("pbit-template parameters", () => {
  it("exposes the four Supabase connection parameters (host + port + db + schema)", () => {
    const names = PBIT_PARAMETERS.map((p) => p.name);
    for (const expected of ["SupabaseHost", "SupabasePort", "SupabaseDb", "SupabaseSchema"]) {
      assert.ok(names.includes(expected), `missing parameter ${expected}`);
    }
  });

  it("encodes each parameter as an IsParameterQuery M expression so Power BI prompts on open", () => {
    const schema = buildDataModelSchema() as {
      model: { expressions: { name: string; expression: string }[] };
    };
    assert.equal(schema.model.expressions.length, PBIT_PARAMETERS.length);
    for (const expr of schema.model.expressions) {
      assert.match(expr.expression, /IsParameterQuery=true/);
    }
  });
});

describe("pbit-template model", () => {
  it("declares the analytics_events table with all five schema columns", () => {
    const schema = buildDataModelSchema() as {
      model: { tables: { name: string; columns: { name: string }[] }[] };
    };
    const table = schema.model.tables.find((t) => t.name === "analytics_events");
    assert.ok(table, "analytics_events table missing");
    const cols = table.columns.map((c) => c.name);
    for (const c of ANALYTICS_EVENTS_COLUMNS) {
      assert.ok(cols.includes(c.name), `column ${c.name} missing`);
    }
    assert.equal(cols.length, 5);
  });

  it("carries all seven starter measures verbatim", () => {
    const names = PBIT_MEASURES.map((m) => m.name);
    assert.deepEqual([...names].sort(), [...EXPECTED_MEASURES].sort());
    const dau = PBIT_MEASURES.find((m) => m.name === "DAU");
    assert.match(dau!.expression, /DISTINCTCOUNT\s*\(\s*analytics_events\[user_id\]\s*\)/);
    assert.match(dau!.expression, /NOT\s*\(\s*ISBLANK/);
    const signups = PBIT_MEASURES.find((m) => m.name === "SignupsLast7d");
    assert.match(signups!.expression, /DATESINPERIOD/);
    assert.match(signups!.expression, /-7,\s*DAY/);
  });

  it("parameterises the M query by host + port and parses jsonb defensively", () => {
    const m = buildAnalyticsEventsMExpression();
    assert.match(m, /SupabaseHost\s*&\s*":"\s*&\s*SupabasePort/);
    assert.match(m, /PostgreSQL\.Database\(Server,\s*SupabaseDb\)/);
    assert.match(m, /Item\s*=\s*"analytics_events"/);
    assert.match(m, /try\s+Json\.Document\(_\)\s+otherwise\s+null/);
  });
});

describe("pbit-template OPC package", () => {
  it("includes every required OPC part", () => {
    const names = buildPbitParts().map((p) => p.name);
    for (const part of [
      "Version",
      "[Content_Types].xml",
      "DataModelSchema",
      "DiagramLayout",
      "Report/Layout",
      "Metadata",
      "Settings",
    ]) {
      assert.ok(names.includes(part), `OPC part ${part} missing`);
    }
  });

  it("emits the JSON parts as UTF-16LE with a BOM", () => {
    const part = buildPbitParts().find((p) => p.name === "DataModelSchema")!;
    assert.equal(part.data[0], 0xff);
    assert.equal(part.data[1], 0xfe);
  });

  it("[Content_Types].xml declares an override for every JSON part", () => {
    const xml = buildContentTypesXml();
    for (const part of ["/Version", "/DataModelSchema", "/Report/Layout", "/Settings", "/Metadata"]) {
      assert.ok(xml.includes(`PartName="${part}"`), `content-type override missing for ${part}`);
    }
  });

  it("createPbitBuffer() is a valid ZIP that round-trips through readZip", () => {
    const buf = createPbitBuffer();
    const back = readZip(buf);
    const names = back.map((e) => e.name);
    assert.ok(names.includes("DataModelSchema"));
    assert.ok(names.includes("Version"));
    // Deterministic — re-generating must yield identical bytes.
    assert.ok(createPbitBuffer().equals(buf));
  });

  it("the DataModelSchema part decodes to JSON carrying the params + measures", () => {
    const buf = createPbitBuffer();
    const part = readZip(buf).find((e) => e.name === "DataModelSchema")!;
    // strip the UTF-16LE BOM, decode.
    const json = part.data.subarray(2).toString("utf16le");
    const model = JSON.parse(json) as {
      model: {
        expressions: { name: string }[];
        tables: { measures: { name: string }[] }[];
      };
    };
    const paramNames = model.model.expressions.map((e) => e.name);
    assert.ok(paramNames.includes("SupabaseHost"));
    assert.ok(paramNames.includes("SupabasePort"));
    const measureNames = model.model.tables[0].measures.map((m) => m.name);
    for (const m of EXPECTED_MEASURES) {
      assert.ok(measureNames.includes(m), `measure ${m} missing from generated model`);
    }
  });
});

describe("pbit-template <-> #15a text assets parity", () => {
  const ROOT = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("every generated measure name also lives in measures.dax and the connection doc", () => {
    // Drift guard: if someone edits the DAX in the text assets but not the
    // generator (or vice versa) the two outputs would silently diverge.
    const dax = read("docs/powerbi/measures.dax");
    const doc = read("docs/powerbi-connection.md");
    for (const m of PBIT_MEASURES) {
      assert.match(dax, new RegExp(`\\b${m.name}\\b`), `${m.name} missing from measures.dax`);
      assert.match(doc, new RegExp(`\\b${m.name}\\b`), `${m.name} missing from powerbi-connection.md`);
    }
  });

  it("every generated parameter also lives in queries.m", () => {
    const m = read("docs/powerbi/queries.m");
    for (const p of PBIT_PARAMETERS) {
      assert.match(m, new RegExp(`\\b${p.name}\\b`), `${p.name} missing from queries.m`);
    }
  });
});
