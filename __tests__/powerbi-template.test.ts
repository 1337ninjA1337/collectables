import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { inflateRawSync } from "node:zlib";

import {
  PBIT_VERSION,
  buildContentTypesXml,
  buildDataMashup,
  buildDataModelSchema,
  buildPbit,
  buildReportLayout,
  buildSectionM,
  createZip,
  encodeUtf16LeBom,
  parseDataMashup,
  parseDaxMeasures,
  parseMQuery,
} from "../lib/powerbi-template";

const ROOT = join(__dirname, "..");
const QUERIES_M = readFileSync(join(ROOT, "docs/powerbi/queries.m"), "utf8");
const MEASURES_DAX = readFileSync(join(ROOT, "docs/powerbi/measures.dax"), "utf8");
const PBIT_PATH = join(ROOT, "docs/powerbi/Collectables-Starter.pbit");

const PARAM_NAMES = ["SupabaseHost", "SupabasePort", "SupabaseDb", "SupabaseSchema"];

/** Walk a ZIP central directory and return { name -> uncompressed bytes }. */
function readZip(buf: Buffer): Record<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, "no End Of Central Directory record found");
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let n = 0; n < count; n++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50, "bad central dir signature");
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out[name] = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function stripBom(buf: Buffer): string {
  return buf[0] === 0xff && buf[1] === 0xfe
    ? buf.subarray(2).toString("utf16le")
    : buf.toString("utf8");
}

describe("parseMQuery (Analytics #15b)", () => {
  it("extracts the four Supabase parameters with defaults", () => {
    const parsed = parseMQuery(QUERIES_M);
    assert.deepEqual(
      parsed.parameters.map((p) => p.name).sort(),
      [...PARAM_NAMES].sort(),
    );
    const port = parsed.parameters.find((p) => p.name === "SupabasePort");
    assert.equal(port?.defaultValue, "5432");
    const db = parsed.parameters.find((p) => p.name === "SupabaseDb");
    assert.equal(db?.defaultValue, "postgres");
  });

  it("captures the transformation steps and the return target", () => {
    const parsed = parseMQuery(QUERIES_M);
    assert.equal(parsed.returnStep, "Parsed");
    const body = parsed.bodySteps.join("\n");
    assert.match(body, /PostgreSQL\.Database/);
    assert.match(body, /analytics_events/);
    // The four parameter literals must NOT remain as body steps.
    for (const name of PARAM_NAMES) {
      assert.ok(
        !parsed.bodySteps.some((s) => new RegExp(`^${name}\\s*=`).test(s.trim())),
        `${name} must be promoted out of the body`,
      );
    }
  });

  it("throws when a required parameter is missing", () => {
    assert.throws(() => parseMQuery('let A = "x", B = A in B'), /expected parameters/);
  });
});

describe("parseDaxMeasures (Analytics #15b)", () => {
  it("parses every measure block from measures.dax", () => {
    const measures = parseDaxMeasures(MEASURES_DAX);
    const names = measures.map((m) => m.name);
    for (const expected of [
      "DAU",
      "ItemsAdded",
      "ListingsCreated",
      "ListingFunnelRate",
      "SignupsLast7d",
      "PremiumActivationsLast7d",
      "PremiumConversionRate7d",
    ]) {
      assert.ok(names.includes(expected), `missing measure ${expected}`);
    }
  });

  it("keeps each measure expression non-empty and parameter-free", () => {
    for (const m of parseDaxMeasures(MEASURES_DAX)) {
      assert.ok(m.expression.length > 0, `${m.name} has an empty expression`);
      assert.ok(!m.expression.includes(":="), `${m.name} expression leaked a header`);
    }
  });

  it("throws on input with no measure blocks", () => {
    assert.throws(() => parseDaxMeasures("// just a comment\n"), /no .* measure blocks/);
  });
});

describe("buildSectionM (Analytics #15b)", () => {
  it("promotes the four literals to Power Query parameters", () => {
    const m = buildSectionM(parseMQuery(QUERIES_M));
    assert.match(m, /^section Section1;/);
    for (const name of PARAM_NAMES) {
      assert.match(
        m,
        new RegExp(`shared ${name} = ".*?" meta \\[IsParameterQuery=true`),
        `${name} must be a prompting parameter`,
      );
    }
    assert.match(m, /shared #"analytics_events" =/);
    assert.match(m, /PostgreSQL\.Database/);
  });
});

describe("createZip (Analytics #15b)", () => {
  it("produces a readable, round-trippable archive", () => {
    const zip = createZip([
      { name: "a.txt", data: Buffer.from("hello world") },
      { name: "dir/b.bin", data: Buffer.alloc(2048, 7) },
    ]);
    assert.equal(zip.readUInt32LE(0), 0x04034b50, "must start with a local file header");
    const parts = readZip(zip);
    assert.equal(parts["a.txt"].toString("utf8"), "hello world");
    assert.equal(parts["dir/b.bin"].length, 2048);
    assert.ok(parts["dir/b.bin"].every((b) => b === 7));
  });

  it("is deterministic for identical input", () => {
    const mk = () => createZip([{ name: "x", data: Buffer.from("same") }]);
    assert.ok(mk().equals(mk()));
  });
});

describe("encodeUtf16LeBom (Analytics #15b)", () => {
  it("prefixes the little-endian BOM Power BI expects", () => {
    const buf = encodeUtf16LeBom("Aé");
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xfe);
    assert.equal(stripBom(buf), "Aé");
  });
});

describe("buildDataMashup (Analytics #15b)", () => {
  it("serialises the [MS-QDEFF] layout and round-trips", () => {
    const section = buildSectionM(parseMQuery(QUERIES_M));
    const dm = buildDataMashup(section);
    const parsed = parseDataMashup(dm);
    assert.equal(parsed.version, 0);
    assert.match(parsed.permissions, /<PermissionList/);
    assert.equal(parsed.metadata.readUInt32LE(0), 0, "metadata version dword must be 0");
    assert.equal(parsed.permissionBindings.length, 0);
  });

  it("embeds Section1.m + the OPC parts in the package zip", () => {
    const section = buildSectionM(parseMQuery(QUERIES_M));
    const { packageZip } = parseDataMashup(buildDataMashup(section));
    const parts = readZip(packageZip);
    assert.ok(parts["[Content_Types].xml"], "missing inner [Content_Types].xml");
    assert.ok(parts["Config/Package.xml"], "missing Config/Package.xml");
    assert.equal(parts["Formulas/Section1.m"].toString("utf8"), section);
  });
});

describe("buildContentTypesXml / buildReportLayout / buildDataModelSchema", () => {
  it("declares every required OPC part override", () => {
    const xml = buildContentTypesXml();
    for (const part of [
      "/Version",
      "/DataModelSchema",
      "/DiagramLayout",
      "/Report/Layout",
      "/DataMashup",
      "/Settings",
      "/Metadata",
    ]) {
      assert.ok(xml.includes(`PartName="${part}"`), `missing override for ${part}`);
    }
  });

  it("emits a parseable single-section report layout", () => {
    const layout = JSON.parse(buildReportLayout()) as {
      sections: { name: string }[];
    };
    assert.equal(layout.sections.length, 1);
    assert.equal(layout.sections[0].name, "ReportSection");
  });

  it("models the table, columns, measures and parameter expressions", () => {
    const parsed = parseMQuery(QUERIES_M);
    const measures = parseDaxMeasures(MEASURES_DAX);
    const model = JSON.parse(buildDataModelSchema(parsed, measures)) as {
      model: {
        tables: {
          name: string;
          columns: { name: string }[];
          measures: { name: string }[];
        }[];
        expressions: { name: string; expression: string }[];
      };
    };
    const table = model.model.tables[0];
    assert.equal(table.name, "analytics_events");
    for (const col of ["id", "occurred_at", "user_id", "name", "properties"]) {
      assert.ok(
        table.columns.some((c) => c.name === col),
        `model missing column ${col}`,
      );
    }
    assert.equal(table.measures.length, measures.length);
    assert.deepEqual(
      model.model.expressions.map((e) => e.name).sort(),
      [...PARAM_NAMES].sort(),
    );
    for (const e of model.model.expressions) {
      assert.match(e.expression, /IsParameterQuery=true/);
    }
  });
});

describe("buildPbit (Analytics #15b)", () => {
  const pbit = buildPbit({ queriesM: QUERIES_M, measuresDax: MEASURES_DAX });

  it("is a valid ZIP carrying all eight OPC parts", () => {
    const parts = readZip(pbit);
    for (const name of [
      "[Content_Types].xml",
      "Version",
      "DataModelSchema",
      "DiagramLayout",
      "Settings",
      "Metadata",
      "Report/Layout",
      "DataMashup",
    ]) {
      assert.ok(parts[name], `pbit missing part ${name}`);
    }
    assert.equal(stripBom(parts.Version), PBIT_VERSION);
  });

  it("is deterministic so the committed binary is regression-testable", () => {
    const again = buildPbit({ queriesM: QUERIES_M, measuresDax: MEASURES_DAX });
    assert.ok(pbit.equals(again), "buildPbit output must be byte-stable");
  });

  it("ships the parameters + measures inside the model", () => {
    const parts = readZip(pbit);
    const model = JSON.parse(stripBom(parts.DataModelSchema)) as {
      model: { tables: { measures: { name: string }[] }[] };
    };
    const measureNames = model.model.tables[0].measures.map((m) => m.name);
    assert.ok(measureNames.includes("DAU"));
    assert.ok(measureNames.includes("ListingFunnelRate"));

    const { packageZip } = parseDataMashup(parts.DataMashup);
    const section = readZip(packageZip)["Formulas/Section1.m"].toString("utf8");
    for (const name of PARAM_NAMES) {
      assert.match(section, new RegExp(`shared ${name} =`));
    }
  });

  it("matches the committed docs/powerbi/Collectables-Starter.pbit", () => {
    assert.ok(existsSync(PBIT_PATH), "the generated .pbit must be committed");
    const onDisk = readFileSync(PBIT_PATH);
    assert.ok(
      onDisk.equals(pbit),
      "committed .pbit is stale — re-run `npm run build:powerbi`",
    );
  });
});

describe("Analytics #15b wiring + purity", () => {
  it("lib/powerbi-template.ts pulls in no react-native / SDK deps", () => {
    const src = readFileSync(join(ROOT, "lib/powerbi-template.ts"), "utf8");
    assert.doesNotMatch(src, /from ["']react-native/);
    assert.doesNotMatch(src, /@sentry|posthog|@supabase/);
  });

  it("package.json exposes the build:powerbi script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["build:powerbi"], /build-powerbi-template/);
  });

  it("docs reference the generated template + smoke-test gate", () => {
    const readme = readFileSync(join(ROOT, "docs/powerbi/README.md"), "utf8");
    assert.match(readme, /Collectables-Starter\.pbit/);
    const manual = readFileSync(join(ROOT, "MANUAL-TASKS.md"), "utf8");
    assert.match(manual, /Collectables-Starter\.pbit/);
    assert.match(manual, /Power BI Desktop/);
  });
});
