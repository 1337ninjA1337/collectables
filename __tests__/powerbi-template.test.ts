import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  EXPECTED_MEASURES,
  PBIT_PARAMETERS,
  PBIT_RELATIVE_PATH,
  buildContentTypesXml,
  buildPartitionM,
  buildPbitBuffer,
  crc32,
  decodeUtf16lePart,
  parseDaxMeasures,
  readZipParts,
  utf16leBom,
  zipParts,
} from "@/lib/powerbi-template";

/**
 * Analytics #15b — the binary `.pbit` cannot be validated in Power BI Desktop
 * from CI, so these tests crack the generated ZIP back open and assert it is a
 * structurally valid OPC package whose model is fully parameterised and stays
 * byte-for-byte derived from docs/powerbi/{queries.m,measures.dax} (#15a).
 */

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const QUERIES_M = read("docs/powerbi/queries.m");
const MEASURES_DAX = read("docs/powerbi/measures.dax");

describe("parseDaxMeasures", () => {
  it("extracts exactly the seven starter measures in order", () => {
    const measures = parseDaxMeasures(MEASURES_DAX);
    assert.deepEqual(
      measures.map((m) => m.name),
      [...EXPECTED_MEASURES],
    );
  });

  it("captures non-empty, comment-free expression bodies", () => {
    for (const m of parseDaxMeasures(MEASURES_DAX)) {
      assert.ok(m.lines.length > 0, `${m.name} has no expression`);
      assert.ok(
        m.lines.every((l) => !l.trim().startsWith("//")),
        `${m.name} leaked a comment line`,
      );
      assert.equal(m.lines[0].trim().startsWith("//"), false);
    }
  });

  it("keeps the DAX semantics verbatim", () => {
    const byName = new Map(
      parseDaxMeasures(MEASURES_DAX).map((m) => [m.name, m.lines.join("\n")]),
    );
    assert.match(
      byName.get("DAU")!,
      /DISTINCTCOUNT \( analytics_events\[user_id\] \)/,
    );
    assert.match(byName.get("DAU")!, /NOT \( ISBLANK/);
    assert.match(
      byName.get("ListingFunnelRate")!,
      /DIVIDE \( \[ListingsCreated\], \[ItemsAdded\] \)/,
    );
    assert.match(byName.get("SignupsLast7d")!, /DATESINPERIOD/);
  });
});

describe("buildPartitionM", () => {
  const m = buildPartitionM(QUERIES_M).join("\n");

  it("references the four model parameters by name", () => {
    for (const p of PBIT_PARAMETERS) {
      assert.match(m, new RegExp(`\\b${p}\\b`), `missing param ${p}`);
    }
  });

  it("strips the hard-coded parameter literal bindings", () => {
    for (const p of PBIT_PARAMETERS) {
      assert.doesNotMatch(
        m,
        new RegExp(`${p}\\s*=\\s*"`),
        `${p} literal binding leaked into the .pbit query`,
      );
    }
  });

  it("preserves the PostgreSQL connection and jsonb parse", () => {
    assert.match(m, /PostgreSQL\.Database\(Server, SupabaseDb\)/);
    assert.match(m, /Item = "analytics_events"/);
    assert.match(m, /try Json\.Document\(_\) otherwise null/);
  });

  it("is a well-formed let … in Parsed body with no comments", () => {
    assert.equal(m.startsWith("let"), true);
    assert.equal(m.trimEnd().endsWith("Parsed"), true);
    assert.doesNotMatch(m, /^\s*\/\//m);
    assert.doesNotMatch(m, /let\n\s*\n/, "blank line directly after let");
  });
});

describe("zip primitives", () => {
  it("crc32 matches the IEEE check value for '123456789'", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });

  it("utf16leBom prefixes the FF FE byte-order mark", () => {
    const b = utf16leBom("hi");
    assert.equal(b[0], 0xff);
    assert.equal(b[1], 0xfe);
    assert.equal(decodeUtf16lePart(b), "hi");
  });

  it("zipParts → readZipParts round-trips every part exactly", () => {
    const parts = [
      { path: "a.txt", data: Buffer.from("hello") },
      { path: "nested/b.bin", data: Buffer.from([0, 1, 2, 255, 254]) },
    ];
    const round = readZipParts(zipParts(parts));
    assert.equal(round.length, 2);
    assert.equal(round[0].path, "a.txt");
    assert.equal(round[0].data.toString(), "hello");
    assert.equal(round[1].path, "nested/b.bin");
    assert.deepEqual([...round[1].data], [0, 1, 2, 255, 254]);
  });
});

describe("buildContentTypesXml", () => {
  it("declares the JSON default and overrides every package part", () => {
    const xml = buildContentTypesXml();
    assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
    assert.match(xml, /<Default Extension="json"/);
    for (const part of [
      "/Version",
      "/DataModelSchema",
      "/DiagramLayout",
      "/Report/Layout",
      "/Settings",
      "/Metadata",
    ]) {
      assert.match(
        xml,
        new RegExp(`<Override PartName="${part.replace("/", "\\/")}"`),
      );
    }
  });
});

describe("buildPbitBuffer (in-memory package)", () => {
  const parts = readZipParts(buildPbitBuffer(QUERIES_M, MEASURES_DAX));
  const byPath = new Map(parts.map((p) => [p.path, p.data]));

  it("contains the seven OPC parts with [Content_Types].xml first", () => {
    assert.equal(parts[0].path, "[Content_Types].xml");
    for (const p of [
      "Version",
      "DataModelSchema",
      "DiagramLayout",
      "Settings",
      "Metadata",
      "Report/Layout",
    ]) {
      assert.ok(byPath.has(p), `missing part ${p}`);
    }
  });

  it("Content_Types is UTF-8 XML; model parts are UTF-16LE BOM", () => {
    assert.equal(byPath.get("[Content_Types].xml")!.subarray(0, 5).toString(), "<?xml");
    for (const p of ["Version", "DataModelSchema", "Report/Layout"]) {
      const d = byPath.get(p)!;
      assert.equal(d[0], 0xff, `${p} missing UTF-16LE BOM`);
      assert.equal(d[1], 0xfe, `${p} missing UTF-16LE BOM`);
    }
    assert.equal(decodeUtf16lePart(byPath.get("Version")!), "3.0");
  });

  it("the model exposes all four params as IsParameterQuery expressions", () => {
    const model = JSON.parse(decodeUtf16lePart(byPath.get("DataModelSchema")!));
    const exprs = model.model.expressions as { name: string; expression: string }[];
    assert.deepEqual(
      exprs.map((e) => e.name),
      [...PBIT_PARAMETERS],
    );
    for (const e of exprs) {
      assert.match(e.expression, /IsParameterQuery=true/);
      assert.match(e.expression, /Type="Text"/);
    }
    const order = model.model.annotations.find(
      (a: { name: string }) => a.name === "PBI_QueryOrder",
    ).value;
    assert.equal(
      order,
      JSON.stringify([...PBIT_PARAMETERS, "analytics_events"]),
    );
  });

  it("the analytics_events table carries the seven measures + typed columns", () => {
    const model = JSON.parse(decodeUtf16lePart(byPath.get("DataModelSchema")!));
    const table = model.model.tables[0];
    assert.equal(table.name, "analytics_events");
    assert.deepEqual(
      table.measures.map((x: { name: string }) => x.name),
      [...EXPECTED_MEASURES],
    );
    const cols = Object.fromEntries(
      table.columns.map((c: { name: string; dataType: string }) => [
        c.name,
        c.dataType,
      ]),
    );
    assert.equal(cols.occurred_at, "dateTime");
    assert.equal(cols.name, "string");
    assert.equal(cols.user_id, "string");
    assert.equal(cols.properties, "string");
    assert.equal(table.partitions[0].mode, "import");
  });

  it("the report has an Overview page binding card visuals to the measures", () => {
    const report = JSON.parse(decodeUtf16lePart(byPath.get("Report/Layout")!));
    const section = report.sections[0];
    assert.equal(section.displayName, "Overview");
    assert.ok(section.visualContainers.length >= 3);
    const refs = section.visualContainers
      .map((vc: { config: string }) => JSON.parse(vc.config))
      .map((c: { singleVisual: { projections: { Values: { queryRef: string }[] } } }) =>
        c.singleVisual.projections.Values[0].queryRef,
      );
    assert.ok(refs.includes("analytics_events.DAU"));
    assert.ok(refs.includes("analytics_events.ListingFunnelRate"));
    assert.ok(refs.includes("analytics_events.PremiumConversionRate7d"));
  });

  it("is deterministic — two builds are byte-identical", () => {
    const a = buildPbitBuffer(QUERIES_M, MEASURES_DAX);
    const b = buildPbitBuffer(QUERIES_M, MEASURES_DAX);
    assert.ok(a.equals(b));
  });
});

describe("committed docs/powerbi/Collectables-Starter.pbit", () => {
  it("exists at the canonical path", () => {
    assert.ok(
      existsSync(join(ROOT, PBIT_RELATIVE_PATH)),
      `${PBIT_RELATIVE_PATH} must be checked in`,
    );
  });

  it("is byte-identical to a fresh build from the #15a text assets", () => {
    const onDisk = readFileSync(join(ROOT, PBIT_RELATIVE_PATH));
    const fresh = buildPbitBuffer(QUERIES_M, MEASURES_DAX);
    assert.ok(
      onDisk.equals(fresh),
      "committed .pbit drifted from queries.m/measures.dax — run `npm run build:powerbi`",
    );
  });

  it("is a readable ZIP with the [Content_Types].xml OPC marker", () => {
    const parts = readZipParts(readFileSync(join(ROOT, PBIT_RELATIVE_PATH)));
    assert.equal(parts[0].path, "[Content_Types].xml");
    assert.ok(parts.some((p) => p.path === "DataModelSchema"));
    assert.ok(parts.some((p) => p.path === "Report/Layout"));
  });
});

describe("wiring", () => {
  it("package.json exposes the build:powerbi script", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(
      pkg.scripts["build:powerbi"],
      "tsx scripts/build-powerbi-template.ts",
    );
  });

  it("the build script feeds the two #15a text assets into the generator", () => {
    const src = read("scripts/build-powerbi-template.ts");
    assert.match(src, /buildPbitBuffer/);
    assert.match(src, /docs\/powerbi\/queries\.m/);
    assert.match(src, /docs\/powerbi\/measures\.dax/);
  });

  it("README + connection doc point at the generated template", () => {
    assert.match(read("docs/powerbi/README.md"), /\.pbit/);
    assert.match(read("docs/powerbi-connection.md"), /Collectables-Starter\.pbit/);
  });
});
