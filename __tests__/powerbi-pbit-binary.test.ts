import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readZip } from "@/lib/zip-writer";

/**
 * Structural assertions over the committed Power BI template binary
 * (Analytics #15b). The `.pbit` can only be *opened* in Power BI Desktop —
 * but it is an OPC/ZIP package, so CI can still verify it is a well-formed
 * archive carrying the right model, the four Supabase parameters, and the
 * seven starter measures. The text assets (Analytics #15a) remain the
 * copy-paste fallback if a given Power BI build rejects the template.
 */

const ROOT = join(__dirname, "..");
const PBIT = join(ROOT, "docs", "powerbi", "Collectables-Starter.pbit");

describe("docs/powerbi/Collectables-Starter.pbit (Analytics #15b)", () => {
  it("is checked into the repo so it ships without a build step", () => {
    assert.ok(existsSync(PBIT), "Collectables-Starter.pbit must be committed under docs/powerbi/");
  });

  it("is a valid ZIP carrying every required OPC part", () => {
    const entries = readZip(readFileSync(PBIT));
    const names = entries.map((e) => e.name);
    for (const part of [
      "Version",
      "[Content_Types].xml",
      "DataModelSchema",
      "DiagramLayout",
      "Report/Layout",
      "Metadata",
      "Settings",
    ]) {
      assert.ok(names.includes(part), `OPC part ${part} missing from the .pbit`);
    }
  });

  it("DataModelSchema is UTF-16LE JSON with the four Supabase parameters", () => {
    const entries = readZip(readFileSync(PBIT));
    const part = entries.find((e) => e.name === "DataModelSchema");
    assert.ok(part, "DataModelSchema part missing");
    assert.equal(part!.data[0], 0xff, "expected UTF-16LE BOM byte 0");
    assert.equal(part!.data[1], 0xfe, "expected UTF-16LE BOM byte 1");
    const model = JSON.parse(part!.data.subarray(2).toString("utf16le")) as {
      model: {
        expressions: { name: string; expression: string }[];
        tables: {
          name: string;
          columns: { name: string }[];
          partitions: { source: { expression: string[] } }[];
          measures: { name: string }[];
        }[];
      };
    };

    const params = model.model.expressions.map((e) => e.name);
    for (const p of ["SupabaseHost", "SupabasePort", "SupabaseDb", "SupabaseSchema"]) {
      assert.ok(params.includes(p), `parameter ${p} missing`);
    }
    for (const e of model.model.expressions) {
      assert.match(e.expression, /IsParameterQuery=true/);
    }

    const table = model.model.tables.find((t) => t.name === "analytics_events");
    assert.ok(table, "analytics_events table missing");
    const cols = table!.columns.map((c) => c.name).sort();
    assert.deepEqual(cols, ["id", "name", "occurred_at", "properties", "user_id"]);

    const mLines = table!.partitions[0].source.expression.join("\n");
    assert.match(mLines, /SupabaseHost\s*&\s*":"\s*&\s*SupabasePort/);
    assert.match(mLines, /try\s+Json\.Document\(_\)\s+otherwise\s+null/);

    const measures = table!.measures.map((m) => m.name).sort();
    assert.deepEqual(measures, [
      "DAU",
      "ItemsAdded",
      "ListingFunnelRate",
      "ListingsCreated",
      "PremiumActivationsLast7d",
      "PremiumConversionRate7d",
      "SignupsLast7d",
    ]);
  });

  it("Version part is the plain-text package version", () => {
    const entries = readZip(readFileSync(PBIT));
    const version = entries.find((e) => e.name === "Version");
    assert.ok(version, "Version part missing");
    assert.match(version!.data.toString("utf8"), /^\d+\.\d+$/);
  });
});
