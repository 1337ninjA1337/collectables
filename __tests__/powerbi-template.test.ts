import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  PBIT_PART_NAMES,
  POWERBI_MEASURE_NAMES,
  POWERBI_PARAMETER_NAMES,
  POWERBI_TABLE_NAME,
  buildPbit,
  crc32,
  parseDaxMeasures,
  parseQueryParameters,
  readZipEntries,
  zipStore,
} from "@/lib/powerbi-template";

/**
 * Analytics #15b — structural assertions over the generated .pbit. The binary
 * can only be open-tested in Power BI Desktop, so CI validates the OPC/ZIP
 * envelope + that the embedded model is derived faithfully from the
 * CI-verifiable text assets (docs/powerbi/measures.dax + queries.m).
 */

const ROOT = join(__dirname, "..");
const PBIT = join(ROOT, "docs", "powerbi", "Collectables-Starter.pbit");
const measuresDax = readFileSync(join(ROOT, "docs/powerbi/measures.dax"), "utf8");
const queriesM = readFileSync(join(ROOT, "docs/powerbi/queries.m"), "utf8");

function decodeUtf16(buf: Buffer): string {
  // parts are written UTF-16 LE with a BOM
  return buf.subarray(2).toString("utf16le");
}

describe("parseDaxMeasures", () => {
  it("extracts every starter measure with its expression", () => {
    const measures = parseDaxMeasures(measuresDax);
    assert.deepEqual(
      measures.map((m) => m.name),
      [...POWERBI_MEASURE_NAMES],
    );
    for (const m of measures) {
      assert.ok(m.expression.length > 0, `${m.name} has no expression`);
      assert.equal(m.expression[0].trim() === "", false);
      assert.equal(m.expression.join("\n").includes("//"), false);
    }
  });

  it("keeps the DAU anon-exclusion expression verbatim", () => {
    const dau = parseDaxMeasures(measuresDax).find((m) => m.name === "DAU");
    assert.ok(dau);
    const expr = dau.expression.join("\n");
    assert.match(expr, /DISTINCTCOUNT\s*\(\s*analytics_events\[user_id\]\s*\)/);
    assert.match(expr, /NOT\s*\(\s*ISBLANK\s*\(\s*analytics_events\[user_id\]/);
  });
});

describe("parseQueryParameters", () => {
  it("derives the four parameters with defaults from queries.m", () => {
    const params = parseQueryParameters(queriesM);
    assert.deepEqual(
      params.map((p) => p.name),
      [...POWERBI_PARAMETER_NAMES],
    );
    const byName = Object.fromEntries(params.map((p) => [p.name, p.defaultValue]));
    assert.equal(byName.SupabasePort, "5432");
    assert.equal(byName.SupabaseDb, "postgres");
    assert.equal(byName.SupabaseSchema, "public");
    assert.match(byName.SupabaseHost, /pooler\.supabase\.com/);
  });

  it("throws if a parameter literal is missing", () => {
    assert.throws(() => parseQueryParameters("let Source = 1 in Source"));
  });
});

describe("zipStore / readZipEntries round-trip", () => {
  it("round-trips arbitrary entries and validates CRC", () => {
    const a = Buffer.from("hello", "utf8");
    const b = Buffer.from([1, 2, 3, 4]);
    const zip = zipStore([
      { name: "a.txt", data: a },
      { name: "dir/b.bin", data: b },
    ]);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const back = readZipEntries(zip);
    assert.ok(back["a.txt"].equals(a));
    assert.ok(back["dir/b.bin"].equals(b));
  });

  it("crc32 matches the known PNG/zlib check value", () => {
    // crc32("123456789") === 0xCBF43926
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });

  it("is deterministic for identical input", () => {
    const one = buildPbit({ measuresDax, queriesM }).buffer;
    const two = buildPbit({ measuresDax, queriesM }).buffer;
    assert.ok(one.equals(two), "rebuild must be byte-stable");
  });
});

describe("Collectables-Starter.pbit (committed artifact)", () => {
  it("is checked in and matches a fresh build of the text assets", () => {
    assert.ok(existsSync(PBIT), "docs/powerbi/Collectables-Starter.pbit missing");
    const committed = readFileSync(PBIT);
    const fresh = buildPbit({ measuresDax, queriesM }).buffer;
    assert.ok(
      committed.equals(fresh),
      "committed .pbit drifted from measures.dax/queries.m — run npm run build:powerbi",
    );
  });

  it("is a valid OPC ZIP containing exactly the expected parts", () => {
    const entries = readZipEntries(readFileSync(PBIT));
    assert.deepEqual(Object.keys(entries).sort(), [...PBIT_PART_NAMES].sort());
  });

  it("[Content_Types].xml declares an Override for every JSON part", () => {
    const entries = readZipEntries(readFileSync(PBIT));
    const xml = entries["[Content_Types].xml"].toString("utf8");
    assert.match(xml, /^<\?xml/);
    for (const part of PBIT_PART_NAMES) {
      if (part === "[Content_Types].xml") continue;
      assert.match(
        xml,
        new RegExp(`PartName="/${part.replace(/[/[\]]/g, "\\$&")}"`),
        `missing content-type override for ${part}`,
      );
    }
  });

  it("Version is UTF-16 LE '3.0'", () => {
    const entries = readZipEntries(readFileSync(PBIT));
    const v = entries["Version"];
    assert.deepEqual([v[0], v[1]], [0xff, 0xfe]);
    assert.equal(decodeUtf16(v), "3.0");
  });
});

describe(".pbit DataModelSchema", () => {
  function model() {
    const entries = readZipEntries(readFileSync(PBIT));
    return JSON.parse(decodeUtf16(entries["DataModelSchema"])) as {
      model: {
        tables: {
          name: string;
          columns: { name: string }[];
          partitions: { source: { type: string; expression: string[] } }[];
          measures: { name: string; expression: string[] }[];
        }[];
        expressions: { name: string; kind: string; expression: string }[];
      };
    };
  }

  it("parses as JSON and exposes the analytics_events table", () => {
    const m = model();
    const table = m.model.tables.find((t) => t.name === POWERBI_TABLE_NAME);
    assert.ok(table, "analytics_events table missing");
    assert.deepEqual(
      table.columns.map((c) => c.name).sort(),
      ["name", "occurred_at", "properties", "user_id"],
    );
  });

  it("embeds all seven measures derived from measures.dax", () => {
    const table = model().model.tables[0];
    assert.deepEqual(
      table.measures.map((x) => x.name),
      [...POWERBI_MEASURE_NAMES],
    );
    const dau = table.measures.find((x) => x.name === "DAU");
    assert.ok(dau);
    assert.match(dau.expression.join("\n"), /DISTINCTCOUNT/);
  });

  it("exposes prompt-on-open parameters with queries.m defaults", () => {
    const exprs = model().model.expressions;
    assert.deepEqual(
      exprs.map((e) => e.name),
      [...POWERBI_PARAMETER_NAMES],
    );
    for (const e of exprs) {
      assert.equal(e.kind, "m");
      assert.match(e.expression, /IsParameterQuery=true/);
      assert.match(e.expression, /Type="Text"/);
    }
    const port = exprs.find((e) => e.name === "SupabasePort");
    assert.ok(port && port.expression.includes('"5432"'));
  });

  it("the partition M binds the parameters to PostgreSQL.Database", () => {
    const src = model().model.tables[0].partitions[0].source;
    assert.equal(src.type, "m");
    const m = src.expression.join("\n");
    assert.match(m, /Server = SupabaseHost & ":" & SupabasePort/);
    assert.match(m, /PostgreSQL\.Database\(Server, SupabaseDb\)/);
    assert.match(m, /Item = "analytics_events"/);
    assert.match(m, /try Json\.Document\(_\) otherwise null/);
  });
});

describe(".pbit Report/Layout", () => {
  it("parses as JSON with a single section", () => {
    const entries = readZipEntries(readFileSync(PBIT));
    const layout = JSON.parse(
      decodeUtf16(entries["Report/Layout"]),
    ) as { sections: { name: string }[] };
    assert.equal(layout.sections.length, 1);
    assert.equal(layout.sections[0].name, "ReportSection");
  });
});

describe("powerbi .pbit <-> text-asset parity", () => {
  it("every measure name in the .pbit also lives in measures.dax", () => {
    const table = JSON.parse(
      decodeUtf16(readZipEntries(readFileSync(PBIT))["DataModelSchema"]),
    ).model.tables[0] as { measures: { name: string }[] };
    for (const m of table.measures) {
      assert.match(
        measuresDax,
        new RegExp(`\\b${m.name}\\s*:=`),
        `${m.name} is in the .pbit but not measures.dax`,
      );
    }
  });
});
