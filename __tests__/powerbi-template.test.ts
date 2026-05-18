import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  PBIT_PARAMETER_NAMES,
  buildContentTypes,
  buildPbit,
  createZip,
  crc32,
  parseMeasures,
  parseQueryParameters,
  readZipEntries,
} from "@/lib/powerbi-template";

const POWERBI_DIR = path.join(__dirname, "..", "docs", "powerbi");
const QUERIES_M = path.join(POWERBI_DIR, "queries.m");
const MEASURES_DAX = path.join(POWERBI_DIR, "measures.dax");
const PBIT = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

const queryM = fs.readFileSync(QUERIES_M, "utf8");
const measuresDax = fs.readFileSync(MEASURES_DAX, "utf8");

function decodeUtf16(buf: Buffer): string {
  assert.equal(buf[0], 0xff, "UTF-16 LE BOM byte 0");
  assert.equal(buf[1], 0xfe, "UTF-16 LE BOM byte 1");
  return buf.subarray(2).toString("utf16le");
}

describe("parseQueryParameters", () => {
  it("extracts the four Supabase parameters with defaults", () => {
    const { parameters } = parseQueryParameters(queryM);
    assert.deepEqual(
      parameters.map((p) => p.name),
      [...PBIT_PARAMETER_NAMES],
    );
    const byName = Object.fromEntries(
      parameters.map((p) => [p.name, p.defaultValue]),
    );
    assert.equal(byName.SupabasePort, "5432");
    assert.equal(byName.SupabaseDb, "postgres");
    assert.equal(byName.SupabaseSchema, "public");
    assert.match(byName.SupabaseHost, /pooler\.supabase\.com/);
  });

  it("strips the literal assignments but keeps the references", () => {
    const { body } = parseQueryParameters(queryM);
    assert.doesNotMatch(body, /SupabaseHost\s*=\s*"aws-0/);
    assert.match(body, /SupabaseHost\s*&\s*":"\s*&\s*SupabasePort/);
    assert.match(body, /\blet\b[\s\S]*\bin\b[\s\S]*Parsed/);
  });

  it("throws when a parameter literal is missing", () => {
    const broken = queryM.replace(/SupabasePort\s*=\s*"5432",/, "");
    assert.throws(() => parseQueryParameters(broken), /expected 4 parameter/);
  });
});

describe("parseMeasures", () => {
  const measures = parseMeasures(measuresDax);

  it("parses all seven starter measures", () => {
    assert.deepEqual(
      measures.map((m) => m.name),
      [
        "DAU",
        "ItemsAdded",
        "ListingsCreated",
        "ListingFunnelRate",
        "SignupsLast7d",
        "PremiumActivationsLast7d",
        "PremiumConversionRate7d",
      ],
    );
  });

  it("captures multi-line and single-line expressions", () => {
    const dau = measures.find((m) => m.name === "DAU")!;
    assert.match(dau.expression, /DISTINCTCOUNT \( analytics_events\[user_id\] \)/);
    const rate = measures.find((m) => m.name === "ListingFunnelRate")!;
    assert.equal(
      rate.expression,
      "DIVIDE ( [ListingsCreated], [ItemsAdded] )",
    );
  });

  it("never captures a comment line as an expression", () => {
    for (const m of measures) {
      assert.doesNotMatch(m.expression, /^\s*\/\//, m.name);
      assert.ok(m.expression.length > 0, m.name);
    }
  });
});

describe("buildContentTypes", () => {
  it("emits an Override per part and never for [Content_Types].xml", () => {
    const xml = buildContentTypes([
      "[Content_Types].xml",
      "Version",
      "Report/Layout",
    ]);
    assert.match(xml, /<\?xml version="1\.0" encoding="utf-8"\?>/);
    assert.match(xml, /PartName="\/Version"/);
    assert.match(xml, /PartName="\/Report\/Layout"/);
    assert.doesNotMatch(xml, /PartName="\/\[Content_Types\]/);
  });
});

describe("createZip / readZipEntries", () => {
  it("round-trips parts (STORED and DEFLATE)", () => {
    const big = Buffer.from("abc".repeat(500), "utf8"); // compressible
    const small = Buffer.from("hi", "utf8"); // stays STORED
    const zip = createZip([
      { name: "big.txt", data: big },
      { name: "small.txt", data: small },
    ]);
    const out = readZipEntries(zip);
    assert.deepEqual(out.get("big.txt"), big);
    assert.deepEqual(out.get("small.txt"), small);
  });

  it("crc32 matches a known value", () => {
    // CRC-32 of ASCII "123456789" is 0xCBF43926.
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });
});

describe("buildPbit — OPC package structure", () => {
  const pbit = buildPbit(queryM, measuresDax);
  const entries = readZipEntries(pbit);

  it("is a valid ZIP with all required OPC parts", () => {
    for (const name of [
      "[Content_Types].xml",
      "Version",
      "DataModelSchema",
      "DiagramLayout",
      "Report/Layout",
      "Settings",
      "Metadata",
    ]) {
      assert.ok(entries.has(name), `missing part: ${name}`);
    }
  });

  it("[Content_Types].xml is UTF-8 and references every part", () => {
    const ct = entries.get("[Content_Types].xml")!.toString("utf8");
    assert.match(ct, /content-types/);
    for (const name of ["DataModelSchema", "Report/Layout", "Metadata"]) {
      assert.match(ct, new RegExp(`PartName="/${name.replace("/", "\\/")}"`));
    }
  });

  it("DataModelSchema embeds the 4 parameters as Power Query parameters", () => {
    const model = JSON.parse(decodeUtf16(entries.get("DataModelSchema")!));
    assert.deepEqual(
      model.model.expressions.map((e: { name: string }) => e.name),
      [...PBIT_PARAMETER_NAMES],
    );
    for (const e of model.model.expressions) {
      assert.equal(e.kind, "m");
      assert.match(e.expression, /IsParameterQuery=true/);
      assert.match(e.expression, /IsParameterQueryRequired=true/);
    }
  });

  it("DataModelSchema embeds all seven measures verbatim", () => {
    const model = JSON.parse(decodeUtf16(entries.get("DataModelSchema")!));
    const table = model.model.tables[0];
    assert.equal(table.name, "analytics_events");
    const embedded = table.measures.map(
      (m: { name: string; expression: string[] }) => ({
        name: m.name,
        expression: m.expression.join("\n"),
      }),
    );
    assert.deepEqual(embedded, parseMeasures(measuresDax));
  });

  it("partition M drops the literals but keeps the let/in body", () => {
    const model = JSON.parse(decodeUtf16(entries.get("DataModelSchema")!));
    const m = model.model.tables[0].partitions[0].source.expression.join("\n");
    assert.doesNotMatch(m, /SupabaseHost\s*=\s*"aws-0/);
    assert.match(m, /PostgreSQL\.Database/);
    assert.match(m, /\bin\b\s*\n?\s*Parsed/);
  });

  it("declares query order so parameters prompt before the table loads", () => {
    const model = JSON.parse(decodeUtf16(entries.get("DataModelSchema")!));
    const order = model.model.annotations.find(
      (a: { name: string }) => a.name === "PBI_QueryOrder",
    );
    assert.deepEqual(JSON.parse(order.value), [
      ...PBIT_PARAMETER_NAMES,
      "analytics_events",
    ]);
  });

  it("Report/Layout is valid UTF-16 JSON with one page", () => {
    const layout = JSON.parse(decodeUtf16(entries.get("Report/Layout")!));
    assert.equal(layout.sections.length, 1);
    assert.equal(layout.sections[0].name, "ReportSection");
  });

  it("is byte-deterministic across rebuilds", () => {
    assert.ok(buildPbit(queryM, measuresDax).equals(pbit));
  });
});

describe("committed Collectables-Starter.pbit", () => {
  it("exists and is in sync with the source assets", () => {
    assert.ok(
      fs.existsSync(PBIT),
      "docs/powerbi/Collectables-Starter.pbit missing — run scripts/build-powerbi-template.ts",
    );
    const onDisk = fs.readFileSync(PBIT);
    assert.ok(
      onDisk.equals(buildPbit(queryM, measuresDax)),
      "Collectables-Starter.pbit is stale — rerun scripts/build-powerbi-template.ts and commit",
    );
  });
});
