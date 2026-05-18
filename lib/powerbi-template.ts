// Power BI .pbit (template) generator — pure module (Analytics #15b).
//
// A .pbit is an OPC (Open Packaging Conventions) ZIP package. The Power
// Query mashup is embedded as a [MS-QDEFF] "DataMashup" part. This module
// is intentionally free of `react-native`/SDK imports (only `node:zlib`)
// so it is unit-testable and reusable from the build script.
//
// CI has no Power BI Desktop, so the binary cannot be opened/validated
// here. The verifiable text sources (docs/powerbi/queries.m +
// measures.dax) remain the source of truth and the copy-paste fallback;
// the generated .pbit is gated by a one-time human smoke-test documented
// in MANUAL-TASKS.md.

import { deflateRawSync } from "node:zlib";

export interface MQueryParameter {
  name: string;
  defaultValue: string;
}

export interface ParsedMQuery {
  parameters: MQueryParameter[];
  /** The step lines between the parameter block and the final `in` target. */
  bodySteps: string[];
  /** The identifier returned by the query (the `in <X>` target). */
  returnStep: string;
}

export interface DaxMeasure {
  name: string;
  expression: string;
}

const PARAM_NAMES = [
  "SupabaseHost",
  "SupabasePort",
  "SupabaseDb",
  "SupabaseSchema",
] as const;

/**
 * Parse the 15a `docs/powerbi/queries.m` into its parameter declarations
 * and the remaining transformation steps so the generated Section1.m can
 * promote the four literals into real Power Query parameters (Power BI
 * then prompts for them when the template is opened).
 */
export function parseMQuery(source: string): ParsedMQuery {
  // Drop `//` comment lines and blank lines; they carry no M semantics.
  const code = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

  const letMatch = code.match(/\blet\b([\s\S]*)\bin\b\s*([A-Za-z_][\w]*)/);
  if (!letMatch) {
    throw new Error("parseMQuery: could not locate `let ... in <step>` body");
  }
  const letBody = letMatch[1];
  const returnStep = letMatch[2];

  // Split the let body on top-level commas. The known 15a file has no
  // nested commas at depth 0 between statements that would confuse this
  // (record/list commas live inside brackets, which we track).
  const statements: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of letBody) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      statements.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) statements.push(buf);

  const parameters: MQueryParameter[] = [];
  const bodySteps: string[] = [];
  for (const raw of statements) {
    const stmt = raw.trim();
    if (!stmt) continue;
    const paramMatch = stmt.match(/^([A-Za-z_][\w]*)\s*=\s*"((?:[^"\\]|\\.)*)"$/);
    if (paramMatch && (PARAM_NAMES as readonly string[]).includes(paramMatch[1])) {
      parameters.push({ name: paramMatch[1], defaultValue: paramMatch[2] });
    } else {
      bodySteps.push(stmt);
    }
  }

  const got = parameters.map((p) => p.name).sort();
  const want = [...PARAM_NAMES].sort();
  if (got.join(",") !== want.join(",")) {
    throw new Error(
      `parseMQuery: expected parameters ${want.join(", ")} but found ${got.join(", ") || "none"}`,
    );
  }
  return { parameters, bodySteps, returnStep };
}

/**
 * Parse `docs/powerbi/measures.dax`. Each measure is a `Name :=` line
 * followed by its expression; blocks are separated by blank/comment lines.
 */
export function parseDaxMeasures(source: string): DaxMeasure[] {
  const lines = source.split(/\r?\n/);
  const measures: DaxMeasure[] = [];
  let current: { name: string; lines: string[] } | null = null;

  const flush = () => {
    if (current) {
      const expression = current.lines.join("\n").trim();
      if (expression) measures.push({ name: current.name, expression });
      current = null;
    }
  };

  for (const line of lines) {
    if (/^\s*\/\//.test(line)) {
      // A comment ends the previous measure body.
      flush();
      continue;
    }
    const header = line.match(/^([A-Za-z_][\w]*)\s*:=\s*$/);
    if (header) {
      flush();
      current = { name: header[1], lines: [] };
      continue;
    }
    if (current) {
      if (line.trim() === "" && current.lines.length === 0) continue;
      current.lines.push(line);
    }
  }
  flush();

  if (measures.length === 0) {
    throw new Error("parseDaxMeasures: no `Name :=` measure blocks found");
  }
  return measures;
}

/** Build the Section1.m text with the four literals promoted to params. */
export function buildSectionM(parsed: ParsedMQuery): string {
  const params = parsed.parameters
    .map(
      (p) =>
        `shared ${p.name} = "${p.defaultValue}" meta [IsParameterQuery=true, List={}, DefaultValue="${p.defaultValue}", Type="Text", IsParameterQueryRequired=true];`,
    )
    .join("\n");

  const body = parsed.bodySteps.map((s) => `    ${s}`).join(",\n");

  return [
    "section Section1;",
    "",
    params,
    "",
    `shared #"analytics_events" =`,
    "let",
    body,
    "in",
    `    ${parsed.returnStep};`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic ZIP writer (no timestamps) so the committed .pbit is a
// stable, regression-testable artifact.
// ---------------------------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Minimal deterministic ZIP (deflate, fixed mtime=0, no data descriptors).
 * OPC packages are plain ZIPs; Power BI reads parts by name.
 */
export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const useStore = compressed.length >= entry.data.length;
    const method = useStore ? 0 : 8;
    const payload = useStore ? entry.data : compressed;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time (fixed)
    local.writeUInt16LE(0x21, 12); // mod date (fixed: 1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centrals);
  const localBlock = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBlock, centralDir, eocd]);
}

/** UTF-16 LE with BOM — the encoding Power BI uses for its JSON parts. */
export function encodeUtf16LeBom(text: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, "utf16le"),
  ]);
}

// ---------------------------------------------------------------------------
// [MS-QDEFF] DataMashup part
// ---------------------------------------------------------------------------

const DM_CONTENT_TYPES =
  '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="m" ContentType="" /><Default Extension="xml" ContentType="application/xml" /><Override PartName="/Config/Package.xml" ContentType="" /></Types>';

const DM_PACKAGE_XML =
  '<?xml version="1.0" encoding="utf-8"?><Package xmlns="http://schemas.microsoft.com/DataMashup"><Version>2.0.0</Version><MinVersion>1.5.0.0</MinVersion><Culture>en-US</Culture></Package>';

const DM_PERMISSIONS =
  '<?xml version="1.0" encoding="utf-8"?><PermissionList xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><CanEvaluateFuturePackages>false</CanEvaluateFuturePackages><FirewallEnabled>true</FirewallEnabled><WorkbookGroupType xsi:nil="true" /></PermissionList>';

const DM_METADATA_XML =
  '<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Items><Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath /></ItemLocation><StableEntries /></Item></Items></LocalPackageMetadataFile>';

function lenPrefixed(buf: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

/**
 * Serialise the Power Query mashup into the [MS-QDEFF] binary layout:
 *   Version(0) | PackageParts(zip) | Permissions | Metadata | Bindings
 * Each variable section is length-prefixed with a LE uint32.
 */
export function buildDataMashup(sectionM: string): Buffer {
  const packageZip = createZip([
    { name: "[Content_Types].xml", data: Buffer.from(DM_CONTENT_TYPES, "utf8") },
    { name: "Config/Package.xml", data: Buffer.from(DM_PACKAGE_XML, "utf8") },
    { name: "Formulas/Section1.m", data: Buffer.from(sectionM, "utf8") },
  ]);

  const version = Buffer.alloc(4); // = 0
  const metadataVersion = Buffer.alloc(4); // = 0
  const metadata = Buffer.concat([
    metadataVersion,
    Buffer.from(DM_METADATA_XML, "utf8"),
  ]);
  const permissionBindings = Buffer.alloc(0);

  return Buffer.concat([
    version,
    lenPrefixed(packageZip),
    lenPrefixed(Buffer.from(DM_PERMISSIONS, "utf8")),
    lenPrefixed(metadata),
    lenPrefixed(permissionBindings),
  ]);
}

/** Inverse of {@link buildDataMashup} — used by tests to round-trip. */
export function parseDataMashup(buf: Buffer): {
  version: number;
  packageZip: Buffer;
  permissions: string;
  metadata: Buffer;
  permissionBindings: Buffer;
} {
  let pos = 0;
  const version = buf.readUInt32LE(pos);
  pos += 4;
  const readSection = (): Buffer => {
    const len = buf.readUInt32LE(pos);
    pos += 4;
    const out = buf.subarray(pos, pos + len);
    pos += len;
    return out;
  };
  const packageZip = readSection();
  const permissions = readSection().toString("utf8");
  const metadata = readSection();
  const permissionBindings = readSection();
  return { version, packageZip, permissions, metadata, permissionBindings };
}

// ---------------------------------------------------------------------------
// OPC parts: DataModelSchema (TMSL), Report/Layout, Content_Types, etc.
// ---------------------------------------------------------------------------

export const PBIT_VERSION = "3.0";

export function buildContentTypesXml(): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="json" ContentType="" />' +
    '<Override PartName="/Version" ContentType="" />' +
    '<Override PartName="/Settings" ContentType="" />' +
    '<Override PartName="/Metadata" ContentType="" />' +
    '<Override PartName="/DataModelSchema" ContentType="" />' +
    '<Override PartName="/DiagramLayout" ContentType="" />' +
    '<Override PartName="/Report/Layout" ContentType="" />' +
    '<Override PartName="/DataMashup" ContentType="" />' +
    "</Types>"
  );
}

const ANALYTICS_COLUMNS: { name: string; dataType: string }[] = [
  { name: "id", dataType: "string" },
  { name: "occurred_at", dataType: "dateTime" },
  { name: "user_id", dataType: "string" },
  { name: "name", dataType: "string" },
  { name: "properties", dataType: "string" },
];

/**
 * Build the TMSL data-model schema. Power BI re-evaluates the model from
 * the DataMashup queries on open, so this is the cached shape: the four
 * parameters as `m` expressions, the `analytics_events` table bound to the
 * shared query, and the 15a measures attached to it.
 */
export function buildDataModelSchema(
  parsed: ParsedMQuery,
  measures: DaxMeasure[],
): string {
  const expressions = parsed.parameters.map((p) => ({
    name: p.name,
    kind: "m",
    expression: `"${p.defaultValue}" meta [IsParameterQuery=true, List={}, DefaultValue="${p.defaultValue}", Type="Text", IsParameterQueryRequired=true]`,
    annotations: [{ name: "PBI_NavigationStepName", value: "Navigation" }],
  }));

  const model = {
    name: "Collectables-Starter",
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
          name: "analytics_events",
          columns: ANALYTICS_COLUMNS.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            sourceColumn: c.name,
            summarizeBy: "none",
          })),
          measures: measures.map((m) => ({
            name: m.name,
            expression: m.expression,
          })),
          partitions: [
            {
              name: "analytics_events",
              mode: "import",
              source: {
                type: "m",
                expression: 'let\n    Source = #"analytics_events"\nin\n    Source',
              },
            },
          ],
        },
      ],
      expressions,
      annotations: [
        { name: "PBI_QueryOrder", value: '["analytics_events"]' },
        { name: "__PBI_TimeIntelligenceEnabled", value: "0" },
      ],
    },
  };
  return JSON.stringify(model, null, 2);
}

export function buildReportLayout(): string {
  const layout = {
    id: 0,
    resourcePackages: [],
    config: JSON.stringify({
      version: "5.43",
      themeCollection: { baseTheme: { name: "CY24SU10" } },
      activeSectionIndex: 0,
      settings: { useStylableVisualContainerHeader: true },
    }),
    layoutOptimization: 0,
    sections: [
      {
        id: 0,
        name: "ReportSection",
        displayName: "DAU & Funnel",
        filters: "[]",
        ordinal: 0,
        visualContainers: [],
        config: JSON.stringify({ layouts: [] }),
        displayOption: 1,
        width: 1280,
        height: 720,
      },
    ],
  };
  return JSON.stringify(layout);
}

export interface BuildPbitInput {
  /** Raw text of docs/powerbi/queries.m. */
  queriesM: string;
  /** Raw text of docs/powerbi/measures.dax. */
  measuresDax: string;
}

/**
 * Assemble the full .pbit OPC package from the 15a text sources.
 * Deterministic: identical inputs always yield byte-identical output.
 */
export function buildPbit(input: BuildPbitInput): Buffer {
  const parsed = parseMQuery(input.queriesM);
  const measures = parseDaxMeasures(input.measuresDax);
  const sectionM = buildSectionM(parsed);

  return createZip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(buildContentTypesXml(), "utf8"),
    },
    { name: "Version", data: encodeUtf16LeBom(PBIT_VERSION) },
    {
      name: "DataModelSchema",
      data: encodeUtf16LeBom(buildDataModelSchema(parsed, measures)),
    },
    {
      name: "DiagramLayout",
      data: encodeUtf16LeBom(JSON.stringify({ version: 4, diagrams: [] })),
    },
    {
      name: "Settings",
      data: encodeUtf16LeBom(JSON.stringify({ Version: 0 })),
    },
    {
      name: "Metadata",
      data: encodeUtf16LeBom(
        JSON.stringify({ Version: 0, AutoCreatedRelationships: [] }),
      ),
    },
    { name: "Report/Layout", data: encodeUtf16LeBom(buildReportLayout()) },
    { name: "DataMashup", data: buildDataMashup(sectionM) },
  ]);
}
