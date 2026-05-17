import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  STARTER_MEASURES,
  STARTER_PARAMETERS,
  buildContentTypesXml,
  buildDataModelSchema,
  buildPbit,
  buildPbitParts,
  buildReportLayout,
  buildVersion,
  crc32,
  encodeUtf16Le,
} from "../lib/powerbi-template";

/**
 * Structural assertions for the binary Power BI template (Analytics #15b).
 * A `.pbit` cannot be opened in CI (Power BI Desktop is Windows-only), so we
 * verify everything that *is* verifiable: the OPC ZIP structure, the part
 * encodings, the parameterised TMSL model, the report layout, and parity
 * with the copy-paste fallback assets (queries.m / measures.dax).
 */

const ROOT = join(__dirname, "..");
const PBIT = join(ROOT, "docs/powerbi/Collectables-Starter.pbit");

function utf16Decode(buf: Buffer): string {
  // Strip the UTF-16 LE BOM, then decode.
  return Buffer.from(buf).toString("utf16le").replace(/^﻿/, "");
}

describe("encodeUtf16Le", () => {
  it("prefixes a UTF-16 LE BOM and round-trips", () => {
    const enc = encodeUtf16Le('{"a":1}');
    assert.equal(enc[0], 0xff);
    assert.equal(enc[1], 0xfe);
    assert.equal(utf16Decode(enc), '{"a":1}');
  });
});

describe("crc32", () => {
  it("matches the IEEE reference vectors", () => {
    assert.equal(crc32(Buffer.from("")), 0);
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });
});

describe("buildContentTypesXml", () => {
  it("declares overrides for every required part", () => {
    const xml = buildContentTypesXml();
    for (const p of [
      "/Version",
      "/DataModelSchema",
      "/DiagramLayout",
      "/Report/Layout",
      "/Settings",
      "/Metadata",
      "/SecurityBindings",
    ]) {
      assert.match(xml, new RegExp(`PartName="${p}"`), `missing override ${p}`);
    }
    assert.match(xml, /Default Extension="json"/);
  });
});

describe("buildVersion", () => {
  it("is the enhanced-metadata format version", () => {
    assert.equal(buildVersion(), "3.0");
  });
});

describe("buildDataModelSchema", () => {
  const model = JSON.parse(buildDataModelSchema());

  it("is a valid TMSL database with the analytics_events table", () => {
    assert.equal(model.name, "Collectables-Starter");
    assert.equal(typeof model.compatibilityLevel, "number");
    const tables = model.model.tables.map((t: { name: string }) => t.name);
    assert.deepEqual(tables, ["analytics_events"]);
  });

  it("exposes the four Supabase parameters as M expressions", () => {
    const names = model.model.expressions.map(
      (e: { name: string }) => e.name,
    );
    assert.deepEqual(names, [
      "SupabaseHost",
      "SupabasePort",
      "SupabaseDb",
      "SupabaseSchema",
    ]);
    for (const e of model.model.expressions) {
      assert.equal(e.kind, "m");
      assert.match(e.expression, /IsParameterQuery=true/);
    }
  });

  it("partitions through the parameterised PostgreSQL source", () => {
    const m = model.model.tables[0].partitions[0].source.expression as string;
    assert.match(m, /PostgreSQL\.Database\(Server, SupabaseDb\)/);
    assert.match(m, /SupabaseHost & ":" & SupabasePort/);
    assert.match(m, /Item="analytics_events"/);
  });

  it("embeds every starter measure", () => {
    const names = model.model.tables[0].measures.map(
      (mm: { name: string }) => mm.name,
    );
    assert.deepEqual(
      names,
      STARTER_MEASURES.map((m) => m.name),
    );
  });
});

describe("buildReportLayout", () => {
  const layout = JSON.parse(buildReportLayout());

  it("ships a DAU page and a funnel page", () => {
    const pages = layout.sections.map(
      (s: { displayName: string }) => s.displayName,
    );
    assert.equal(pages.length, 2);
    assert.equal(pages[0], "DAU");
    assert.match(pages[1], /funnel/i);
  });

  it("the DAU page charts DAU over occurred_at", () => {
    const cfg = JSON.parse(layout.sections[0].visualContainers[0].config);
    assert.equal(cfg.singleVisual.visualType, "lineChart");
    const refs = JSON.stringify(cfg.singleVisual);
    assert.match(refs, /"DAU"/);
    assert.match(refs, /occurred_at/);
  });

  it("the funnel page uses the funnel measures", () => {
    const blob = JSON.stringify(layout.sections[1]);
    assert.match(blob, /clusteredColumnChart/);
    assert.match(blob, /ItemsAdded/);
    assert.match(blob, /ListingsCreated/);
    assert.match(blob, /ListingFunnelRate/);
    assert.match(blob, /PremiumConversionRate7d/);
  });
});

describe("buildPbitParts", () => {
  const parts = buildPbitParts();
  const byName = new Map(parts.map((p) => [p.name, p.data]));

  it("contains the canonical OPC part set", () => {
    assert.deepEqual(
      parts.map((p) => p.name),
      [
        "[Content_Types].xml",
        "Version",
        "DataModelSchema",
        "DiagramLayout",
        "Report/Layout",
        "Settings",
        "Metadata",
        "SecurityBindings",
      ],
    );
  });

  it("encodes JSON parts as UTF-16 LE (BOM) and metadata parts as UTF-8", () => {
    for (const p of ["DataModelSchema", "DiagramLayout", "Report/Layout", "Settings", "Metadata"]) {
      const buf = byName.get(p)!;
      assert.equal(buf[0], 0xff, `${p} should start with UTF-16 LE BOM`);
      assert.equal(buf[1], 0xfe, `${p} should start with UTF-16 LE BOM`);
      JSON.parse(utf16Decode(buf)); // must be valid JSON
    }
    const ct = byName.get("[Content_Types].xml")!;
    assert.notEqual(ct[0], 0xff); // UTF-8, no BOM
    assert.equal(byName.get("Version")!.toString("utf8"), "3.0");
  });
});

describe("buildPbit (ZIP writer)", () => {
  const zip = buildPbit();

  it("emits a valid local-file-header ZIP", () => {
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    // End-of-central-directory record present at the tail.
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.equal(zip.readUInt16LE(zip.length - 12), buildPbitParts().length);
  });

  it("central directory lists every part with a correct CRC", () => {
    // Walk the central directory from the EOCD pointer.
    const cdOffset = zip.readUInt32LE(zip.length - 22 + 16);
    const total = zip.readUInt16LE(zip.length - 22 + 10);
    let p = cdOffset;
    const seen: string[] = [];
    for (let i = 0; i < total; i++) {
      assert.equal(zip.readUInt32LE(p), 0x02014b50);
      const crc = zip.readUInt32LE(p + 16);
      const nameLen = zip.readUInt16LE(p + 28);
      const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
      const part = buildPbitParts().find((x) => x.name === name)!;
      assert.equal(crc, crc32(part.data), `CRC mismatch for ${name}`);
      seen.push(name);
      p += 46 + nameLen;
    }
    assert.deepEqual(seen.sort(), buildPbitParts().map((x) => x.name).sort());
  });
});

describe("committed .pbit is in sync with the builder", () => {
  it("exists at the canonical path", () => {
    assert.ok(existsSync(PBIT), "docs/powerbi/Collectables-Starter.pbit must be checked in");
  });

  it("byte-equals a fresh build (regenerate via npm run build:powerbi)", () => {
    assert.ok(
      readFileSync(PBIT).equals(buildPbit()),
      "Collectables-Starter.pbit is stale — run `npm run build:powerbi` and commit",
    );
  });
});

describe("parity with the copy-paste fallback assets", () => {
  it("every embedded measure matches docs/powerbi/measures.dax verbatim", () => {
    const dax = readFileSync(join(ROOT, "docs/powerbi/measures.dax"), "utf8");
    for (const m of STARTER_MEASURES) {
      assert.match(dax, new RegExp(`${m.name}\\s*:=`), `${m.name} missing from measures.dax`);
      // First line of the DAX expression must appear in the .dax file.
      const head = m.expression.split("\n")[0].trim();
      assert.ok(
        dax.includes(head),
        `${m.name} expression drifted from measures.dax (${head})`,
      );
    }
  });

  it("every parameter matches docs/powerbi/queries.m", () => {
    const m = readFileSync(join(ROOT, "docs/powerbi/queries.m"), "utf8");
    for (const p of STARTER_PARAMETERS) {
      assert.match(m, new RegExp(`\\b${p.name}\\b`), `${p.name} missing from queries.m`);
    }
  });
});
