/**
 * Build-time only helper (Analytics #15b). Never imported by app/RN code —
 * mirrors the lib/spa-fallback.ts + scripts/build-spa-fallback.ts split so the
 * .pbit assembly is unit-testable in CI. All filesystem IO lives in
 * scripts/build-powerbi-template.ts; this module is pure (string/Buffer in,
 * Buffer out) so __tests__ can re-derive and assert the artifact's internals.
 *
 * A hand-authored .pbit cannot be opened-tested without Power BI Desktop, so
 * the .pbit is *derived from* the CI-verifiable text assets
 * (docs/powerbi/measures.dax + queries.m) — parity by construction. Those text
 * files remain the documented copy-paste fallback (docs/powerbi/README.md).
 */

export const POWERBI_TABLE_NAME = "analytics_events";

export const POWERBI_PARAMETER_NAMES = [
  "SupabaseHost",
  "SupabasePort",
  "SupabaseDb",
  "SupabaseSchema",
] as const;

export const POWERBI_MEASURE_NAMES = [
  "DAU",
  "ItemsAdded",
  "ListingsCreated",
  "ListingFunnelRate",
  "SignupsLast7d",
  "PremiumActivationsLast7d",
  "PremiumConversionRate7d",
] as const;

export const PBIT_PART_NAMES = [
  "[Content_Types].xml",
  "Version",
  "Settings",
  "Metadata",
  "DataModelSchema",
  "DiagramLayout",
  "Report/Layout",
] as const;

export interface PowerBiMeasure {
  name: string;
  expression: string[];
}

export interface PowerBiParameter {
  name: string;
  defaultValue: string;
}

export interface PowerBiTemplateAssets {
  measuresDax: string;
  queriesM: string;
}

export interface BuiltPbit {
  buffer: Buffer;
  parts: Record<string, Buffer>;
  dataModelSchema: unknown;
  reportLayout: unknown;
}

/**
 * Parse the `Name :=` blocks out of docs/powerbi/measures.dax. Comment (`//`)
 * and blank lines delimit blocks; the expression keeps its original
 * indentation so the .pbit renders identically to the copy-paste fallback.
 */
export function parseDaxMeasures(dax: string): PowerBiMeasure[] {
  const lines = dax.split(/\r?\n/);
  const measures: PowerBiMeasure[] = [];
  let current: PowerBiMeasure | null = null;
  const startRe = /^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*$/;

  for (const line of lines) {
    if (line.trim().startsWith("//")) continue;
    const start = startRe.exec(line.trim());
    if (start) {
      if (current) measures.push(finalizeMeasure(current));
      current = { name: start[1], expression: [] };
      continue;
    }
    if (current) current.expression.push(line);
  }
  if (current) measures.push(finalizeMeasure(current));
  return measures;
}

function finalizeMeasure(m: PowerBiMeasure): PowerBiMeasure {
  // Trim leading/trailing blank lines while preserving internal indentation.
  const expr = [...m.expression];
  while (expr.length && expr[0].trim() === "") expr.shift();
  while (expr.length && expr[expr.length - 1].trim() === "") expr.pop();
  return { name: m.name, expression: expr };
}

/**
 * Pull the four `Name = "literal"` defaults out of the `let` head of
 * docs/powerbi/queries.m so the .pbit's prompt-on-open parameters keep the
 * exact defaults documented in the text fallback.
 */
export function parseQueryParameters(queriesM: string): PowerBiParameter[] {
  const literal = (name: string): string => {
    const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
    const match = re.exec(queriesM);
    if (!match) {
      throw new Error(`queries.m is missing the ${name} parameter literal`);
    }
    return match[1];
  };
  return POWERBI_PARAMETER_NAMES.map((name) => ({
    name,
    defaultValue: literal(name),
  }));
}

function parameterExpression(p: PowerBiParameter): string {
  const v = JSON.stringify(p.defaultValue);
  return `${v} meta [IsParameterQuery=true, IsParameterQueryRequired=true, List={}, DefaultValue=${v}, Type="Text"]`;
}

const PARTITION_M: string[] = [
  "let",
  "    Server = SupabaseHost & \":\" & SupabasePort,",
  "    Source = PostgreSQL.Database(Server, SupabaseDb),",
  "    Events = Source{[Schema = SupabaseSchema, Item = \"analytics_events\"]}[Data],",
  "    Typed = Table.TransformColumnTypes(Events, {{\"occurred_at\", type datetimezone}, {\"name\", type text}}),",
  "    Parsed = Table.TransformColumns(Typed, {{\"properties\", each try Json.Document(_) otherwise null}})",
  "in",
  "    Parsed",
];

export function buildDataModelSchema(
  measures: PowerBiMeasure[],
  parameters: PowerBiParameter[],
): unknown {
  return {
    name: "Collectables-Starter",
    compatibilityLevel: 1550,
    model: {
      culture: "en-US",
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      dataAccessOptions: {
        legacyRedirects: true,
        returnErrorValuesAsNull: true,
      },
      tables: [
        {
          name: POWERBI_TABLE_NAME,
          columns: [
            {
              name: "occurred_at",
              dataType: "dateTime",
              sourceColumn: "occurred_at",
              summarizeBy: "none",
            },
            {
              name: "user_id",
              dataType: "string",
              sourceColumn: "user_id",
              summarizeBy: "none",
            },
            {
              name: "name",
              dataType: "string",
              sourceColumn: "name",
              summarizeBy: "none",
            },
            {
              name: "properties",
              dataType: "string",
              sourceColumn: "properties",
              summarizeBy: "none",
            },
          ],
          partitions: [
            {
              name: POWERBI_TABLE_NAME,
              mode: "import",
              source: { type: "m", expression: PARTITION_M },
            },
          ],
          measures: measures.map((m) => ({
            name: m.name,
            expression: m.expression,
          })),
        },
      ],
      expressions: parameters.map((p) => ({
        name: p.name,
        kind: "m",
        expression: parameterExpression(p),
        annotations: [
          { name: "PBI_NavigationStepName", value: "Navigation" },
          { name: "PBI_ResultType", value: "Text" },
        ],
      })),
      annotations: [
        {
          name: "PBI_QueryOrder",
          value: JSON.stringify([
            ...parameters.map((p) => p.name),
            POWERBI_TABLE_NAME,
          ]),
        },
      ],
    },
  };
}

export function buildReportLayout(): unknown {
  return {
    id: 0,
    resourcePackages: [],
    config: JSON.stringify({
      version: "5.43",
      themeCollection: { baseTheme: { name: "CY24SU10" } },
      activeSectionIndex: 0,
      defaultDrillFilterOtherVisuals: true,
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
        config: "{}",
        displayOption: 1,
        width: 1280,
        height: 720,
      },
    ],
  };
}

export function buildContentTypesXml(): string {
  const overrides = PBIT_PART_NAMES.filter((p) => p !== "[Content_Types].xml")
    .map((p) => `  <Override PartName="/${p}" ContentType="" />`)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="json" ContentType="" />',
    overrides,
    "</Types>",
  ].join("\n");
}

// --- minimal deterministic ZIP (STORE only) so the committed binary is stable

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

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

export function zipStore(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  // 1980-01-01 00:00 — fixed so the artifact is byte-stable across rebuilds.
  const DOS_DATE = 0x0021;
  const DOS_TIME = 0x0000;

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

    offset += local.length + nameBuf.length + entry.data.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const localData = Buffer.concat(localChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDir, eocd]);
}

/** STORE-only reader — enough to validate our own deterministic output. */
export function readZipEntries(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let pos = 0;
  while (pos + 4 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const method = buf.readUInt16LE(pos + 8);
    const size = buf.readUInt32LE(pos + 22);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.toString("utf8", pos + 30, pos + 30 + nameLen);
    const dataStart = pos + 30 + nameLen + extraLen;
    if (method !== 0) {
      throw new Error(`unexpected compression method ${method} for ${name}`);
    }
    out[name] = buf.subarray(dataStart, dataStart + size);
    pos = dataStart + size;
  }
  return out;
}

function utf16le(text: string): Buffer {
  // UTF-16 LE with BOM — the encoding Power BI writes for its JSON/text parts.
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, "utf16le"),
  ]);
}

export function buildPbit(assets: PowerBiTemplateAssets): BuiltPbit {
  const measures = parseDaxMeasures(assets.measuresDax);
  const parameters = parseQueryParameters(assets.queriesM);
  const dataModelSchema = buildDataModelSchema(measures, parameters);
  const reportLayout = buildReportLayout();

  const partsText: Record<string, Buffer> = {
    "[Content_Types].xml": Buffer.from(buildContentTypesXml(), "utf8"),
    Version: utf16le("3.0"),
    Settings: utf16le(JSON.stringify({ Version: 4 })),
    Metadata: utf16le(
      JSON.stringify({ Version: 4, AutoCreatedRelationships: [] }),
    ),
    DataModelSchema: utf16le(JSON.stringify(dataModelSchema, null, 2)),
    DiagramLayout: utf16le(JSON.stringify({ version: "1.1.0", diagrams: [] })),
    "Report/Layout": utf16le(JSON.stringify(reportLayout)),
  };

  const entries = PBIT_PART_NAMES.map((name) => ({
    name,
    data: partsText[name],
  }));
  const buffer = zipStore(entries);

  return { buffer, parts: partsText, dataModelSchema, reportLayout };
}
