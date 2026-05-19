// Generator for the Power BI starter template `docs/powerbi/Collectables-Starter.pbit`
// (Analytics #15b). Pure module — no `react-native` / DOM imports — so it can
// be unit-tested from plain Node and run from the build script.
//
// A `.pbit` is an OPC (ZIP) package. Power BI Desktop opens it, shows the
// "Edit Parameters" dialog (driven by the model's `IsParameterQuery=true` M
// expressions), then loads `analytics_events` and the DAX measures. It cannot
// be validated in CI without Power BI Desktop, so the text assets in
// `docs/powerbi/{queries.m,measures.dax}` remain the verifiable source of
// truth — this generator derives the binary from exactly those files so they
// can never drift, and the tests crack the ZIP back open to assert structure.

import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const PBIT_RELATIVE_PATH = "docs/powerbi/Collectables-Starter.pbit";

export const PBIT_PARAMETERS = [
  "SupabaseHost",
  "SupabasePort",
  "SupabaseDb",
  "SupabaseSchema",
] as const;

export const EXPECTED_MEASURES = [
  "DAU",
  "ItemsAdded",
  "ListingsCreated",
  "ListingFunnelRate",
  "SignupsLast7d",
  "PremiumActivationsLast7d",
  "PremiumConversionRate7d",
] as const;

export interface DaxMeasure {
  name: string;
  lines: string[];
}

export interface PbitPart {
  /** ZIP entry path, no leading slash. */
  path: string;
  data: Buffer;
}

const COMMENT_LINE = /^\s*\/\//;
const MEASURE_HEADER = /^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*$/;
const PARAM_LITERAL = new RegExp(
  `^\\s*(${PBIT_PARAMETERS.join("|")})\\s*=\\s*"`,
);

/**
 * Parse `docs/powerbi/measures.dax` into `{ name, lines }` blocks. The file
 * uses `//` only for full-line comments and separates each measure with a
 * `Name :=` header line followed by its expression; blank lines between
 * measures are ignored.
 */
export function parseDaxMeasures(daxSource: string): DaxMeasure[] {
  const lines = daxSource.split(/\r?\n/);
  const measures: DaxMeasure[] = [];
  let current: DaxMeasure | null = null;
  for (const raw of lines) {
    if (COMMENT_LINE.test(raw)) continue;
    const header = raw.match(MEASURE_HEADER);
    if (header) {
      if (current) measures.push(trimMeasure(current));
      current = { name: header[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(raw);
  }
  if (current) measures.push(trimMeasure(current));
  return measures;
}

function trimMeasure(m: DaxMeasure): DaxMeasure {
  const lines = [...m.lines];
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return { name: m.name, lines };
}

/**
 * Derive the model partition's M from `docs/powerbi/queries.m` by dropping the
 * comment block and the four hard-coded parameter-literal bindings. The model
 * supplies `SupabaseHost`/`SupabasePort`/`SupabaseDb`/`SupabaseSchema` as
 * shared parameter expressions, so the remaining `let … in Parsed` body
 * references them by name with no string literals — keeping the .pbit query
 * byte-for-byte in step with the documented text asset.
 */
export function buildPartitionM(queriesM: string): string[] {
  const out: string[] = [];
  for (const raw of queriesM.split(/\r?\n/)) {
    if (COMMENT_LINE.test(raw)) continue;
    if (PARAM_LITERAL.test(raw)) continue;
    out.push(raw);
  }
  // collapse leading/trailing blank lines and any blank run left by the
  // removed parameter block so the M is tidy.
  const collapsed: string[] = [];
  for (const line of out) {
    const prev = collapsed.length
      ? collapsed[collapsed.length - 1].trim()
      : "";
    if (
      line.trim() === "" &&
      (collapsed.length === 0 || prev === "" || prev === "let")
    ) {
      continue;
    }
    collapsed.push(line);
  }
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === "") {
    collapsed.pop();
  }
  return collapsed;
}

function deterministicGuid(seed: string): string {
  const h = createHash("md5").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const COLUMN_TYPES: Record<string, string> = {
  occurred_at: "dateTime",
  name: "string",
  user_id: "string",
  properties: "string",
};

export function buildDataModelSchema(
  partitionM: string[],
  measures: DaxMeasure[],
): unknown {
  const columns = Object.keys(COLUMN_TYPES).map((col) => ({
    name: col,
    dataType: COLUMN_TYPES[col],
    sourceColumn: col,
    summarizeBy: "none",
    lineageTag: deterministicGuid(`column:${col}`),
    annotations: [{ name: "SummarizationSetBy", value: "Automatic" }],
  }));

  const parameterExpressions = PBIT_PARAMETERS.map((name) => ({
    name,
    kind: "m",
    expression: `${JSON.stringify(parameterDefault(name))} meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`,
    annotations: [{ name: "PBI_ResultType", value: "Text" }],
  }));

  const measureObjects = measures.map((m) => ({
    name: m.name,
    expression: m.lines.length === 1 ? m.lines[0] : m.lines,
    lineageTag: deterministicGuid(`measure:${m.name}`),
  }));

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
      expressions: parameterExpressions,
      tables: [
        {
          name: "analytics_events",
          lineageTag: deterministicGuid("table:analytics_events"),
          columns,
          partitions: [
            {
              name: "analytics_events",
              mode: "import",
              source: { type: "m", expression: partitionM },
            },
          ],
          measures: measureObjects,
        },
      ],
      annotations: [
        {
          name: "PBI_QueryOrder",
          value: JSON.stringify([...PBIT_PARAMETERS, "analytics_events"]),
        },
        { name: "__PBI_TimeIntelligenceEnabled", value: "0" },
      ],
    },
  };
}

function parameterDefault(name: string): string {
  switch (name) {
    case "SupabaseHost":
      return "aws-0-<region>.pooler.supabase.com";
    case "SupabasePort":
      return "5432";
    case "SupabaseDb":
      return "postgres";
    case "SupabaseSchema":
      return "public";
    default:
      return "";
  }
}

const REPORT_CARDS: { measure: string; title: string }[] = [
  { measure: "DAU", title: "Daily Active Users" },
  { measure: "ItemsAdded", title: "Users who added an item" },
  { measure: "ListingsCreated", title: "Users who created a listing" },
  { measure: "ListingFunnelRate", title: "Item → Listing funnel" },
  { measure: "PremiumConversionRate7d", title: "Premium conversion (7d)" },
];

function cardVisual(index: number, measure: string, title: string): unknown {
  const x = 24 + (index % 3) * 300;
  const y = 24 + Math.floor(index / 3) * 180;
  const config = {
    name: `vc_${measure}`,
    layouts: [
      {
        id: 0,
        position: { x, y, z: index, width: 280, height: 150, tabOrder: index },
      },
    ],
    singleVisual: {
      visualType: "card",
      projections: { Values: [{ queryRef: `analytics_events.${measure}` }] },
      prototypeQuery: {
        Version: 2,
        From: [{ Name: "a", Entity: "analytics_events", Type: 0 }],
        Select: [
          {
            Measure: {
              Expression: { SourceRef: { Source: "a" } },
              Property: measure,
            },
            Name: `analytics_events.${measure}`,
          },
        ],
      },
      drillFilterOtherVisuals: true,
      vcObjects: {
        title: [
          {
            properties: {
              text: { expr: { Literal: { Value: `'${title}'` } } },
              show: { expr: { Literal: { Value: "true" } } },
            },
          },
        ],
      },
    },
  };
  return {
    x,
    y,
    z: index,
    width: 280,
    height: 150,
    tabOrder: index,
    config: JSON.stringify(config),
    filters: "[]",
    query: "",
    dataTransforms: "",
  };
}

export function buildReportLayout(): unknown {
  return {
    id: 0,
    resourcePackages: [],
    config: JSON.stringify({
      version: "5.43",
      activeSectionIndex: 0,
      defaultDrillFilterOtherVisuals: true,
      objects: {},
      settings: {},
    }),
    layoutOptimization: 0,
    publicCustomVisuals: [],
    sections: [
      {
        id: 0,
        name: "ReportSection1",
        displayName: "Overview",
        filters: "[]",
        ordinal: 0,
        visualContainers: REPORT_CARDS.map((c, i) =>
          cardVisual(i, c.measure, c.title),
        ),
        config: "{}",
        displayOption: 1,
        width: 1280,
        height: 720,
      },
    ],
  };
}

export function buildContentTypesXml(): string {
  const overrides = [
    "/Version",
    "/DataModelSchema",
    "/DiagramLayout",
    "/Report/Layout",
    "/Settings",
    "/Metadata",
  ]
    .map((p) => `<Override PartName="${p}" ContentType="" />`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="json" ContentType="" />' +
    overrides +
    "</Types>"
  );
}

/** UTF-16 LE with BOM, no trailing newline — the encoding Power BI uses for
 * its JSON / text package parts. */
export function utf16leBom(text: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, "utf16le"),
  ]);
}

/**
 * Assemble every part of the `.pbit` package from the two text assets so the
 * binary can never drift from `queries.m` / `measures.dax`.
 */
export function buildPbitParts(
  queriesM: string,
  daxSource: string,
): PbitPart[] {
  const partitionM = buildPartitionM(queriesM);
  const measures = parseDaxMeasures(daxSource);
  const model = buildDataModelSchema(partitionM, measures);
  const report = buildReportLayout();
  const diagram = {
    version: "1.1.0",
    diagrams: [
      {
        ordinal: 0,
        scrollPosition: { x: 0, y: 0 },
        nodes: [
          {
            location: { x: 0, y: 0 },
            nodeIndex: "analytics_events",
            nodeLineageTag: null,
            size: { width: 220, height: 300 },
            zIndex: 0,
          },
        ],
        name: "All tables",
        zoomValue: 100,
        pinKeyFieldsToTop: false,
        showExtraHeaderInfo: false,
        hideKeyFieldsWhenCollapsed: false,
        tablesLocked: false,
      },
    ],
    selectedDiagram: "All tables",
    defaultDiagram: "All tables",
  };

  return [
    { path: "[Content_Types].xml", data: Buffer.from(buildContentTypesXml(), "utf8") },
    { path: "Version", data: utf16leBom("3.0") },
    { path: "DataModelSchema", data: utf16leBom(JSON.stringify(model)) },
    { path: "DiagramLayout", data: utf16leBom(JSON.stringify(diagram)) },
    { path: "Settings", data: utf16leBom(JSON.stringify({ version: "4.0" })) },
    { path: "Metadata", data: utf16leBom(JSON.stringify({ version: "1.0" })) },
    { path: "Report/Layout", data: utf16leBom(JSON.stringify(report)) },
  ];
}

// ---------------------------------------------------------------------------
// Minimal deterministic ZIP writer (deflate). No external dependency, fixed
// 1980-01-01 timestamps so the committed .pbit is byte-stable across runs.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function zipParts(parts: PbitPart[]): Buffer {
  const DOS_TIME = 0;
  const DOS_DATE = 0x21; // 1980-01-01
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const part of parts) {
    const name = Buffer.from(part.path, "utf8");
    const crc = crc32(part.data);
    const compressed = deflateRawSync(part.data, { level: 9 });

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(part.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // method
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(part.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const localBuf = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with cd
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

export function buildPbitBuffer(queriesM: string, daxSource: string): Buffer {
  return zipParts(buildPbitParts(queriesM, daxSource));
}

/** Read a ZIP produced by {@link zipParts} back into its parts. Used by the
 * tests to verify the committed .pbit is a valid package without Power BI. */
export function readZipParts(zip: Buffer): PbitPart[] {
  const parts: PbitPart[] = [];
  let pos = 0;
  while (pos + 4 <= zip.length && zip.readUInt32LE(pos) === 0x04034b50) {
    const method = zip.readUInt16LE(pos + 8);
    const compSize = zip.readUInt32LE(pos + 18);
    const nameLen = zip.readUInt16LE(pos + 26);
    const extraLen = zip.readUInt16LE(pos + 28);
    const nameStart = pos + 30;
    const name = zip.toString("utf8", nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const raw = zip.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    parts.push({ path: name, data });
    pos = dataStart + compSize;
  }
  return parts;
}

/** Decode a UTF-16 LE (BOM) package part back to a string. */
export function decodeUtf16lePart(data: Buffer): string {
  const body =
    data.length >= 2 && data[0] === 0xff && data[1] === 0xfe
      ? data.subarray(2)
      : data;
  return body.toString("utf16le");
}
