// Power BI `.pbit` template builder (Analytics #15b).
//
// Pure, build-only module — never imported by `app/`, so the Node `Buffer`
// usage here never reaches the React Native bundle (mirrors the
// `lib/spa-fallback.ts` + `scripts/build-spa-fallback.ts` split).
//
// A `.pbit` is an OPC (ZIP) package. We assemble it deterministically from the
// verifiable text source assets shipped in Analytics #15a
// (`docs/powerbi/queries.m` + `docs/powerbi/measures.dax`) so the binary
// artifact can never silently drift from the copy-paste fallback. Power BI
// Desktop cannot run in CI, so the tests lock everything that *is* verifiable:
// the ZIP/OPC framing, UTF-16LE JSON parts, the MS-QDEFF DataMashup framing,
// and source-parity with the #15a assets.

export interface QueryParameter {
  name: string;
  defaultValue: string;
}

export interface DaxMeasure {
  name: string;
  expression: string;
}

export interface PbitSource {
  queriesM: string;
  measuresDax: string;
}

export const PBIT_PART_NAMES = [
  "[Content_Types].xml",
  "Version",
  "DataModelSchema",
  "DataMashup",
  "Report/Layout",
  "Settings",
  "Metadata",
] as const;

// --- source parsing -------------------------------------------------------

function stripMComments(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/**
 * Extracts the `Name = "literal"` parameter assignments from the `let` header
 * of `queries.m`. Only string-literal assignments qualify, so the downstream
 * `Server = SupabaseHost & ...` steps are never mistaken for parameters.
 */
export function parseQueryParameters(queriesM: string): QueryParameter[] {
  const body = stripMComments(queriesM);
  const re = /^\s*([A-Za-z_]\w*)\s*=\s*"([^"]*)"\s*,?\s*$/gm;
  const params: QueryParameter[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    params.push({ name: m[1], defaultValue: m[2] });
  }
  if (params.length === 0) {
    throw new Error("powerbi-template: no parameters found in queries.m");
  }
  return params;
}

/**
 * Parses `measures.dax` into `{ name, expression }` blocks. A measure header is
 * an identifier followed by `:=` at the start of a line; everything up to the
 * next header (or EOF) is the expression. `//` comment lines are stripped.
 */
export function parseMeasures(measuresDax: string): DaxMeasure[] {
  const src = measuresDax
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const headerRe = /(^|\n)[ \t]*([A-Za-z_]\w*)[ \t]*:=[ \t]*\r?\n/g;
  const headers: { name: string; headerStart: number; exprStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(src)) !== null) {
    headers.push({
      name: m[2],
      headerStart: m.index + m[1].length,
      exprStart: headerRe.lastIndex,
    });
  }
  return headers.map((h, i) => {
    const end = i + 1 < headers.length ? headers[i + 1].headerStart : src.length;
    return { name: h.name, expression: src.slice(h.exprStart, end).trim() };
  });
}

function mString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function parameterMExpression(param: QueryParameter): string {
  return `${mString(param.defaultValue)} meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`;
}

/**
 * Re-derives the `analytics_events` query body from `queries.m`: the same
 * `let … in Parsed` block, minus the four inline parameter literal lines
 * (those become top-level `shared` parameter queries that this body
 * references by name).
 */
export function buildAnalyticsQueryExpression(
  queriesM: string,
  params: QueryParameter[],
): string {
  const paramNames = new Set(params.map((p) => p.name));
  const body = stripMComments(queriesM).trim();
  const letIdx = body.indexOf("let");
  if (letIdx === -1) {
    throw new Error("powerbi-template: queries.m has no `let` block");
  }
  const kept = body
    .slice(letIdx)
    .split("\n")
    .filter((line) => {
      const am = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*"/);
      return !(am && paramNames.has(am[1]));
    });
  return kept.join("\n").trim();
}

export function buildSection1M(source: PbitSource): string {
  const params = parseQueryParameters(source.queriesM);
  const query = buildAnalyticsQueryExpression(source.queriesM, params);
  const decls = params
    .map((p) => `shared ${p.name} = ${parameterMExpression(p)};`)
    .join("\n\n");
  return `section Section1;\n\n${decls}\n\nshared analytics_events = ${query};\n`;
}

// --- OPC parts ------------------------------------------------------------

const UTF16LE_BOM = "﻿";

function utf16le(text: string): Buffer {
  return Buffer.from(UTF16LE_BOM + text, "utf16le");
}

function buildContentTypesXml(): string {
  const overrides = PBIT_PART_NAMES.filter((n) => n !== "[Content_Types].xml")
    .map((n) => `<Override PartName="/${n}" ContentType="" />`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="json" ContentType="" />' +
    overrides +
    "</Types>"
  );
}

function buildDataModelSchema(source: PbitSource): string {
  const params = parseQueryParameters(source.queriesM);
  const query = buildAnalyticsQueryExpression(source.queriesM, params);
  const measures = parseMeasures(source.measuresDax);
  const columns = [
    { name: "id", dataType: "string", sourceColumn: "id" },
    { name: "occurred_at", dataType: "dateTime", sourceColumn: "occurred_at" },
    { name: "user_id", dataType: "string", sourceColumn: "user_id" },
    { name: "name", dataType: "string", sourceColumn: "name" },
    { name: "properties", dataType: "string", sourceColumn: "properties" },
  ];
  const model = {
    name: "Collectables-Starter",
    compatibilityLevel: 1567,
    model: {
      culture: "en-US",
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      dataAccessOptions: {
        legacyRedirects: true,
        returnErrorValuesAsNull: true,
      },
      expressions: params.map((p) => ({
        name: p.name,
        kind: "m",
        expression: parameterMExpression(p),
        queryGroup: "Parameters",
        annotations: [
          { name: "PBI_NavigationStepName", value: "Navigation" },
          { name: "PBI_ResultType", value: "Text" },
        ],
      })),
      tables: [
        {
          name: "analytics_events",
          columns,
          partitions: [
            {
              name: "analytics_events",
              mode: "import",
              source: { type: "m", expression: query },
            },
          ],
          measures: measures.map((mm) => ({
            name: mm.name,
            expression: mm.expression,
          })),
        },
      ],
      annotations: [
        { name: "PBI_QueryOrder", value: '["analytics_events"]' },
        { name: "__PBI_TimeIntelligenceEnabled", value: "0" },
      ],
    },
  };
  return JSON.stringify(model, null, 2);
}

function buildReportLayout(): string {
  const layout = {
    id: 0,
    resourcePackages: [],
    sections: [
      {
        id: 0,
        name: "ReportSection",
        displayName: "DAU & Funnel",
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
      settings: {},
    }),
    layoutOptimization: 0,
  };
  return JSON.stringify(layout);
}

function buildSettings(): string {
  return JSON.stringify({});
}

function buildMetadata(): string {
  return JSON.stringify({
    version: "3.0",
    autoCreatedRelationships: [],
    fileDescription:
      "Collectables analytics starter — DAU + listing funnel + premium conversion over Supabase analytics_events.",
    createdFromTemplate: true,
  });
}

function buildVersion(): Buffer {
  return Buffer.from("3.0", "ascii");
}

// --- MS-QDEFF DataMashup --------------------------------------------------

function int32le(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value, 0);
  return b;
}

function lengthPrefixed(payload: Buffer): Buffer {
  return Buffer.concat([int32le(payload.length), payload]);
}

/**
 * MS-QDEFF DataMashup stream:
 *   int32 version(=0)
 *   int32 packagePartsLen + packageParts (an OPC zip: Section1.m + config)
 *   int32 permissionsLen  + permissions  (XML)
 *   int32 metadataLen     + metadata     (versioned XML block)
 *   int32 permissionBindingsLen + permissionBindings
 *
 * Power BI regenerates permissions/metadata on first save; we ship a
 * well-formed minimal form. The README documents the copy-paste fallback for
 * Power BI versions that reject a hand-authored mashup.
 */
export function buildDataMashup(section1M: string): Buffer {
  const packageContentTypes =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="m" ContentType="" />' +
    '<Override PartName="/Config/Package.xml" ContentType="" />' +
    "</Types>";
  const packageXml =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Package xmlns="http://schemas.microsoft.com/DataMashup">' +
    "<Version>2.126.453.0</Version>" +
    "<MinVersion>2.21.0.0</MinVersion>" +
    "<Culture>en-US</Culture>" +
    "<SafeCombine>true</SafeCombine>" +
    "</Package>";
  const packageParts = zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(packageContentTypes, "utf8") },
    { name: "Config/Package.xml", data: Buffer.from(packageXml, "utf8") },
    { name: "Formulas/Section1.m", data: Buffer.from(section1M, "utf8") },
  ]);

  const permissions = Buffer.from(
    '<?xml version="1.0" encoding="utf-8"?>' +
      '<PermissionList xmlns="http://schemas.microsoft.com/DataMashup">' +
      "<CanEvaluateFuturePackages>false</CanEvaluateFuturePackages>" +
      "<FirewallEnabled>true</FirewallEnabled>" +
      "</PermissionList>",
    "utf8",
  );

  const metadataXml = Buffer.from(
    '<?xml version="1.0" encoding="utf-8"?>' +
      '<LocalPackageMetadataFile xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<Items><Item><ItemLocation><ItemType>AllFormulas</ItemType>" +
      "<ItemPath /></ItemLocation><StableEntries /></Item></Items>" +
      "</LocalPackageMetadataFile>",
    "utf8",
  );
  // metadata block = int32 version(0) + length-prefixed xml + int32 content(0)
  const metadata = Buffer.concat([
    int32le(0),
    lengthPrefixed(metadataXml),
    int32le(0),
  ]);

  return Buffer.concat([
    int32le(0),
    lengthPrefixed(packageParts),
    lengthPrefixed(permissions),
    lengthPrefixed(metadata),
    lengthPrefixed(Buffer.alloc(0)),
  ]);
}

// --- minimal STORE-method ZIP (deterministic) -----------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

// Fixed DOS timestamp (1980-01-01 00:00:00) keeps the artifact byte-stable so
// re-running the build produces an identical, churn-free `.pbit`.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

export function zipStore(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

// --- top-level assembly ---------------------------------------------------

export function buildPbit(source: PbitSource): Buffer {
  const section1M = buildSection1M(source);
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(buildContentTypesXml(), "utf8") },
    { name: "Version", data: buildVersion() },
    { name: "DataModelSchema", data: utf16le(buildDataModelSchema(source)) },
    { name: "DataMashup", data: buildDataMashup(section1M) },
    { name: "Report/Layout", data: utf16le(buildReportLayout()) },
    { name: "Settings", data: utf16le(buildSettings()) },
    { name: "Metadata", data: utf16le(buildMetadata()) },
  ];
  return zipStore(entries);
}
