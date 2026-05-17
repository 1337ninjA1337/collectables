import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  PBIT_PARAMETER_NAMES,
  PBIT_VERSION,
  buildContentTypesXml,
  buildDataModelSchema,
  buildPartitionExpression,
  buildPbit,
  buildPbitEntries,
  buildReportLayout,
  extractQueryParameterDefaults,
  parseDaxMeasures,
  utf16le,
} from "@/lib/pbit-template";

const REPO = path.join(__dirname, "..");
const MEASURES_DAX = fs.readFileSync(
  path.join(REPO, "docs/powerbi/measures.dax"),
  "utf8",
);
const QUERIES_M = fs.readFileSync(
  path.join(REPO, "docs/powerbi/queries.m"),
  "utf8",
);

const EXPECTED_MEASURES = [
  "DAU",
  "ItemsAdded",
  "ListingsCreated",
  "ListingFunnelRate",
  "SignupsLast7d",
  "PremiumActivationsLast7d",
  "PremiumConversionRate7d",
];

describe("parseDaxMeasures", () => {
  it("extracts every measure from the committed measures.dax", () => {
    const parsed = parseDaxMeasures(MEASURES_DAX);
    assert.deepEqual(
      parsed.map((m) => m.name),
      EXPECTED_MEASURES,
    );
  });

  it("captures the multi-line DAU body verbatim", () => {
    const dau = parseDaxMeasures(MEASURES_DAX).find((m) => m.name === "DAU");
    assert.ok(dau);
    assert.deepEqual(dau.expression, [
      "CALCULATE (",
      "    DISTINCTCOUNT ( analytics_events[user_id] ),",
      "    NOT ( ISBLANK ( analytics_events[user_id] ) )",
      ")",
    ]);
  });

  it("captures the single-line funnel-rate measure", () => {
    const rate = parseDaxMeasures(MEASURES_DAX).find(
      (m) => m.name === "ListingFunnelRate",
    );
    assert.ok(rate);
    assert.deepEqual(rate.expression, [
      "DIVIDE ( [ListingsCreated], [ItemsAdded] )",
    ]);
  });

  it("never folds a // comment line into an expression", () => {
    for (const m of parseDaxMeasures(MEASURES_DAX)) {
      for (const line of m.expression) {
        assert.ok(!line.trim().startsWith("//"), `${m.name} leaked a comment`);
      }
    }
  });
});

describe("buildPartitionExpression", () => {
  const partition = buildPartitionExpression(QUERIES_M);

  it("starts the M with `let`", () => {
    assert.equal(partition[0].trim(), "let");
  });

  it("strips the four parameter literal assignments", () => {
    const joined = partition.join("\n");
    assert.ok(!/SupabaseHost\s*=\s*"/.test(joined));
    assert.ok(!/SupabasePort\s*=\s*"/.test(joined));
    assert.ok(!/SupabaseDb\s*=\s*"/.test(joined));
    assert.ok(!/SupabaseSchema\s*=\s*"/.test(joined));
  });

  it("still references the parameters by name", () => {
    const joined = partition.join("\n");
    for (const name of PBIT_PARAMETER_NAMES) {
      assert.ok(joined.includes(name), `partition lost ${name}`);
    }
    assert.ok(joined.includes("PostgreSQL.Database"));
    assert.ok(joined.includes('Item = "analytics_events"'));
  });

  it("throws when there is no let block", () => {
    assert.throws(() => buildPartitionExpression("// no query"));
  });
});

describe("extractQueryParameterDefaults", () => {
  it("reads the literal defaults out of queries.m", () => {
    const d = extractQueryParameterDefaults(QUERIES_M);
    assert.equal(d.SupabasePort, "5432");
    assert.equal(d.SupabaseDb, "postgres");
    assert.equal(d.SupabaseSchema, "public");
    assert.ok(d.SupabaseHost.includes("pooler.supabase.com"));
  });
});

describe("utf16le", () => {
  it("encodes ASCII as little-endian 16-bit code units", () => {
    assert.deepEqual([...utf16le("AB")], [0x41, 0x00, 0x42, 0x00]);
  });
  it("round-trips through Node's utf16le decoder", () => {
    const s = 'DAU := CALCULATE("x")';
    assert.equal(Buffer.from(utf16le(s)).toString("utf16le"), s);
  });
});

describe("buildDataModelSchema", () => {
  const measures = parseDaxMeasures(MEASURES_DAX);
  const partition = buildPartitionExpression(QUERIES_M);
  const defaults = extractQueryParameterDefaults(QUERIES_M);
  const schema = JSON.parse(
    buildDataModelSchema(measures, partition, defaults),
  );

  it("is valid TMSL JSON with the analytics_events table", () => {
    assert.equal(schema.compatibilityLevel, 1567);
    const table = schema.model.tables[0];
    assert.equal(table.name, "analytics_events");
    assert.deepEqual(
      table.columns.map((c: { name: string }) => c.name),
      ["id", "occurred_at", "user_id", "name", "properties"],
    );
  });

  it("declares all four Supabase parameters as M parameter queries", () => {
    const names = schema.model.expressions.map(
      (e: { name: string }) => e.name,
    );
    assert.deepEqual(names, [...PBIT_PARAMETER_NAMES]);
    for (const e of schema.model.expressions) {
      assert.equal(e.kind, "m");
      assert.match(e.expression[0], /IsParameterQuery=true/);
    }
  });

  it("carries every measure parsed from measures.dax", () => {
    const table = schema.model.tables[0];
    assert.deepEqual(
      table.measures.map((m: { name: string }) => m.name),
      EXPECTED_MEASURES,
    );
  });

  it("applies a percentage format string to the rate measures only", () => {
    const table = schema.model.tables[0];
    const fmt = (n: string) =>
      table.measures.find((m: { name: string }) => m.name === n).formatString;
    assert.equal(fmt("ListingFunnelRate"), "0.00%;-0.00%;0.00%");
    assert.equal(fmt("PremiumConversionRate7d"), "0.00%;-0.00%;0.00%");
    assert.equal(fmt("DAU"), undefined);
  });

  it("uses the stripped queries.m as the import partition source", () => {
    const src = schema.model.tables[0].partitions[0].source;
    assert.equal(src.type, "m");
    assert.equal(src.expression[0].trim(), "let");
  });
});

describe("buildContentTypesXml + buildReportLayout", () => {
  it("declares an Override for every binary part", () => {
    const xml = buildContentTypesXml();
    for (const part of [
      "/Version",
      "/DataModelSchema",
      "/DiagramLayout",
      "/Report/Layout",
      "/Settings",
      "/Metadata",
    ]) {
      assert.ok(xml.includes(`PartName="${part}"`), `missing ${part}`);
    }
  });

  it("emits a one-page report with three visual containers", () => {
    const layout = JSON.parse(buildReportLayout());
    assert.equal(layout.sections.length, 1);
    assert.equal(layout.sections[0].visualContainers.length, 3);
    // Each container config must itself be valid JSON.
    for (const vc of layout.sections[0].visualContainers) {
      JSON.parse(vc.config);
    }
  });
});

describe("buildPbit / buildPbitEntries", () => {
  const sources = { measuresDax: MEASURES_DAX, queriesM: QUERIES_M };

  it("emits exactly the OPC parts Power BI expects, in order", () => {
    assert.deepEqual(
      buildPbitEntries(sources).map((e) => e.path),
      [
        "[Content_Types].xml",
        "Version",
        "DataModelSchema",
        "DiagramLayout",
        "Settings",
        "Metadata",
        "Report/Layout",
      ],
    );
  });

  it("encodes [Content_Types].xml as UTF-8 and Version as UTF-16LE", () => {
    const entries = buildPbitEntries(sources);
    const ct = entries.find((e) => e.path === "[Content_Types].xml")!;
    assert.equal(new TextDecoder().decode(ct.data).startsWith("<?xml"), true);
    const ver = entries.find((e) => e.path === "Version")!;
    assert.equal(Buffer.from(ver.data).toString("utf16le"), PBIT_VERSION);
  });

  it("produces a non-empty deterministic byte stream", () => {
    const a = buildPbit(sources);
    const b = buildPbit(sources);
    assert.ok(a.length > 1000);
    assert.deepEqual([...a], [...b]);
  });
});
