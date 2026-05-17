/**
 * Pure builder for the Collectables Power BI starter template (`.pbit`).
 *
 * A `.pbit` is an OPC/ZIP package of JSON parts (UTF-16LE + BOM) plus a
 * `Version` text part and `[Content_Types].xml`. This module assembles that
 * part map deterministically from a single source of truth so the binary
 * committed under `docs/powerbi/Collectables-Starter.pbit` is byte-stable
 * and CI-verifiable.
 *
 * The text assets `docs/powerbi/queries.m` + `docs/powerbi/measures.dax`
 * (Analytics #15a) remain the human-readable / copy-paste fallback; the
 * model + measures encoded here mirror them verbatim. Keep all three in
 * sync with `docs/powerbi-connection.md` §5.
 *
 * Pure: Node `Buffer` only, no `react-native` / SDK imports, so the Power BI
 * tooling can import it server-side and the generator stays testable.
 */

import { createZip, type ZipEntry } from "./zip-writer";

export interface PbitParameter {
  /** M expression / parameter name surfaced in the Power BI prompt. */
  name: string;
  /** Default literal pre-filled in the open-template dialog. */
  defaultValue: string;
  /** Short description shown under the prompt field. */
  description: string;
}

export interface PbitMeasure {
  name: string;
  expression: string;
}

/**
 * The four Supabase session-pooler values surfaced as Power BI parameters
 * (so opening the `.pbit` prompts for them) — mirrors the literals at the
 * top of `docs/powerbi/queries.m`. Host + port are the two the task spec
 * calls out explicitly; db + schema round out a one-paste connection.
 */
export const PBIT_PARAMETERS: readonly PbitParameter[] = [
  {
    name: "SupabaseHost",
    defaultValue: "aws-0-<region>.pooler.supabase.com",
    description:
      "Supabase session-pooler host (Project → Settings → Database → Connection string → Session pooler).",
  },
  {
    name: "SupabasePort",
    defaultValue: "5432",
    description: "Session-pooler port (5432).",
  },
  {
    name: "SupabaseDb",
    defaultValue: "postgres",
    description: "Database name (postgres).",
  },
  {
    name: "SupabaseSchema",
    defaultValue: "public",
    description: "Schema holding analytics_events (public).",
  },
] as const;

export const ANALYTICS_EVENTS_COLUMNS: readonly {
  name: string;
  dataType: string;
}[] = [
  { name: "id", dataType: "string" },
  { name: "occurred_at", dataType: "dateTime" },
  { name: "user_id", dataType: "string" },
  { name: "name", dataType: "string" },
  { name: "properties", dataType: "string" },
] as const;

/**
 * The seven starter measures, verbatim from `docs/powerbi/measures.dax` and
 * `docs/powerbi-connection.md` §5. DISTINCTCOUNT on user_id (not row count)
 * so a power user counts once; DAU excludes anonymous (NULL) user_id rows.
 */
export const PBIT_MEASURES: readonly PbitMeasure[] = [
  {
    name: "DAU",
    expression:
      "CALCULATE ( DISTINCTCOUNT ( analytics_events[user_id] ), NOT ( ISBLANK ( analytics_events[user_id] ) ) )",
  },
  {
    name: "ItemsAdded",
    expression:
      'CALCULATE ( DISTINCTCOUNT ( analytics_events[user_id] ), analytics_events[name] = "item_added" )',
  },
  {
    name: "ListingsCreated",
    expression:
      'CALCULATE ( DISTINCTCOUNT ( analytics_events[user_id] ), analytics_events[name] = "listing_created" )',
  },
  {
    name: "ListingFunnelRate",
    expression: "DIVIDE ( [ListingsCreated], [ItemsAdded] )",
  },
  {
    name: "SignupsLast7d",
    expression:
      'CALCULATE ( DISTINCTCOUNT ( analytics_events[user_id] ), analytics_events[name] = "signup_completed", DATESINPERIOD ( analytics_events[occurred_at], MAX ( analytics_events[occurred_at] ), -7, DAY ) )',
  },
  {
    name: "PremiumActivationsLast7d",
    expression:
      'CALCULATE ( DISTINCTCOUNT ( analytics_events[user_id] ), analytics_events[name] = "premium_activated", DATESINPERIOD ( analytics_events[occurred_at], MAX ( analytics_events[occurred_at] ), -7, DAY ) )',
  },
  {
    name: "PremiumConversionRate7d",
    expression: "DIVIDE ( [PremiumActivationsLast7d], [SignupsLast7d] )",
  },
] as const;

export const PBIT_MODEL_NAME = "Collectables-Starter";
export const PBIT_VERSION = "1.0";

const escapeMString = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '""');

/**
 * The Power Query (M) partition for `analytics_events`, parameterised by the
 * Supabase parameters — `SupabaseHost & ":" & SupabasePort`. Defensive
 * `try Json.Document(_) otherwise null` on the jsonb `properties` column so a
 * single malformed row can't fail the whole refresh (mirrors queries.m).
 */
export function buildAnalyticsEventsMExpression(): string {
  return [
    "let",
    '    Server = SupabaseHost & ":" & SupabasePort,',
    "    Source = PostgreSQL.Database(Server, SupabaseDb),",
    '    Events = Source{[Schema = SupabaseSchema, Item = "analytics_events"]}[Data],',
    "    Typed = Table.TransformColumnTypes(Events, {{\"occurred_at\", type datetimezone}, {\"name\", type text}}),",
    "    Parsed = Table.TransformColumns(Typed, {{\"properties\", each try Json.Document(_) otherwise null}})",
    "in",
    "    Parsed",
  ].join("\n");
}

interface DataModelSchema {
  name: string;
  compatibilityLevel: number;
  model: unknown;
}

export function buildDataModelSchema(): DataModelSchema {
  return {
    name: PBIT_MODEL_NAME,
    compatibilityLevel: 1567,
    model: {
      culture: "en-US",
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      dataAccessOptions: {
        legacyRedirects: true,
        returnErrorValuesAsNull: true,
      },
      expressions: PBIT_PARAMETERS.map((p) => ({
        name: p.name,
        kind: "m",
        // `meta [IsParameterQuery=true ...]` is what makes Power BI treat the
        // expression as a parameter and prompt for it when the .pbit opens.
        expression: `"${escapeMString(p.defaultValue)}" meta [IsParameterQuery=true, List=null, DefaultValue="${escapeMString(
          p.defaultValue,
        )}", Type="Text", IsParameterQueryRequired=true]`,
        annotations: [
          { name: "PBI_NavigationStepName", value: "Navigation" },
          { name: "PBI_ResultType", value: "Text" },
        ],
      })),
      tables: [
        {
          name: "analytics_events",
          columns: ANALYTICS_EVENTS_COLUMNS.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            sourceColumn: c.name,
            summarizeBy: "none",
          })),
          partitions: [
            {
              name: "analytics_events",
              mode: "import",
              source: {
                type: "m",
                expression: buildAnalyticsEventsMExpression().split("\n"),
              },
            },
          ],
          measures: PBIT_MEASURES.map((m) => ({
            name: m.name,
            expression: m.expression,
          })),
        },
      ],
      annotations: [
        {
          name: "PBI_QueryOrder",
          value: JSON.stringify([
            ...PBIT_PARAMETERS.map((p) => p.name),
            "analytics_events",
          ]),
        },
        { name: "__PBI_TimeIntelligenceEnabled", value: "0" },
      ],
    },
  };
}

export function buildReportLayout(): unknown {
  // Minimal but well-formed report: two pages wired to the measures. Power BI
  // may re-lay-out visuals on open; the model (above) is the load-bearing
  // part. Kept lean so the binary stays small and deterministic.
  const page = (name: string, displayName: string) => ({
    name,
    displayName,
    filters: "[]",
    ordinal: name === "DAU" ? 0 : 1,
    visualContainers: [],
    config: JSON.stringify({ visibility: 0 }),
  });
  return {
    id: 0,
    resourcePackages: [],
    config: JSON.stringify({
      version: "5.43",
      themeCollection: { baseTheme: { name: "CY24SU06" } },
    }),
    layoutOptimization: 0,
    sections: [page("DAU", "DAU"), page("Funnel", "Funnel & Premium")],
  };
}

export function buildContentTypesXml(): string {
  // OPC content-types. Power BI emits empty ContentType strings for these
  // parts in real .pbix/.pbit packages; mirror that.
  const overrides = [
    "/Version",
    "/DataModelSchema",
    "/DiagramLayout",
    "/Report/Layout",
    "/Settings",
    "/Metadata",
  ]
    .map((part) => `<Override PartName="${part}" ContentType="" />`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="json" ContentType="" />' +
    overrides +
    "</Types>"
  );
}

const utf16leJson = (value: unknown): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xfe]), // UTF-16LE BOM
    Buffer.from(JSON.stringify(value), "utf16le"),
  ]);

/**
 * Ordered OPC parts of the `.pbit`. Order is fixed so the ZIP central
 * directory — and therefore the committed binary — is deterministic.
 */
export function buildPbitParts(): ZipEntry[] {
  return [
    { name: "Version", data: Buffer.from(PBIT_VERSION, "utf8") },
    {
      name: "[Content_Types].xml",
      data: Buffer.from(buildContentTypesXml(), "utf8"),
    },
    { name: "DataModelSchema", data: utf16leJson(buildDataModelSchema()) },
    {
      name: "DiagramLayout",
      data: utf16leJson({ version: "1.1.0", diagrams: [] }),
    },
    { name: "Report/Layout", data: utf16leJson(buildReportLayout()) },
    {
      name: "Metadata",
      data: utf16leJson({
        version: PBIT_VERSION,
        createdFrom: "Collectables analytics starter (Analytics #15b)",
      }),
    },
    { name: "Settings", data: utf16leJson({ version: PBIT_VERSION, settings: {} }) },
  ];
}

export function createPbitBuffer(): Buffer {
  return createZip(buildPbitParts());
}
