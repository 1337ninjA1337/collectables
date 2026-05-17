import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildAnalyticsQueryExpression,
  buildDataMashup,
  buildPbit,
  buildSection1M,
  crc32,
  parseMeasures,
  parseQueryParameters,
  PBIT_PART_NAMES,
  zipStore,
  type ZipEntry,
} from "../lib/powerbi-template";

const ROOT = join(__dirname, "..");
const QUERIES_M = join(ROOT, "docs/powerbi/queries.m");
const MEASURES_DAX = join(ROOT, "docs/powerbi/measures.dax");
const PBIT = join(ROOT, "docs/powerbi/Collectables-Starter.pbit");

function readSource() {
  return {
    queriesM: readFileSync(QUERIES_M, "utf8"),
    measuresDax: readFileSync(MEASURES_DAX, "utf8"),
  };
}

// Minimal STORE-method ZIP reader (mirrors the writer in lib/powerbi-template).
function readZipEntries(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, "ZIP must have an end-of-central-directory record");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50, "central directory signature");
    const method = zip.readUInt16LE(p + 10);
    assert.equal(method, 0, "all entries must use STORE (method 0)");
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    assert.equal(zip.readUInt32LE(localOff), 0x04034b50, "local header signature");
    const lhNameLen = zip.readUInt16LE(localOff + 26);
    const lhExtraLen = zip.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    out.set(name, zip.subarray(dataStart, dataStart + size));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function decodeUtf16le(buf: Buffer): string {
  return buf.toString("utf16le").replace(/^﻿/, "");
}

describe("powerbi-template — source parsing (Analytics #15b)", () => {
  it("extracts the four Supabase parameters from queries.m", () => {
    const params = parseQueryParameters(readSource().queriesM);
    assert.deepEqual(
      params.map((p) => p.name),
      ["SupabaseHost", "SupabasePort", "SupabaseDb", "SupabaseSchema"],
    );
    const byName = Object.fromEntries(params.map((p) => [p.name, p.defaultValue]));
    assert.equal(byName.SupabasePort, "5432");
    assert.equal(byName.SupabaseDb, "postgres");
    assert.equal(byName.SupabaseSchema, "public");
    assert.match(byName.SupabaseHost, /pooler\.supabase\.com/);
  });

  it("never mistakes a downstream M step for a parameter", () => {
    const names = parseQueryParameters(readSource().queriesM).map((p) => p.name);
    for (const step of ["Server", "Source", "Events", "Typed", "Parsed"]) {
      assert.ok(!names.includes(step), `${step} is a step, not a parameter`);
    }
  });

  it("parses every DAX measure with a non-empty expression", () => {
    const measures = parseMeasures(readSource().measuresDax);
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
    for (const m of measures) {
      assert.ok(m.expression.length > 0, `${m.name} expression must be non-empty`);
      assert.ok(!m.expression.includes(":="), `${m.name} must not swallow the next header`);
    }
    const dau = measures.find((m) => m.name === "DAU");
    assert.match(dau!.expression, /DISTINCTCOUNT\s*\(\s*analytics_events\[user_id\]/);
  });

  it("re-derives the analytics_events query without the inline param literals", () => {
    const { queriesM } = readSource();
    const params = parseQueryParameters(queriesM);
    const query = buildAnalyticsQueryExpression(queriesM, params);
    assert.match(query, /^let/);
    assert.match(query, /PostgreSQL\.Database\(Server, SupabaseDb\)/);
    assert.match(query, /in\s+Parsed$/);
    // The four parameter literal lines must NOT survive in the query body —
    // they become top-level shared parameters instead.
    for (const p of params) {
      assert.ok(
        !new RegExp(`^\\s*${p.name}\\s*=\\s*"`, "m").test(query),
        `${p.name} literal must be lifted out of the query body`,
      );
    }
  });
});

describe("powerbi-template — Section1.m mashup (Analytics #15b)", () => {
  it("declares each parameter as a prompt-on-open parameter query", () => {
    const m = buildSection1M(readSource());
    assert.match(m, /^section Section1;/);
    for (const name of ["SupabaseHost", "SupabasePort", "SupabaseDb", "SupabaseSchema"]) {
      assert.match(
        m,
        new RegExp(`shared ${name} = "[^"]*" meta \\[IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true\\];`),
      );
    }
    assert.match(m, /shared analytics_events = let/);
    assert.match(m, /PostgreSQL\.Database/);
  });
});

describe("powerbi-template — ZIP/CRC primitives (Analytics #15b)", () => {
  it("crc32 matches the canonical IEEE check value", () => {
    assert.equal(crc32(Buffer.from("123456789", "ascii")), 0xcbf43926);
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });

  it("zipStore produces a re-readable STORE archive", () => {
    const entries: ZipEntry[] = [
      { name: "a.txt", data: Buffer.from("hello", "utf8") },
      { name: "dir/b.bin", data: Buffer.from([0, 1, 2, 255]) },
    ];
    const zip = zipStore(entries);
    assert.equal(zip.readUInt32LE(0), 0x04034b50, "starts with a local file header");
    const read = readZipEntries(zip);
    assert.equal(read.size, 2);
    assert.equal(read.get("a.txt")!.toString("utf8"), "hello");
    assert.deepEqual([...read.get("dir/b.bin")!], [0, 1, 2, 255]);
  });

  it("is deterministic — same input yields byte-identical output", () => {
    const e: ZipEntry[] = [{ name: "x", data: Buffer.from("y") }];
    assert.ok(zipStore(e).equals(zipStore(e)));
  });
});

describe("powerbi-template — DataMashup framing (Analytics #15b)", () => {
  it("emits a well-framed MS-QDEFF stream that is fully consumed", () => {
    const mashup = buildDataMashup(buildSection1M(readSource()));
    assert.equal(mashup.readInt32LE(0), 0, "QDEFF version field is 0");
    let o = 4;
    const partsLen = mashup.readInt32LE(o);
    o += 4;
    const parts = mashup.subarray(o, o + partsLen);
    o += partsLen;
    const permLen = mashup.readInt32LE(o);
    o += 4 + permLen;
    const metaLen = mashup.readInt32LE(o);
    o += 4 + metaLen;
    const pbLen = mashup.readInt32LE(o);
    o += 4 + pbLen;
    assert.equal(o, mashup.length, "every QDEFF section must be exactly consumed");
    assert.equal(pbLen, 0, "permission bindings are empty");

    const ppEntries = readZipEntries(parts);
    assert.ok(ppEntries.has("Formulas/Section1.m"));
    assert.ok(ppEntries.has("Config/Package.xml"));
    const section = ppEntries.get("Formulas/Section1.m")!.toString("utf8");
    assert.match(section, /shared SupabaseHost = /);
    assert.match(section, /shared analytics_events = let/);
  });
});

describe("powerbi-template — .pbit assembly (Analytics #15b)", () => {
  const pbit = buildPbit(readSource());
  const parts = readZipEntries(pbit);

  it("contains exactly the expected OPC parts", () => {
    assert.deepEqual([...parts.keys()].sort(), [...PBIT_PART_NAMES].sort());
  });

  it("DataModelSchema is UTF-16LE JSON with the table, params and measures", () => {
    const json = JSON.parse(decodeUtf16le(parts.get("DataModelSchema")!));
    assert.equal(json.compatibilityLevel, 1567);
    const table = json.model.tables[0];
    assert.equal(table.name, "analytics_events");
    assert.deepEqual(
      table.columns.map((c: { name: string }) => c.name),
      ["id", "occurred_at", "user_id", "name", "properties"],
    );
    assert.match(table.partitions[0].source.expression, /PostgreSQL\.Database/);
    assert.ok(table.measures.some((m: { name: string }) => m.name === "DAU"));
    assert.ok(
      table.measures.some((m: { name: string }) => m.name === "PremiumConversionRate7d"),
    );
    assert.deepEqual(
      json.model.expressions.map((e: { name: string }) => e.name),
      ["SupabaseHost", "SupabasePort", "SupabaseDb", "SupabaseSchema"],
    );
  });

  it("Report/Layout, Settings and Metadata are UTF-16LE JSON", () => {
    const layout = JSON.parse(decodeUtf16le(parts.get("Report/Layout")!));
    assert.equal(layout.sections.length, 1);
    assert.doesNotThrow(() => JSON.parse(decodeUtf16le(parts.get("Settings")!)));
    const meta = JSON.parse(decodeUtf16le(parts.get("Metadata")!));
    assert.equal(meta.createdFromTemplate, true);
  });

  it("[Content_Types].xml overrides every no-extension part", () => {
    const ct = parts.get("[Content_Types].xml")!.toString("utf8");
    for (const name of PBIT_PART_NAMES) {
      if (name === "[Content_Types].xml") continue;
      assert.ok(
        ct.includes(`PartName="/${name}"`),
        `Content_Types must declare an Override for /${name}`,
      );
    }
  });

  it("Version part is plain-text 3.0", () => {
    assert.equal(parts.get("Version")!.toString("ascii"), "3.0");
  });
});

describe("powerbi-template — committed artifact parity (Analytics #15b)", () => {
  it("docs/powerbi/Collectables-Starter.pbit is checked in", () => {
    assert.ok(existsSync(PBIT), "the generated .pbit must ship in the repo");
  });

  it("the committed .pbit is byte-identical to a fresh build (no drift)", () => {
    const committed = readFileSync(PBIT);
    const fresh = buildPbit(readSource());
    assert.ok(
      committed.equals(fresh),
      "Collectables-Starter.pbit is stale — run `npm run build:powerbi` after editing queries.m/measures.dax",
    );
  });
});

describe("powerbi-template — wiring & purity (Analytics #15b)", () => {
  it("package.json exposes the build:powerbi script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["build:powerbi"], "tsx scripts/build-powerbi-template.ts");
  });

  it("the build script delegates to the pure lib module", () => {
    const script = readFileSync(join(ROOT, "scripts/build-powerbi-template.ts"), "utf8");
    assert.match(script, /from "\.\.\/lib\/powerbi-template"/);
    assert.match(script, /buildPbit/);
    assert.match(script, /Collectables-Starter\.pbit/);
  });

  it("lib/powerbi-template.ts stays free of the react-native bundle", () => {
    const src = readFileSync(join(ROOT, "lib/powerbi-template.ts"), "utf8");
    assert.ok(!/from ["']react-native["']/.test(src));
    assert.ok(!/from ["']@?expo/.test(src));
  });
});
