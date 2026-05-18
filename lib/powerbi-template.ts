// Power BI starter template (.pbit) generator — Analytics #15b.
//
// A .pbit is an OPC ZIP package. This module is pure (only node:zlib +
// node:buffer, no react-native, no third-party deps) so the assembly is
// unit-testable in CI even though Power BI Desktop itself is Windows-only and
// cannot validate the artifact here. The DAX measures and the parameterised M
// query live in docs/powerbi/{measures.dax,queries.m} — the human-verifiable
// source of truth; this module only re-packages them into the binary template
// so the two can never silently diverge.
//
// The template uses the "enhanced metadata" layout: the model + parameters +
// measures live in DataModelSchema, so Power BI rehydrates the Power Query
// mashup from the model on open (a missing DataMashup degrades to
// regeneration; a hand-mangled one would be a hard parse failure — so we omit
// it deliberately). The four Supabase connection literals are surfaced as
// Power Query parameters so opening the template prompts for them.

import { deflateRawSync, inflateRawSync } from "node:zlib";

export const PBIT_PARAMETER_NAMES = [
  "SupabaseHost",
  "SupabasePort",
  "SupabaseDb",
  "SupabaseSchema",
] as const;

export type PbitParameterName = (typeof PBIT_PARAMETER_NAMES)[number];

export interface PbitParameter {
  name: string;
  defaultValue: string;
}

export interface PbitMeasure {
  name: string;
  expression: string;
}

export interface PbitPart {
  /** OPC part name without a leading slash, e.g. "Report/Layout". */
  name: string;
  data: Buffer;
}

const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);

/** Power BI stores the JSON metadata parts as UTF-16 LE with a BOM. */
export function encodeUtf16leWithBom(text: string): Buffer {
  return Buffer.concat([UTF16LE_BOM, Buffer.from(text, "utf16le")]);
}

// --- queries.m parsing -----------------------------------------------------

/**
 * Pulls the four `Name = "literal",` parameter assignments out of the leading
 * `let` block of queries.m and returns them plus the M body with those lines
 * removed. In the .pbit those names resolve to shared Power Query parameters
 * instead, which is what makes Power BI prompt for them on template open.
 */
export function parseQueryParameters(queryM: string): {
  parameters: PbitParameter[];
  body: string;
} {
  const lines = queryM.split(/\r?\n/);
  const parameters: PbitParameter[] = [];
  const kept: string[] = [];
  const wanted = new Set<string>(PBIT_PARAMETER_NAMES);

  for (const line of lines) {
    const match = line.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*,\s*$/,
    );
    if (match && wanted.has(match[1])) {
      parameters.push({ name: match[1], defaultValue: match[2] });
      continue;
    }
    kept.push(line);
  }

  if (parameters.length !== PBIT_PARAMETER_NAMES.length) {
    throw new Error(
      `[powerbi-template] expected ${PBIT_PARAMETER_NAMES.length} parameter literals in queries.m, found ${parameters.length}`,
    );
  }
  // Preserve the canonical declaration order regardless of file order.
  parameters.sort(
    (a, b) =>
      PBIT_PARAMETER_NAMES.indexOf(a.name as PbitParameterName) -
      PBIT_PARAMETER_NAMES.indexOf(b.name as PbitParameterName),
  );

  // Collapse the blank line the removed assignments used to be followed by so
  // the embedded M stays tidy.
  const body = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { parameters, body };
}

// --- measures.dax parsing --------------------------------------------------

/**
 * Splits measures.dax into `{ name, expression }` pairs. `//` lines are
 * section separators; a measure starts at `Name :=` (expression may be on the
 * same line or the lines that follow) and ends at the next measure / comment /
 * end of file.
 */
export function parseMeasures(dax: string): PbitMeasure[] {
  const measures: PbitMeasure[] = [];
  let current: { name: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const expression = current.lines.join("\n").trim();
    if (expression.length > 0) {
      measures.push({ name: current.name, expression });
    }
    current = null;
  };

  for (const raw of dax.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*\/\//.test(line)) {
      flush();
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const start = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.*)$/);
    if (start) {
      flush();
      current = { name: start[1], lines: [] };
      if (start[2].trim() !== "") current.lines.push(start[2]);
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();

  if (measures.length === 0) {
    throw new Error("[powerbi-template] no measures parsed from measures.dax");
  }
  return measures;
}

// --- OPC parts -------------------------------------------------------------

function mEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildDataModelSchema(
  parameters: PbitParameter[],
  partitionM: string,
  measures: PbitMeasure[],
): string {
  const expressions = parameters.map((p) => ({
    name: p.name,
    kind: "m",
    expression:
      `"${mEscape(p.defaultValue)}" ` +
      `meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`,
    annotations: [{ name: "PBI_ResultType", value: "Text" }],
  }));

  const queryOrder = [
    ...parameters.map((p) => p.name),
    "analytics_events",
  ];

  const model = {
    name: "Collectables-Starter",
    compatibilityLevel: 1567,
    model: {
      culture: "en-US",
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      tables: [
        {
          name: "analytics_events",
          columns: [
            { name: "id", dataType: "string", sourceColumn: "id" },
            {
              name: "occurred_at",
              dataType: "dateTime",
              sourceColumn: "occurred_at",
            },
            { name: "user_id", dataType: "string", sourceColumn: "user_id" },
            { name: "name", dataType: "string", sourceColumn: "name" },
            {
              name: "properties",
              dataType: "string",
              sourceColumn: "properties",
            },
          ],
          partitions: [
            {
              name: "analytics_events",
              mode: "import",
              source: { type: "m", expression: partitionM.split("\n") },
            },
          ],
          measures: measures.map((m) => ({
            name: m.name,
            expression: m.expression.split("\n"),
          })),
        },
      ],
      expressions,
      annotations: [
        { name: "PBI_QueryOrder", value: JSON.stringify(queryOrder) },
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
    sections: [
      {
        id: 0,
        name: "ReportSection",
        displayName: "DAU & funnel — add visuals using the embedded measures",
        filters: "[]",
        ordinal: 0,
        visualContainers: [],
        config: "{}",
        displayOption: 1,
        width: 1280,
        height: 720,
      },
    ],
    config: JSON.stringify({ version: "5.43", activeSectionIndex: 0 }),
    layoutOptimization: 0,
  };
  return JSON.stringify(layout);
}

export function buildContentTypes(partNames: string[]): string {
  const overrides = partNames
    .filter((n) => n !== "[Content_Types].xml")
    .map((n) => `<Override PartName="/${n}" ContentType="" />`)
    .join("");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    overrides +
    `</Types>`
  );
}

export function buildParts(queryM: string, measuresDax: string): PbitPart[] {
  const { parameters, body } = parseQueryParameters(queryM);
  const measures = parseMeasures(measuresDax);

  const ordered: { name: string; data: Buffer }[] = [
    { name: "Version", data: Buffer.from("3.0", "utf8") },
    {
      name: "DataModelSchema",
      data: encodeUtf16leWithBom(
        buildDataModelSchema(parameters, body, measures),
      ),
    },
    {
      name: "DiagramLayout",
      data: encodeUtf16leWithBom(
        JSON.stringify({ version: 4, diagrams: [] }),
      ),
    },
    {
      name: "Report/Layout",
      data: encodeUtf16leWithBom(buildReportLayout()),
    },
    {
      name: "Settings",
      data: encodeUtf16leWithBom(JSON.stringify({ version: "5.43" })),
    },
    {
      name: "Metadata",
      data: encodeUtf16leWithBom(JSON.stringify({ version: "5.43" })),
    },
  ];

  const allNames = [
    "[Content_Types].xml",
    ...ordered.map((p) => p.name),
  ];
  return [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(buildContentTypes(allNames), "utf8"),
    },
    ...ordered,
  ];
}

// --- minimal ZIP writer/reader (STORED + DEFLATE, no deps) -----------------

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

// Fixed DOS timestamp (1980-01-01 00:00:00) keeps the artifact byte-for-byte
// deterministic so re-running the build never churns git.
const DOS_TIME = 0;
const DOS_DATE = 0b0000000_0001_00001; // year 1980, month 1, day 1

export function createZip(parts: PbitPart[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const part of parts) {
    const nameBuf = Buffer.from(part.name, "utf8");
    const crc = crc32(part.data);
    const deflated = deflateRawSync(part.data, { level: 9 });
    const useDeflate = deflated.length < part.data.length;
    const method = useDeflate ? 8 : 0;
    const stored = useDeflate ? deflated : part.data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(part.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBuf, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(part.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  const centralDir = Buffer.concat(centrals);
  const localDir = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localDir.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localDir, centralDir, eocd]);
}

/** Parses a ZIP produced by {@link createZip} (STORED or DEFLATE entries). */
export function readZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let p = 0;
  while (p + 4 <= zip.length && zip.readUInt32LE(p) === 0x04034b50) {
    const method = zip.readUInt16LE(p + 8);
    const compSize = zip.readUInt32LE(p + 18);
    const nameLen = zip.readUInt16LE(p + 26);
    const extraLen = zip.readUInt16LE(p + 28);
    const name = zip
      .subarray(p + 30, p + 30 + nameLen)
      .toString("utf8");
    const dataStart = p + 30 + nameLen + extraLen;
    const raw = zip.subarray(dataStart, dataStart + compSize);
    entries.set(
      name,
      method === 8 ? inflateRawSync(raw) : Buffer.from(raw),
    );
    p = dataStart + compSize;
  }
  return entries;
}

export function buildPbit(queryM: string, measuresDax: string): Buffer {
  return createZip(buildParts(queryM, measuresDax));
}
