import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, it } from "node:test";

/**
 * Analytics #15b — structural assertions over the generated .pbit binary.
 *
 * A .pbit cannot be opened/validated in CI (Power BI Desktop is Windows-only),
 * so this verifies everything that *is* machine-checkable: the OPC ZIP parts,
 * the embedded Power Query (parameters + connection), and that the
 * DataModelSchema carries the measures — all sourced verbatim from the
 * Analytics #15a text assets (single source of truth).
 */

const ROOT = join(__dirname, "..");
const PBIT = join(ROOT, "docs", "powerbi", "Collectables-Starter.pbit");
const SCRIPT = "scripts/build-powerbi-template.ts";

const MEASURE_NAMES = [
  "DAU",
  "ItemsAdded",
  "ListingsCreated",
  "ListingFunnelRate",
  "SignupsLast7d",
  "PremiumActivationsLast7d",
  "PremiumConversionRate7d",
];
const PARAM_NAMES = [
  "SupabaseHost",
  "SupabasePort",
  "SupabaseDb",
  "SupabaseSchema",
];

// ── Minimal ZIP reader (walks local file headers; flags=0, no descriptors) ──
function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let o = 0;
  while (o + 4 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8);
    const compSize = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extraLen = buf.readUInt16LE(o + 28);
    const name = buf.toString("utf8", o + 30, o + 30 + nameLen);
    const dataStart = o + 30 + nameLen + extraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    o = dataStart + compSize;
  }
  return out;
}

function decodeUtf16(buf: Buffer): string {
  const b = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2) : buf;
  return b.toString("utf16le");
}

interface Qdeff {
  packageParts: Buffer;
  consumed: number;
  total: number;
  version: number;
}

function parseDataMashup(dm: Buffer): Qdeff {
  let o = 0;
  const version = dm.readUInt32LE(o);
  o += 4;
  const readSection = (): Buffer => {
    const len = dm.readUInt32LE(o);
    o += 4;
    const body = dm.subarray(o, o + len);
    o += len;
    return body;
  };
  const packageParts = readSection();
  readSection(); // permissions
  readSection(); // metadata
  readSection(); // permission bindings
  return { packageParts, consumed: o, total: dm.length, version };
}

let parts: Map<string, Buffer>;
try {
  parts = readZip(readFileSync(PBIT));
} catch {
  parts = new Map();
}

describe("docs/powerbi/Collectables-Starter.pbit (Analytics #15b)", () => {
  it("exists and is a valid OPC ZIP package", () => {
    assert.ok(existsSync(PBIT), "the generated .pbit must be committed");
    assert.ok(parts.size > 0, ".pbit must parse as a ZIP");
  });

  it("contains every required Power BI OPC part", () => {
    for (const part of [
      "[Content_Types].xml",
      "Version",
      "DataModelSchema",
      "DiagramLayout",
      "Report/Layout",
      "Settings",
      "Metadata",
      "DataMashup",
    ]) {
      assert.ok(parts.has(part), `missing OPC part: ${part}`);
    }
  });

  it("[Content_Types].xml declares the DataMashup + JSON parts", () => {
    const ct = parts.get("[Content_Types].xml")!.toString("utf8");
    assert.match(ct, /PartName="\/DataMashup"/);
    assert.match(ct, /PartName="\/DataModelSchema"/);
    assert.match(ct, /PartName="\/Report\/Layout"/);
  });

  it("DataModelSchema (UTF-16LE) parses and carries all 7 measures", () => {
    const dms = JSON.parse(decodeUtf16(parts.get("DataModelSchema")!));
    assert.equal(dms.name, "Collectables-Starter");
    const table = dms.model.tables.find(
      (t: { name: string }) => t.name === "analytics_events",
    );
    assert.ok(table, "analytics_events table must be in the model");
    const names = table.measures.map((m: { name: string }) => m.name);
    for (const m of MEASURE_NAMES) {
      assert.ok(names.includes(m), `measure ${m} missing from DataModelSchema`);
    }
  });

  it("measure expressions filter on the typed-union event names", () => {
    const dms = JSON.parse(decodeUtf16(parts.get("DataModelSchema")!));
    const table = dms.model.tables.find(
      (t: { name: string }) => t.name === "analytics_events",
    );
    const all = table.measures
      .map((m: { expression: string }) => m.expression)
      .join("\n");
    assert.match(all, /DISTINCTCOUNT\s*\(\s*analytics_events\[user_id\]/);
    for (const ev of [
      "item_added",
      "listing_created",
      "signup_completed",
      "premium_activated",
    ]) {
      assert.match(all, new RegExp(`"${ev}"`), `event ${ev} not referenced`);
    }
  });

  it("DataMashup is a well-formed [MS-QDEFF] package", () => {
    const q = parseDataMashup(parts.get("DataMashup")!);
    assert.equal(q.version, 0, "QDEFF version header must be 0");
    assert.equal(
      q.consumed,
      q.total,
      "every length-prefixed QDEFF section must account for the whole buffer",
    );
  });

  it("embedded Section1.m promotes the 4 Supabase params + keeps the query", () => {
    const q = parseDataMashup(parts.get("DataMashup")!);
    const inner = readZip(q.packageParts);
    assert.ok(
      inner.has("Formulas/Section1.m"),
      "DataMashup package must embed Formulas/Section1.m",
    );
    const m = inner.get("Formulas/Section1.m")!.toString("utf8");
    for (const p of PARAM_NAMES) {
      assert.match(
        m,
        new RegExp(`shared\\s+${p}\\s*=.*IsParameterQuery=true`),
        `${p} must be promoted to a real Power Query parameter`,
      );
    }
    // Query body taken verbatim from queries.m (#15a single source of truth).
    assert.match(m, /PostgreSQL\.Database\s*\(\s*Server\s*,\s*SupabaseDb\s*\)/);
    assert.match(m, /Item\s*=\s*"analytics_events"/);
    assert.match(m, /try\s+Json\.Document\(_\)\s+otherwise\s+null/);
  });

  it("every measure in measures.dax made it into the .pbit (parity)", () => {
    const dax = readFileSync(
      join(ROOT, "docs", "powerbi", "measures.dax"),
      "utf8",
    );
    const dms = JSON.parse(decodeUtf16(parts.get("DataModelSchema")!));
    const table = dms.model.tables.find(
      (t: { name: string }) => t.name === "analytics_events",
    );
    const names: string[] = table.measures.map((m: { name: string }) => m.name);
    for (const name of MEASURE_NAMES) {
      assert.match(dax, new RegExp(`\\b${name}\\s*:=`), `${name} not in measures.dax`);
      assert.ok(names.includes(name), `${name} drifted out of the .pbit`);
    }
  });
});

describe("scripts/build-powerbi-template.ts (Analytics #15b)", () => {
  const src = readFileSync(join(ROOT, SCRIPT), "utf8");

  it("reads the #15a text assets — no re-roll of the query/measures", () => {
    assert.match(src, /queries\.m/);
    assert.match(src, /measures\.dax/);
    // The DAX expressions must NOT be hardcoded in the generator.
    assert.doesNotMatch(src, /DATESINPERIOD/);
    assert.doesNotMatch(src, /PremiumConversionRate7d/);
  });

  it("builds the DataMashup + promotes parameters", () => {
    assert.match(src, /IsParameterQuery=true/);
    assert.match(src, /buildDataMashup/);
    for (const p of PARAM_NAMES) {
      assert.match(src, new RegExp(p), `${p} not referenced by the generator`);
    }
  });

  it("is wired into package.json as build:powerbi", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["build:powerbi"],
      "tsx scripts/build-powerbi-template.ts",
    );
  });
});

describe("docs reference the shipped .pbit (Analytics #15b)", () => {
  it("README + connection doc point at the binary + regen command", () => {
    const readme = readFileSync(
      join(ROOT, "docs", "powerbi", "README.md"),
      "utf8",
    );
    const conn = readFileSync(
      join(ROOT, "docs", "powerbi-connection.md"),
      "utf8",
    );
    assert.match(readme, /Collectables-Starter\.pbit/);
    assert.match(readme, /build:powerbi/);
    assert.match(conn, /Collectables-Starter\.pbit/);
  });
});
