/**
 * Pure builder for the Collectables Power BI starter template
 * (`docs/powerbi/Collectables-Starter.pbit`) — Analytics #15b.
 *
 * A `.pbit` is an OPC (ZIP) package. This module assembles the documented
 * part set from plain strings so every byte is reviewable in source control
 * and unit-testable without Power BI Desktop (which is Windows-only and
 * cannot run in CI). `scripts/build-powerbi-template.ts` is the thin glue
 * that writes the bytes to disk; all logic lives here.
 *
 * The model is parameterised by the four Supabase *session pooler* values
 * (`SupabaseHost` / `SupabasePort` / `SupabaseDb` / `SupabaseSchema`) so the
 * user is prompted for them on open — no M editing required. The embedded
 * DAX measures and M source mirror `docs/powerbi/measures.dax` +
 * `docs/powerbi/queries.m` verbatim (parity is asserted by
 * `__tests__/powerbi-template.test.ts`), so the copy-paste fallback and the
 * binary template always produce the same model.
 *
 * No `react-native` / SDK imports — pure Node so the build script and tests
 * stay peer-dep free.
 */

export type PbitPart = {
  /** OPC part name, e.g. `DataModelSchema` or `Report/Layout`. */
  readonly name: string;
  /** Raw bytes for the ZIP entry. */
  readonly data: Buffer;
};

/** The four Supabase session-pooler parameters surfaced on template open. */
export type StarterParameter = {
  readonly name: string;
  readonly value: string;
  readonly description: string;
};

export const STARTER_PARAMETERS: readonly StarterParameter[] = [
  {
    name: "SupabaseHost",
    value: "aws-0-<region>.pooler.supabase.com",
    description:
      "Supabase session-pooler host (Project → Settings → Database → Connection string → Session pooler).",
  },
  {
    name: "SupabasePort",
    value: "5432",
    description: "Session-pooler port (5432).",
  },
  {
    name: "SupabaseDb",
    value: "postgres",
    description: "Database name (postgres).",
  },
  {
    name: "SupabaseSchema",
    value: "public",
    description: "Schema that holds analytics_events (public).",
  },
];

/**
 * The starter DAX measures embedded in the model. Kept in lockstep with
 * `docs/powerbi/measures.dax` and `docs/powerbi-connection.md` §5 — the
 * parity test fails CI if a name drifts.
 */
export const STARTER_MEASURES: readonly { name: string; expression: string }[] =
  [
    {
      name: "DAU",
      expression:
        "CALCULATE (\n    DISTINCTCOUNT ( analytics_events[user_id] ),\n    NOT ( ISBLANK ( analytics_events[user_id] ) )\n)",
    },
    {
      name: "ItemsAdded",
      expression:
        'CALCULATE (\n    DISTINCTCOUNT ( analytics_events[user_id] ),\n    analytics_events[name] = "item_added"\n)',
    },
    {
      name: "ListingsCreated",
      expression:
        'CALCULATE (\n    DISTINCTCOUNT ( analytics_events[user_id] ),\n    analytics_events[name] = "listing_created"\n)',
    },
    {
      name: "ListingFunnelRate",
      expression: "DIVIDE ( [ListingsCreated], [ItemsAdded] )",
    },
    {
      name: "SignupsLast7d",
      expression:
        'CALCULATE (\n    DISTINCTCOUNT ( analytics_events[user_id] ),\n    analytics_events[name] = "signup_completed",\n    DATESINPERIOD (\n        analytics_events[occurred_at],\n        MAX ( analytics_events[occurred_at] ),\n        -7,\n        DAY\n    )\n)',
    },
    {
      name: "PremiumActivationsLast7d",
      expression:
        'CALCULATE (\n    DISTINCTCOUNT ( analytics_events[user_id] ),\n    analytics_events[name] = "premium_activated",\n    DATESINPERIOD (\n        analytics_events[occurred_at],\n        MAX ( analytics_events[occurred_at] ),\n        -7,\n        DAY\n    )\n)',
    },
    {
      name: "PremiumConversionRate7d",
      expression: "DIVIDE ( [PremiumActivationsLast7d], [SignupsLast7d] )",
    },
  ];

const PBIX_FORMAT_VERSION = "3.0";
const COMPATIBILITY_LEVEL = 1550;

/** UTF-16 LE encode with a BOM — the encoding Power BI uses for JSON parts. */
export function encodeUtf16Le(text: string): Buffer {
  return Buffer.from("﻿" + text, "utf16le");
}

export function buildContentTypesXml(): string {
  const overrides = [
    "/Version",
    "/DataModelSchema",
    "/DiagramLayout",
    "/Report/Layout",
    "/Settings",
    "/Metadata",
    "/SecurityBindings",
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

export function buildVersion(): string {
  return PBIX_FORMAT_VERSION;
}

function parameterExpression(value: string): string {
  // The TMSL representation of a Power Query parameter: a literal with the
  // IsParameterQuery metadata so Power BI prompts for it on open.
  return `${JSON.stringify(value)} meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`;
}

const PARTITION_M = [
  "let",
  '    Server = SupabaseHost & ":" & SupabasePort,',
  "    Source = PostgreSQL.Database(Server, SupabaseDb),",
  '    Events = Source{[Schema=SupabaseSchema, Item="analytics_events"]}[Data],',
  "    Typed = Table.TransformColumnTypes(",
  "        Events,",
  '        {{"occurred_at", type datetimezone}, {"name", type text}}',
  "    )",
  "in",
  "    Typed",
].join("\n");

export function buildDataModelSchema(): string {
  const model = {
    name: "Collectables-Starter",
    compatibilityLevel: COMPATIBILITY_LEVEL,
    model: {
      culture: "en-US",
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      dataAccessOptions: {
        legacyRedirects: true,
        returnErrorValuesAsNull: true,
      },
      expressions: STARTER_PARAMETERS.map((p) => ({
        name: p.name,
        kind: "m",
        expression: parameterExpression(p.value),
        description: p.description,
        annotations: [
          { name: "PBI_NavigationStepName", value: "Navigation" },
          { name: "PBI_ResultType", value: "Text" },
        ],
      })),
      tables: [
        {
          name: "analytics_events",
          columns: [
            { name: "id", dataType: "string", sourceColumn: "id" },
            {
              name: "occurred_at",
              dataType: "dateTime",
              sourceColumn: "occurred_at",
              formatString: "General Date",
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
              source: { type: "m", expression: PARTITION_M },
            },
          ],
          measures: STARTER_MEASURES.map((m) => ({
            name: m.name,
            expression: m.expression,
            formatString:
              m.name.includes("Rate") || m.name.includes("Funnel")
                ? "0.0%;-0.0%;0.0%"
                : "#,0",
          })),
        },
      ],
      annotations: [
        {
          name: "PBI_QueryOrder",
          value: JSON.stringify([
            ...STARTER_PARAMETERS.map((p) => p.name),
            "analytics_events",
          ]),
        },
        { name: "__PBI_TimeIntelligenceEnabled", value: "0" },
      ],
    },
  };
  return JSON.stringify(model, null, 2);
}

export function buildDiagramLayout(): string {
  return JSON.stringify({
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
            size: { width: 220, height: 220 },
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
  });
}

function visualConfig(
  name: string,
  visualType: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  projections: Record<string, { queryRef: string }[]>,
  select: unknown[],
): string {
  return JSON.stringify({
    name,
    layouts: [
      { id: 0, position: { x, y, z, width: w, height: h, tabOrder: z } },
    ],
    singleVisual: {
      visualType,
      projections,
      prototypeQuery: {
        Version: 2,
        From: [{ Name: "a", Entity: "analytics_events", Type: 0 }],
        Select: select,
      },
      drillFilterOtherVisuals: true,
    },
  });
}

function columnSelect(property: string, name: string) {
  return {
    Column: { Expression: { SourceRef: { Source: "a" } }, Property: property },
    Name: name,
  };
}

function measureSelect(property: string) {
  return {
    Measure: { Expression: { SourceRef: { Source: "a" } }, Property: property },
    Name: property,
  };
}

function section(
  id: number,
  name: string,
  displayName: string,
  visualContainers: { x: number; y: number; z: number; width: number; height: number; config: string }[],
) {
  return {
    id,
    name,
    displayName,
    filters: "[]",
    ordinal: id,
    visualContainers: visualContainers.map((v) => ({
      x: v.x,
      y: v.y,
      z: v.z,
      width: v.width,
      height: v.height,
      config: v.config,
      filters: "[]",
      query: "",
      dataTransforms: "",
    })),
    config: "{}",
    displayOption: 1,
    width: 1280,
    height: 720,
  };
}

export function buildReportLayout(): string {
  const dauVisual = visualConfig(
    "dauLine",
    "lineChart",
    40,
    40,
    1200,
    620,
    0,
    {
      Category: [{ queryRef: "analytics_events.occurred_at" }],
      Y: [{ queryRef: "DAU" }],
    },
    [columnSelect("occurred_at", "analytics_events.occurred_at"), measureSelect("DAU")],
  );
  const funnelVisual = visualConfig(
    "funnelColumns",
    "clusteredColumnChart",
    40,
    40,
    760,
    620,
    0,
    {
      Y: [{ queryRef: "ItemsAdded" }, { queryRef: "ListingsCreated" }],
    },
    [measureSelect("ItemsAdded"), measureSelect("ListingsCreated")],
  );
  const funnelRateCard = visualConfig(
    "funnelRateCard",
    "card",
    820,
    40,
    420,
    300,
    1,
    { Values: [{ queryRef: "ListingFunnelRate" }] },
    [measureSelect("ListingFunnelRate")],
  );
  const premiumCard = visualConfig(
    "premiumCard",
    "card",
    820,
    360,
    420,
    300,
    2,
    { Values: [{ queryRef: "PremiumConversionRate7d" }] },
    [measureSelect("PremiumConversionRate7d")],
  );

  const layout = {
    id: 0,
    config: JSON.stringify({
      version: "5.43",
      activeSectionIndex: 0,
      defaultDrillFilterOtherVisuals: true,
      settings: { useStylableVisualContainerHeader: true },
    }),
    layoutOptimization: 0,
    sections: [
      section(0, "ReportSectionDau", "DAU", [
        { x: 40, y: 40, z: 0, width: 1200, height: 620, config: dauVisual },
      ]),
      section(1, "ReportSectionFunnel", "Listing funnel & premium", [
        { x: 40, y: 40, z: 0, width: 760, height: 620, config: funnelVisual },
        { x: 820, y: 40, z: 1, width: 420, height: 300, config: funnelRateCard },
        { x: 820, y: 360, z: 2, width: 420, height: 300, config: premiumCard },
      ]),
    ],
  };
  return JSON.stringify(layout);
}

export function buildSettings(): string {
  return JSON.stringify({
    version: "4.4",
    useStylableVisualContainerHeader: true,
  });
}

export function buildMetadata(): string {
  return JSON.stringify({
    version: PBIX_FORMAT_VERSION,
    autoCreateRelationships: false,
    fileDescription: "Collectables analytics starter (Analytics #15)",
  });
}

export function buildSecurityBindings(): string {
  return JSON.stringify({ Version: "0.0" });
}

/** Assemble every OPC part with the encoding Power BI expects. */
export function buildPbitParts(): PbitPart[] {
  return [
    { name: "[Content_Types].xml", data: Buffer.from(buildContentTypesXml(), "utf8") },
    { name: "Version", data: Buffer.from(buildVersion(), "utf8") },
    { name: "DataModelSchema", data: encodeUtf16Le(buildDataModelSchema()) },
    { name: "DiagramLayout", data: encodeUtf16Le(buildDiagramLayout()) },
    { name: "Report/Layout", data: encodeUtf16Le(buildReportLayout()) },
    { name: "Settings", data: encodeUtf16Le(buildSettings()) },
    { name: "Metadata", data: encodeUtf16Le(buildMetadata()) },
    { name: "SecurityBindings", data: Buffer.from(buildSecurityBindings(), "utf8") },
  ];
}

// --- Minimal, deterministic STORED ZIP writer (OPC-compatible) ------------
// No external archiver dependency: OPC packages accept uncompressed (method
// 0) entries, and a fixed DOS timestamp keeps the output byte-stable so the
// committed .pbit only changes when the parts change.

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(buf: Buffer): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01

export function createZip(parts: PbitPart[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const part of parts) {
    const nameBuf = Buffer.from(part.name, "utf8");
    const crc = crc32(part.data);
    const size = part.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed
    local.writeUInt32LE(size, 22); // uncompressed
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    locals.push(local, nameBuf, part.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + part.data.length;
  }

  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([localBlob, centralBlob, eocd]);
}

export function buildPbit(): Buffer {
  return createZip(buildPbitParts());
}
