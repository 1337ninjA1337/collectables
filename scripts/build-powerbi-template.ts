/**
 * Analytics #15b — generate docs/powerbi/Collectables-Starter.pbit.
 *
 * The .pbit is an OPC (ZIP) package. Its CI-verifiable contract is the
 * package structure + the embedded M / DAX text; the text source of truth
 * lives in docs/powerbi/queries.m + docs/powerbi/measures.dax (Analytics
 * #15a) and is read here verbatim — this script never re-rolls the query or
 * the measures. Final "opens cleanly in Power BI Desktop" validation is a
 * manual step (documented in docs/powerbi/README.md) because Power BI
 * Desktop is Windows-only and cannot run in CI.
 *
 * Regenerate with: npm run build:powerbi
 */
import { deflateRawSync } from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "..");
const POWERBI_DIR = path.join(ROOT, "docs", "powerbi");
const QUERIES_M = path.join(POWERBI_DIR, "queries.m");
const MEASURES_DAX = path.join(POWERBI_DIR, "measures.dax");
const OUT_PBIT = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

const MODEL_NAME = "Collectables-Starter";
const TABLE = "analytics_events";
const PARAM_NAMES = [
  "SupabaseHost",
  "SupabasePort",
  "SupabaseDb",
  "SupabaseSchema",
] as const;

// ── CRC-32 (ZIP) ───────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Minimal ZIP writer (dependency-free) ───────────────────────────────────
interface ZipEntry {
  name: string;
  data: Buffer;
  store?: boolean;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const uncompressed = e.data.length;
    const compressed = e.store ? e.data : deflateRawSync(e.data);
    const method = e.store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // central dir disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ── UTF-16LE encoder (Power BI part convention, BOM-prefixed) ──────────────
function utf16le(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

// ── Parse Analytics #15a text assets (single source of truth) ──────────────
function stripMComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

function readQueryParts(): { defaults: Record<string, string>; steps: string } {
  const raw = stripMComments(fs.readFileSync(QUERIES_M, "utf8"));
  const defaults: Record<string, string> = {};
  for (const name of PARAM_NAMES) {
    const m = raw.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
    if (!m) throw new Error(`queries.m: missing parameter ${name}`);
    defaults[name] = m[1];
  }
  const letBody = raw.slice(raw.indexOf("let") + 3, raw.lastIndexOf("in"));
  // Drop the four parameter assignment lines — they become `shared`
  // parameter declarations in Section1.m; the remaining steps are the
  // analytics_events query body, taken verbatim from queries.m.
  const steps = letBody
    .split("\n")
    .filter((l) => !PARAM_NAMES.some((p) => new RegExp(`^\\s*${p}\\s*=`).test(l)))
    .join("\n")
    .replace(/^\s*\n+/, "")
    .replace(/,\s*$/, "")
    .trimEnd();
  if (!/PostgreSQL\.Database/.test(steps) || !/analytics_events/.test(steps)) {
    throw new Error("queries.m: query body did not parse as expected");
  }
  return { defaults, steps };
}

interface Measure {
  name: string;
  expression: string;
}

function readMeasures(): Measure[] {
  const lines = fs
    .readFileSync(MEASURES_DAX, "utf8")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l));
  const measures: Measure[] = [];
  let current: Measure | null = null;
  for (const line of lines) {
    const head = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.*)$/);
    if (head) {
      if (current) {
        current.expression = current.expression.trim();
        measures.push(current);
      }
      current = { name: head[1], expression: head[2] };
    } else if (current) {
      current.expression += "\n" + line;
    }
  }
  if (current) {
    current.expression = current.expression.trim();
    measures.push(current);
  }
  if (measures.length === 0) throw new Error("measures.dax: no measures parsed");
  return measures;
}

// ── Section1.m (DataMashup formula section) ────────────────────────────────
function buildSection1(defaults: Record<string, string>, steps: string): string {
  const meta =
    ' meta [IsParameterQuery=true, IsParameterQueryRequired=true, Type="Text", List={}]';
  const params = PARAM_NAMES.map(
    (p) => `shared ${p} = "${defaults[p]}"${meta};`,
  ).join("\n");
  return `section Section1;

${params}

shared #"${TABLE}" = let
${steps}
in
    Parsed;
`;
}

// ── DataMashup ([MS-QDEFF]) part ───────────────────────────────────────────
function buildDataMashup(section1: string): Buffer {
  const partsContentTypes =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="m" ContentType="" />' +
    '<Default Extension="xml" ContentType="text/xml" />' +
    "</Types>";
  const packageXml =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Package xmlns="http://schemas.microsoft.com/DataMashup">' +
    "<Version>2.119.0.0</Version><MinVersion>2.21.0.0</MinVersion>" +
    "<Culture>en-US</Culture><MinCulture>en-US</MinCulture>" +
    "<Items><Item><ItemLocation><ItemType>AllFormulas</ItemType>" +
    "<ItemPath /></ItemLocation><StableEntries /></Item></Items></Package>";
  const packageParts = buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(partsContentTypes, "utf8") },
    { name: "Config/Package.xml", data: Buffer.from(packageXml, "utf8") },
    { name: "Formulas/Section1.m", data: Buffer.from(section1, "utf8"), store: true },
  ]);

  const permissions =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<PermissionList xmlns="http://schemas.microsoft.com/DataMashup">' +
    "<CanEvaluateFuturePackages>false</CanEvaluateFuturePackages>" +
    "<FirewallEnabled>true</FirewallEnabled>" +
    '<WorkbookGroupType xsi:nil="true" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" />' +
    "</PermissionList>";
  const permissionsBuf = Buffer.from(permissions, "utf8");

  const metadataXml =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<LocalPackageMetadataFile ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<Items><Item><ItemLocation><ItemType>AllFormulas</ItemType>" +
    "<ItemPath /></ItemLocation><StableEntries /></Item></Items>" +
    "</LocalPackageMetadataFile>";
  const metadataXmlBuf = Buffer.from(metadataXml, "utf8");
  // Metadata = version(0) + xmlLen + xml + contentLen(0)
  const metadata = Buffer.alloc(4 + 4 + metadataXmlBuf.length + 4);
  metadata.writeUInt32LE(0, 0);
  metadata.writeUInt32LE(metadataXmlBuf.length, 4);
  metadataXmlBuf.copy(metadata, 8);
  metadata.writeUInt32LE(0, 8 + metadataXmlBuf.length);

  const header = Buffer.alloc(4);
  header.writeUInt32LE(0, 0); // QDEFF version

  const lenBuf = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
  };

  return Buffer.concat([
    header,
    lenBuf(packageParts.length),
    packageParts,
    lenBuf(permissionsBuf.length),
    permissionsBuf,
    lenBuf(metadata.length),
    metadata,
    lenBuf(0), // PermissionBindings (unsigned mashup — Power BI regenerates)
  ]);
}

// ── DataModelSchema (TMSL) ─────────────────────────────────────────────────
function buildDataModelSchema(measures: Measure[]): string {
  const columns = [
    { name: "id", dataType: "string" },
    { name: "occurred_at", dataType: "dateTime" },
    { name: "user_id", dataType: "string" },
    { name: "name", dataType: "string" },
    { name: "properties", dataType: "string" },
  ].map((c) => ({
    name: c.name,
    dataType: c.dataType,
    sourceColumn: c.name,
    summarizeBy: "none",
  }));

  const model = {
    name: MODEL_NAME,
    compatibilityLevel: 1567,
    model: {
      culture: "en-US",
      dataAccessOptions: {
        legacyRedirects: true,
        returnErrorValuesAsNull: true,
      },
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      tables: [
        {
          name: TABLE,
          columns,
          partitions: [
            {
              name: TABLE,
              mode: "import",
              source: { type: "m", expression: `let\n    Source = ${TABLE}\nin\n    Source` },
            },
          ],
          measures: measures.map((m) => ({
            name: m.name,
            expression: m.expression,
          })),
        },
      ],
      annotations: [
        { name: "PBI_QueryOrder", value: JSON.stringify([TABLE]) },
        { name: "__PBI_TimeIntelligenceEnabled", value: "0" },
      ],
    },
  };
  return JSON.stringify(model, null, 2);
}

// ── Report/Layout ──────────────────────────────────────────────────────────
function buildReportLayout(): string {
  return JSON.stringify({
    id: 0,
    resourcePackages: [
      {
        resourcePackage: {
          name: "SharedResources",
          type: 2,
          items: [{ type: 202, path: "BaseThemes/CY24SU10.json", name: "CY24SU10" }],
          disabled: false,
        },
      },
    ],
    sections: [
      {
        id: 0,
        name: "ReportSection",
        displayName: "DAU & funnel",
        filters: "[]",
        ordinal: 0,
        visualContainers: [],
        config: "{}",
        displayOption: 1,
        width: 1280,
        height: 720,
      },
    ],
    config: JSON.stringify({
      version: "5.43",
      themeCollection: { baseTheme: { name: "CY24SU10" } },
      activeSectionIndex: 0,
      settings: { useStylableVisualContainerHeader: true },
    }),
    layoutOptimization: 0,
  });
}

function main(): void {
  const { defaults, steps } = readQueryParts();
  const measures = readMeasures();
  const section1 = buildSection1(defaults, steps);

  const contentTypes =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="json" ContentType="application/json" />' +
    '<Override PartName="/Version" ContentType="text/plain" />' +
    '<Override PartName="/DataModelSchema" ContentType="application/json" />' +
    '<Override PartName="/DiagramLayout" ContentType="application/json" />' +
    '<Override PartName="/Report/Layout" ContentType="application/json" />' +
    '<Override PartName="/Settings" ContentType="application/json" />' +
    '<Override PartName="/Metadata" ContentType="application/json" />' +
    '<Override PartName="/DataMashup" ContentType="application/octet-stream" />' +
    "</Types>";

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "Version", data: Buffer.from("3.0", "utf8") },
    { name: "DataModelSchema", data: utf16le(buildDataModelSchema(measures)) },
    { name: "DiagramLayout", data: utf16le(JSON.stringify({ version: "1.1.0", diagrams: [] })) },
    { name: "Report/Layout", data: utf16le(buildReportLayout()) },
    { name: "Settings", data: utf16le(JSON.stringify({ version: "5.43" })) },
    {
      name: "Metadata",
      data: utf16le(
        JSON.stringify({
          version: "5.43",
          createdFrom: "Collectables Analytics #15b generator",
          fileDescription:
            "Collectables analytics starter — DAU + listing funnel + premium conversion.",
        }),
      ),
    },
    { name: "DataMashup", data: buildDataMashup(section1), store: true },
  ];

  fs.writeFileSync(OUT_PBIT, buildZip(entries));
  console.log(
    `[build-powerbi-template] wrote ${path.relative(ROOT, OUT_PBIT)} ` +
      `(${measures.length} measures, ${PARAM_NAMES.length} parameters)`,
  );
}

main();
