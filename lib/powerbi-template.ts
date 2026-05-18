// Builds the `docs/powerbi/Collectables-Starter.pbit` Power BI Template
// (Analytics #15b). Pure module — no `react-native` / DOM imports — so the
// assembly is unit-testable from plain Node and produces a byte-deterministic
// artefact (fixed ZIP timestamps) so re-running the build never churns git.
//
// A `.pbit` is an OPC (Open Packaging Conventions) ZIP. We generate it from
// the verifiable text source — `docs/powerbi/queries.m` (the M query) and
// `docs/powerbi/measures.dax` (the six starter measures) — so the template
// can never drift away from the copy-paste fallback documented in
// docs/powerbi-connection.md. The four `Supabase*` literals in queries.m are
// promoted to real M parameters so Power BI prompts for them on open.

export const PBIT_PARAMETER_NAMES = [
  "SupabaseHost",
  "SupabasePort",
  "SupabaseDb",
  "SupabaseSchema",
] as const;

export type PbitParameterName = (typeof PBIT_PARAMETER_NAMES)[number];

export interface PbitParameter {
  name: PbitParameterName;
  defaultValue: string;
}

export interface DaxMeasure {
  name: string;
  expression: string;
}

// --- CRC32 (IEEE 802.3) --------------------------------------------------

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(buf: Buffer): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- Encoding ------------------------------------------------------------

// Power BI requires the JSON parts (DataModelSchema, Report/Layout, Settings,
// Metadata, Version, DiagramLayout) to be UTF-16 LE with a BOM. The XML
// package plumbing ([Content_Types].xml, _rels/.rels) is plain UTF-8.
export function encodeUtf16LeWithBom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

// --- Source parsing (single source of truth = the .m / .dax files) -------

export function parseQueryParameters(mSource: string): PbitParameter[] {
  return PBIT_PARAMETER_NAMES.map((name) => {
    const match = mSource.match(
      new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`),
    );
    if (!match) {
      throw new Error(
        `[powerbi-template] parameter "${name}" not found in queries.m`,
      );
    }
    return { name, defaultValue: match[1] };
  });
}

// Strip the leading `//` comment banner and the four inline parameter
// bindings from queries.m so the remaining `let … in` body references the
// promoted top-level M parameters instead of re-declaring them.
export function buildMainQueryExpression(mSource: string): string[] {
  const lines = mSource.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*\/\//.test(line)) continue;
    if (
      /^\s*(SupabaseHost|SupabasePort|SupabaseDb|SupabaseSchema)\s*=\s*"[^"]*"\s*,?\s*$/.test(
        line,
      )
    ) {
      continue;
    }
    out.push(line);
  }
  // Collapse the leading blank lines left by the stripped banner/bindings.
  while (out.length && out[0].trim() === "") out.shift();
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out;
}

export function parseDaxMeasures(daxSource: string): DaxMeasure[] {
  const lines = daxSource
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l));
  const measures: DaxMeasure[] = [];
  let current: { name: string; lines: string[] } | null = null;
  const header = /^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.*)$/;
  for (const line of lines) {
    const m = line.match(header);
    if (m) {
      if (current) {
        measures.push({
          name: current.name,
          expression: current.lines.join("\n").trim(),
        });
      }
      current = { name: m[1], lines: m[2] ? [m[2]] : [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    measures.push({
      name: current.name,
      expression: current.lines.join("\n").trim(),
    });
  }
  return measures.filter((mm) => mm.expression.length > 0);
}

// --- TMSL data model -----------------------------------------------------

function parameterExpressionLines(p: PbitParameter): string[] {
  // Canonical Power BI parameter shape: a literal followed by a `meta`
  // record flagged IsParameterQuery so Power BI prompts on .pbit open.
  return [
    `${JSON.stringify(p.defaultValue)} meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`,
  ];
}

const ANALYTICS_COLUMNS: { name: string; dataType: string }[] = [
  { name: "id", dataType: "string" },
  { name: "occurred_at", dataType: "dateTime" },
  { name: "user_id", dataType: "string" },
  { name: "name", dataType: "string" },
  { name: "properties", dataType: "string" },
];

export function buildDataModelSchema(args: {
  mainQuery: string[];
  parameters: PbitParameter[];
  measures: DaxMeasure[];
}): unknown {
  const { mainQuery, parameters, measures } = args;
  return {
    name: "Collectables-Starter",
    compatibilityLevel: 1567,
    model: {
      culture: "en-US",
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
          measures: measures.map((mm) => ({
            name: mm.name,
            expression: mm.expression.split("\n"),
          })),
          partitions: [
            {
              name: "analytics_events",
              mode: "import",
              source: {
                type: "m",
                expression: mainQuery,
              },
            },
          ],
        },
      ],
      expressions: parameters.map((p) => ({
        name: p.name,
        kind: "m",
        expression: parameterExpressionLines(p),
        annotations: [{ name: "PBI_ResultType", value: "Text" }],
      })),
      annotations: [
        { name: "PBI_QueryOrder", value: JSON.stringify(["analytics_events"]) },
        { name: "__PBI_TimeIntelligenceEnabled", value: "0" },
      ],
    },
  };
}

// --- Report layout (one empty page; visuals authored by the user) --------

export function buildReportLayout(): unknown {
  return {
    id: 0,
    resourcePackages: [],
    config: JSON.stringify({
      version: "5.43",
      themeCollection: { baseTheme: { name: "CY24SU10" } },
    }),
    layoutOptimization: 0,
    sections: [
      {
        id: 0,
        name: "ReportSection",
        displayName: "DAU & Funnels",
        filters: "[]",
        ordinal: 0,
        visualContainers: [],
        config: JSON.stringify({}),
        displayOption: 1,
        width: 1280,
        height: 720,
      },
    ],
  };
}

// --- OPC package plumbing ------------------------------------------------

const PBI_REL_BASE = "http://schemas.microsoft.com/powerbi/2013/01";

interface PackagePart {
  name: string; // zip entry path, no leading slash
  data: Buffer;
}

interface PartSpec {
  name: string;
  relType: string | null; // null = not a package-level relationship target
  json: unknown | null; // null = raw text/xml provided via `text`
  text?: string;
  xml?: boolean; // UTF-8 instead of UTF-16LE
}

export function buildPbitParts(args: {
  queriesM: string;
  measuresDax: string;
}): PackagePart[] {
  const parameters = parseQueryParameters(args.queriesM);
  const mainQuery = buildMainQueryExpression(args.queriesM);
  const measures = parseDaxMeasures(args.measuresDax);
  if (measures.length === 0) {
    throw new Error("[powerbi-template] no DAX measures parsed from measures.dax");
  }

  const dataModel = buildDataModelSchema({ mainQuery, parameters, measures });
  const reportLayout = buildReportLayout();

  const specs: PartSpec[] = [
    {
      name: "Version",
      relType: `${PBI_REL_BASE}/PowerBIPackageVersion`,
      json: null,
      text: "3.0",
    },
    {
      name: "DataModelSchema",
      relType: `${PBI_REL_BASE}/PowerBIPackageDataModelSchema`,
      json: dataModel,
    },
    {
      name: "DiagramLayout",
      relType: `${PBI_REL_BASE}/PowerBIPackageDiagramLayout`,
      json: { version: "1.1.0", diagrams: [] },
    },
    {
      name: "Settings",
      relType: `${PBI_REL_BASE}/PowerBIPackageSettings`,
      json: { version: "4.0" },
    },
    {
      name: "Metadata",
      relType: `${PBI_REL_BASE}/PowerBIPackageMetadata`,
      json: { version: "1.0", createdFromTemplate: true },
    },
    {
      name: "Report/Layout",
      relType: `${PBI_REL_BASE}/PowerBIPackageReportLayout`,
      json: reportLayout,
    },
  ];

  const parts: PackagePart[] = [];

  // [Content_Types].xml — declares the (empty) content type for each part.
  const overrides = specs
    .map((s) => `<Override PartName="/${s.name}" ContentType="" />`)
    .join("");
  const contentTypes =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="xml" ContentType="application/xml" />` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />` +
    overrides +
    `</Types>`;
  parts.push({
    name: "[Content_Types].xml",
    data: Buffer.from(contentTypes, "utf8"),
  });

  // Package relationships — one per Power BI part.
  const rels = specs
    .map(
      (s, i) =>
        `<Relationship Type="${s.relType}" Target="/${s.name}" Id="rId${i + 1}" />`,
    )
    .join("");
  const relsXml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels +
    `</Relationships>`;
  parts.push({ name: "_rels/.rels", data: Buffer.from(relsXml, "utf8") });

  for (const s of specs) {
    const payload =
      s.json !== null ? JSON.stringify(s.json) : (s.text ?? "");
    parts.push({ name: s.name, data: encodeUtf16LeWithBom(payload) });
  }

  return parts;
}

// --- Deterministic STORED ZIP -------------------------------------------

// Fixed DOS date/time (1980-01-01 00:00:00) so the committed binary is
// reproducible — re-running the build must not produce a git diff.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

function localHeader(part: PackagePart, crc: number): Buffer {
  const nameBuf = Buffer.from(part.name, "utf8");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); // local file header signature
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(0, 6); // flags
  h.writeUInt16LE(0, 8); // method = stored
  h.writeUInt16LE(DOS_TIME, 10);
  h.writeUInt16LE(DOS_DATE, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(part.data.length, 18); // compressed size
  h.writeUInt32LE(part.data.length, 22); // uncompressed size
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([h, nameBuf]);
}

function centralHeader(
  part: PackagePart,
  crc: number,
  offset: number,
): Buffer {
  const nameBuf = Buffer.from(part.name, "utf8");
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0); // central dir signature
  h.writeUInt16LE(20, 4); // version made by
  h.writeUInt16LE(20, 6); // version needed
  h.writeUInt16LE(0, 8); // flags
  h.writeUInt16LE(0, 10); // method
  h.writeUInt16LE(DOS_TIME, 12);
  h.writeUInt16LE(DOS_DATE, 14);
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(part.data.length, 20);
  h.writeUInt32LE(part.data.length, 24);
  h.writeUInt16LE(nameBuf.length, 28);
  h.writeUInt16LE(0, 30); // extra
  h.writeUInt16LE(0, 32); // comment
  h.writeUInt16LE(0, 34); // disk number
  h.writeUInt16LE(0, 36); // internal attrs
  h.writeUInt32LE(0, 38); // external attrs
  h.writeUInt32LE(offset, 42);
  return Buffer.concat([h, nameBuf]);
}

export function zipStore(parts: PackagePart[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const crc = crc32(part.data);
    const lh = localHeader(part, crc);
    chunks.push(lh, part.data);
    central.push(centralHeader(part, crc, offset));
    offset += lh.length + part.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // central dir disk
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

export function buildPbit(args: {
  queriesM: string;
  measuresDax: string;
}): Buffer {
  return zipStore(buildPbitParts(args));
}
