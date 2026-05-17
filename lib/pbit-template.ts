/**
 * Pure builders for the `Collectables-Starter.pbit` Power BI template
 * (Analytics #15b). No `react-native`, no node-only imports — every helper
 * takes plain strings and returns strings / byte arrays so they are
 * unit-testable under `tsx --test` and reusable by
 * `scripts/build-powerbi-template.ts`.
 *
 * The `.pbit` is generated *from* the committed text assets
 * (`docs/powerbi/measures.dax` + `docs/powerbi/queries.m`) so the binary
 * template and the copy-paste fallback can never drift — the README's
 * "the verifiable source the `.pbit` is built from" claim is literally
 * enforced by `__tests__/pbit-template.test.ts`.
 *
 * A `.pbit` is an OPC (ZIP) package. Power BI Desktop stores the JSON/text
 * parts as **UTF-16 LE (no BOM)** and `[Content_Types].xml` as UTF-8. The
 * model carries the four Supabase connection parameters as M parameter
 * queries so opening the template prompts for host/port/db/schema instead
 * of hard-coding them.
 */

import { createZip, type ZipEntry } from "@/lib/zip-writer";

/** PBIT/PBIX `Version` payload Power BI Desktop expects for this schema. */
export const PBIT_VERSION = "3.0";

/** M parameter names — must match the identifiers `queries.m` references. */
export const PBIT_PARAMETER_NAMES = [
  "SupabaseHost",
  "SupabasePort",
  "SupabaseDb",
  "SupabaseSchema",
] as const;

export type DaxMeasure = {
  readonly name: string;
  readonly expression: readonly string[];
};

/**
 * Parse `docs/powerbi/measures.dax` into measure blocks. A measure header is
 * a line of the form `Name :=`; its expression runs until the next header, a
 * `//` comment line, or a blank separator line.
 */
export function parseDaxMeasures(daxText: string): DaxMeasure[] {
  const lines = daxText.split(/\r?\n/);
  const measures: { name: string; expression: string[] }[] = [];
  let current: { name: string; expression: string[] } | null = null;

  const headerRe = /^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.*)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    const isComment = trimmed.startsWith("//");
    const isBlank = trimmed.length === 0;
    const header = headerRe.exec(line);

    if (header) {
      if (current) measures.push(current);
      current = { name: header[1], expression: [] };
      if (header[2].trim().length > 0) current.expression.push(header[2]);
      continue;
    }
    if (!current) continue;
    if (isComment || isBlank) {
      // Blank/comment terminates the current measure expression.
      measures.push(current);
      current = null;
      continue;
    }
    current.expression.push(line);
  }
  if (current) measures.push(current);

  return measures.map((m) => ({
    name: m.name,
    expression: m.expression.slice(),
  }));
}

/**
 * Pull the four parameter default literals out of `queries.m`'s `let` block.
 */
export function extractQueryParameterDefaults(
  queriesM: string,
): Record<(typeof PBIT_PARAMETER_NAMES)[number], string> {
  const read = (name: string): string => {
    const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
    const match = re.exec(queriesM);
    return match ? match[1] : "";
  };
  return {
    SupabaseHost: read("SupabaseHost"),
    SupabasePort: read("SupabasePort"),
    SupabaseDb: read("SupabaseDb"),
    SupabaseSchema: read("SupabaseSchema"),
  };
}

/**
 * Turn `queries.m` into the table partition M: drop the leading file-header
 * comment block and the four `Supabase* = "literal"` assignments (those
 * become shared M parameter queries the partition references by name).
 */
export function buildPartitionExpression(queriesM: string): string[] {
  const lines = queriesM.split(/\r?\n/);
  const letIndex = lines.findIndex((l) => l.trim() === "let");
  if (letIndex === -1) {
    throw new Error("queries.m: missing `let` block");
  }
  const paramAssignRe =
    /^\s*Supabase(Host|Port|Db|Schema)\s*=\s*"[^"]*",?\s*$/;
  return lines
    .slice(letIndex)
    .filter((l) => !paramAssignRe.test(l));
}

/** UTF-16 LE encode without a BOM (the encoding Power BI uses internally). */
export function utf16le(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return out;
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
    .map((p) => `  <Override PartName="${p}" ContentType="" />`)
    .join("\n");
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '  <Default Extension="json" ContentType="" />\n' +
    `${overrides}\n` +
    "</Types>"
  );
}

function parameterExpression(defaultValue: string): string[] {
  return [
    `${JSON.stringify(defaultValue)} meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`,
  ];
}

function isRateMeasure(name: string): boolean {
  return /Rate/.test(name);
}

/** TMSL/TOM model definition (the `DataModelSchema` part). */
export function buildDataModelSchema(
  measures: readonly DaxMeasure[],
  partitionExpression: readonly string[],
  paramDefaults: Record<(typeof PBIT_PARAMETER_NAMES)[number], string>,
): string {
  const expressions = PBIT_PARAMETER_NAMES.map((name) => ({
    name,
    kind: "m" as const,
    expression: parameterExpression(paramDefaults[name]),
    annotations: [{ name: "PBI_ResultType", value: "Text" }],
  }));

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
      expressions,
      tables: [
        {
          name: "analytics_events",
          columns: [
            { name: "id", dataType: "string", sourceColumn: "id", summarizeBy: "none" },
            {
              name: "occurred_at",
              dataType: "dateTime",
              sourceColumn: "occurred_at",
              formatString: "General Date",
              summarizeBy: "none",
            },
            { name: "user_id", dataType: "string", sourceColumn: "user_id", summarizeBy: "none" },
            { name: "name", dataType: "string", sourceColumn: "name", summarizeBy: "none" },
            { name: "properties", dataType: "string", sourceColumn: "properties", summarizeBy: "none" },
          ],
          partitions: [
            {
              name: "analytics_events",
              mode: "import",
              source: { type: "m", expression: partitionExpression.slice() },
            },
          ],
          measures: measures.map((m) => ({
            name: m.name,
            expression: m.expression.slice(),
            ...(isRateMeasure(m.name)
              ? { formatString: "0.00%;-0.00%;0.00%" }
              : {}),
          })),
        },
      ],
      annotations: [
        {
          name: "PBI_QueryOrder",
          value: JSON.stringify([...PBIT_PARAMETER_NAMES, "analytics_events"]),
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
            size: { width: 200, height: 180 },
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

export function buildSettings(): string {
  return JSON.stringify({ version: "4.4" });
}

export function buildMetadata(): string {
  return JSON.stringify({
    version: "1.0",
    fileDescription:
      "Collectables analytics starter — DAU + listing funnel + premium conversion over public.analytics_events.",
  });
}

function visualContainer(
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
  config: object,
): object {
  return {
    x,
    y,
    z,
    width,
    height,
    config: JSON.stringify(config),
    filters: "[]",
    query: "",
    dataTransforms: "",
  };
}

function cardConfig(name: string, measure: string, title: string): object {
  return {
    name,
    layouts: [{ id: 0, position: { x: 0, y: 0, z: 0, width: 0, height: 0 } }],
    singleVisual: {
      visualType: "card",
      projections: { Values: [{ queryRef: `analytics_events.${measure}` }] },
      prototypeQuery: {
        Version: 2,
        From: [{ Name: "a", Entity: "analytics_events", Type: 0 }],
        Select: [
          {
            Measure: { Expression: { SourceRef: { Source: "a" } }, Property: measure },
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
}

function columnConfig(name: string): object {
  return {
    name,
    layouts: [{ id: 0, position: { x: 0, y: 0, z: 0, width: 0, height: 0 } }],
    singleVisual: {
      visualType: "clusteredColumnChart",
      projections: {
        Category: [{ queryRef: "analytics_events.name" }],
        Y: [
          { queryRef: "analytics_events.ItemsAdded" },
          { queryRef: "analytics_events.ListingsCreated" },
        ],
      },
      prototypeQuery: {
        Version: 2,
        From: [{ Name: "a", Entity: "analytics_events", Type: 0 }],
        Select: [
          {
            Column: { Expression: { SourceRef: { Source: "a" } }, Property: "name" },
            Name: "analytics_events.name",
          },
          {
            Measure: { Expression: { SourceRef: { Source: "a" } }, Property: "ItemsAdded" },
            Name: "analytics_events.ItemsAdded",
          },
          {
            Measure: { Expression: { SourceRef: { Source: "a" } }, Property: "ListingsCreated" },
            Name: "analytics_events.ListingsCreated",
          },
        ],
      },
      drillFilterOtherVisuals: true,
      vcObjects: {
        title: [
          {
            properties: {
              text: {
                expr: {
                  Literal: {
                    Value: "'Listing funnel — ItemsAdded vs ListingsCreated'",
                  },
                },
              },
              show: { expr: { Literal: { Value: "true" } } },
            },
          },
        ],
      },
    },
  };
}

/** The `Report/Layout` part — one page with DAU + funnel + conversion. */
export function buildReportLayout(): string {
  const reportConfig = {
    version: "5.43",
    activeSectionIndex: 0,
    defaultDrillFilterOtherVisuals: true,
    settings: { useStylableVisualContainerHeader: true },
  };
  const layout = {
    id: 0,
    resourcePackages: [],
    sections: [
      {
        id: 0,
        name: "ReportSection",
        displayName: "Collectables — Analytics Starter",
        filters: "[]",
        ordinal: 0,
        visualContainers: [
          visualContainer(20, 20, 300, 180, 0, cardConfig("dauCard", "DAU", "Daily Active Users")),
          visualContainer(340, 20, 620, 420, 1, columnConfig("funnelChart")),
          visualContainer(
            20,
            220,
            300,
            220,
            2,
            cardConfig("premiumCard", "PremiumConversionRate7d", "Premium conversion (7d)"),
          ),
        ],
        config: JSON.stringify({ visibility: 0 }),
        displayOption: 1,
        width: 1280,
        height: 720,
      },
    ],
    config: JSON.stringify(reportConfig),
    layoutOptimization: 0,
  };
  return JSON.stringify(layout);
}

export type PbitSources = {
  readonly measuresDax: string;
  readonly queriesM: string;
};

/** Assemble every part of the `.pbit` package as ordered ZIP entries. */
export function buildPbitEntries(sources: PbitSources): ZipEntry[] {
  const measures = parseDaxMeasures(sources.measuresDax);
  const partition = buildPartitionExpression(sources.queriesM);
  const defaults = extractQueryParameterDefaults(sources.queriesM);
  return [
    {
      path: "[Content_Types].xml",
      data: new TextEncoder().encode(buildContentTypesXml()),
    },
    { path: "Version", data: utf16le(PBIT_VERSION) },
    {
      path: "DataModelSchema",
      data: utf16le(buildDataModelSchema(measures, partition, defaults)),
    },
    { path: "DiagramLayout", data: utf16le(buildDiagramLayout()) },
    { path: "Settings", data: utf16le(buildSettings()) },
    { path: "Metadata", data: utf16le(buildMetadata()) },
    { path: "Report/Layout", data: utf16le(buildReportLayout()) },
  ];
}

/** Serialise the full `.pbit` byte payload from the committed text assets. */
export function buildPbit(sources: PbitSources): Uint8Array {
  return createZip(buildPbitEntries(sources));
}
