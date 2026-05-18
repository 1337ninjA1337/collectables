import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  PBIT_PARAMETER_NAMES,
  buildDataModelSchema,
  buildMainQueryExpression,
  buildPbit,
  buildPbitParts,
  buildReportLayout,
  crc32,
  encodeUtf16LeWithBom,
  parseDaxMeasures,
  parseQueryParameters,
  zipStore,
} from "@/lib/powerbi-template";

const REPO_ROOT = path.join(__dirname, "..");
const POWERBI_DIR = path.join(REPO_ROOT, "docs", "powerbi");
const QUERIES_M = fs.readFileSync(path.join(POWERBI_DIR, "queries.m"), "utf8");
const MEASURES_DAX = fs.readFileSync(
  path.join(POWERBI_DIR, "measures.dax"),
  "utf8",
);
const PBIT_PATH = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

// Minimal STORED-ZIP reader matching the writer (no compression, no data
// descriptors) so we can validate the package end-to-end without a dep.
function unzipStored(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const crc = buf.readUInt32LE(i + 14);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString("utf8");
    const dataStart = i + 30 + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    assert.equal(
      crc32(data),
      crc,
      `CRC mismatch for ${name}`,
    );
    out.set(name, data);
    i = dataStart + compSize;
  }
  assert.equal(buf.readUInt32LE(i), 0x02014b50, "central directory follows");
  return out;
}

function decodeUtf16(data: Buffer): string {
  assert.equal(data[0], 0xff, "UTF-16 LE BOM byte 0");
  assert.equal(data[1], 0xfe, "UTF-16 LE BOM byte 1");
  return data.slice(2).toString("utf16le");
}

describe("crc32", () => {
  it("matches the well-known IEEE check value", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });

  it("is zero for empty input", () => {
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });
});

describe("encodeUtf16LeWithBom", () => {
  it("prefixes the FF FE BOM and encodes UTF-16 LE", () => {
    const b = encodeUtf16LeWithBom("AB");
    assert.deepEqual([...b], [0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
  });
});

describe("parseQueryParameters", () => {
  it("extracts all four Supabase parameters with their defaults", () => {
    const params = parseQueryParameters(QUERIES_M);
    assert.deepEqual(
      params.map((p) => p.name),
      [...PBIT_PARAMETER_NAMES],
    );
    const byName = Object.fromEntries(
      params.map((p) => [p.name, p.defaultValue]),
    );
    assert.equal(byName.SupabasePort, "5432");
    assert.equal(byName.SupabaseDb, "postgres");
    assert.equal(byName.SupabaseSchema, "public");
    assert.match(byName.SupabaseHost, /pooler\.supabase\.com/);
  });

  it("throws when a parameter is missing from the source", () => {
    assert.throws(
      () => parseQueryParameters('let SupabaseHost = "x" in 1'),
      /SupabasePort/,
    );
  });
});

describe("buildMainQueryExpression", () => {
  const body = buildMainQueryExpression(QUERIES_M);

  it("strips the // comment banner", () => {
    assert.ok(!body.some((l) => l.trim().startsWith("//")));
  });

  it("drops the four inline parameter bindings", () => {
    assert.ok(
      !body.some((l) => /^\s*SupabaseHost\s*=\s*"/.test(l)),
      "SupabaseHost binding removed",
    );
    assert.ok(
      !body.some((l) => /^\s*SupabaseSchema\s*=\s*"/.test(l)),
      "SupabaseSchema binding removed",
    );
  });

  it("still references the promoted parameters and the table", () => {
    const joined = body.join("\n");
    assert.match(joined, /SupabaseHost & ":" & SupabasePort/);
    assert.match(joined, /analytics_events/);
    assert.equal(body[0], "let");
    assert.equal(body[body.length - 1], "    Parsed");
  });
});

describe("parseDaxMeasures", () => {
  const measures = parseDaxMeasures(MEASURES_DAX);

  it("parses every starter measure", () => {
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

  it("captures multi-line expressions and trims comments", () => {
    const dau = measures.find((m) => m.name === "DAU");
    assert.ok(dau);
    assert.match(dau!.expression, /CALCULATE \(/);
    assert.match(dau!.expression, /DISTINCTCOUNT \( analytics_events\[user_id\] \)/);
    assert.ok(!dau!.expression.includes("//"));
    const rate = measures.find((m) => m.name === "ListingFunnelRate");
    assert.equal(
      rate!.expression,
      "DIVIDE ( [ListingsCreated], [ItemsAdded] )",
    );
  });
});

describe("buildDataModelSchema", () => {
  const params = parseQueryParameters(QUERIES_M);
  const mainQuery = buildMainQueryExpression(QUERIES_M);
  const measures = parseDaxMeasures(MEASURES_DAX);
  const model = buildDataModelSchema({ mainQuery, parameters: params, measures }) as any;

  it("targets a recent compatibility level", () => {
    assert.equal(model.compatibilityLevel, 1567);
  });

  it("exposes each Supabase parameter as an IsParameterQuery expression", () => {
    const names = model.model.expressions.map((e: any) => e.name);
    assert.deepEqual(names, [...PBIT_PARAMETER_NAMES]);
    for (const e of model.model.expressions) {
      assert.equal(e.kind, "m");
      assert.match(
        e.expression.join(" "),
        /meta \[IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true\]/,
      );
    }
  });

  it("declares the analytics_events table, columns, partition and measures", () => {
    const t = model.model.tables[0];
    assert.equal(t.name, "analytics_events");
    assert.deepEqual(
      t.columns.map((c: any) => c.name),
      ["id", "occurred_at", "user_id", "name", "properties"],
    );
    assert.equal(
      t.columns.find((c: any) => c.name === "occurred_at").dataType,
      "dateTime",
    );
    assert.equal(t.partitions[0].source.type, "m");
    assert.equal(t.partitions[0].source.expression[0], "let");
    assert.deepEqual(
      t.measures.map((m: any) => m.name),
      measures.map((m) => m.name),
    );
  });
});

describe("buildReportLayout", () => {
  it("ships exactly one empty starter page", () => {
    const layout = buildReportLayout() as any;
    assert.equal(layout.sections.length, 1);
    assert.equal(layout.sections[0].visualContainers.length, 0);
    assert.equal(layout.sections[0].displayName, "DAU & Funnels");
  });
});

describe("buildPbitParts", () => {
  const parts = buildPbitParts({ queriesM: QUERIES_M, measuresDax: MEASURES_DAX });
  const names = parts.map((p) => p.name);

  it("emits the OPC plumbing and every Power BI part", () => {
    for (const required of [
      "[Content_Types].xml",
      "_rels/.rels",
      "Version",
      "DataModelSchema",
      "DiagramLayout",
      "Settings",
      "Metadata",
      "Report/Layout",
    ]) {
      assert.ok(names.includes(required), `missing part ${required}`);
    }
  });

  it("declares a relationship for every Power BI part", () => {
    const rels = parts.find((p) => p.name === "_rels/.rels")!.data.toString("utf8");
    for (const target of [
      "/Version",
      "/DataModelSchema",
      "/Report/Layout",
      "/Settings",
      "/Metadata",
      "/DiagramLayout",
    ]) {
      assert.match(rels, new RegExp(`Target="${target.replace("/", "\\/")}"`));
    }
    assert.match(rels, /schemas\.microsoft\.com\/powerbi/);
  });

  it("UTF-16 LE encodes the JSON parts but keeps XML as UTF-8", () => {
    const dm = parts.find((p) => p.name === "DataModelSchema")!.data;
    assert.equal(dm[0], 0xff);
    assert.equal(dm[1], 0xfe);
    const ct = parts.find((p) => p.name === "[Content_Types].xml")!.data;
    assert.equal(ct[0], 0x3c); // "<" — no BOM, plain UTF-8 XML
  });
});

describe("zipStore", () => {
  it("produces a STORED zip that round-trips with valid CRCs", () => {
    const buf = zipStore([
      { name: "a.txt", data: Buffer.from("hello") },
      { name: "dir/b.txt", data: Buffer.from("world") },
    ]);
    const entries = unzipStored(buf);
    assert.equal(entries.get("a.txt")!.toString(), "hello");
    assert.equal(entries.get("dir/b.txt")!.toString(), "world");
  });

  it("is byte-deterministic across builds", () => {
    const a = buildPbit({ queriesM: QUERIES_M, measuresDax: MEASURES_DAX });
    const b = buildPbit({ queriesM: QUERIES_M, measuresDax: MEASURES_DAX });
    assert.ok(a.equals(b));
  });
});

describe("committed Collectables-Starter.pbit", () => {
  it("exists and is in sync with the .m / .dax source (no drift)", () => {
    assert.ok(
      fs.existsSync(PBIT_PATH),
      "docs/powerbi/Collectables-Starter.pbit must be committed",
    );
    const committed = fs.readFileSync(PBIT_PATH);
    const fresh = buildPbit({ queriesM: QUERIES_M, measuresDax: MEASURES_DAX });
    assert.ok(
      committed.equals(fresh),
      "committed .pbit is stale — re-run `npm run powerbi:template`",
    );
  });

  it("is a valid package whose model carries the params + measures", () => {
    const entries = unzipStored(fs.readFileSync(PBIT_PATH));
    const model = JSON.parse(decodeUtf16(entries.get("DataModelSchema")!));
    assert.deepEqual(
      model.model.expressions.map((e: any) => e.name),
      [...PBIT_PARAMETER_NAMES],
    );
    assert.deepEqual(
      model.model.tables[0].measures.map((m: any) => m.name),
      parseDaxMeasures(MEASURES_DAX).map((m) => m.name),
    );
    const version = decodeUtf16(entries.get("Version")!);
    assert.equal(version, "3.0");
  });
});

describe("build wiring", () => {
  it("the build script delegates to the lib (no re-rolled zip logic)", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "scripts", "build-powerbi-template.ts"),
      "utf8",
    );
    assert.match(src, /from "\.\.\/lib\/powerbi-template"/);
    assert.match(src, /buildPbit/);
    assert.match(src, /Collectables-Starter\.pbit/);
  });

  it("package.json exposes the powerbi:template script", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    assert.equal(
      pkg.scripts["powerbi:template"],
      "tsx scripts/build-powerbi-template.ts",
    );
  });

  it("the powerbi README points at the generated template", () => {
    const readme = fs.readFileSync(
      path.join(POWERBI_DIR, "README.md"),
      "utf8",
    );
    assert.match(readme, /Collectables-Starter\.pbit/);
    assert.match(readme, /build-powerbi-template\.ts/);
  });
});
