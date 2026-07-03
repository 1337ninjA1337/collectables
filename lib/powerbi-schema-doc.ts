/**
 * Generated Power BI schema-reference table — pure renderer.
 *
 * `docs/powerbi-connection.md`'s "Expanding `properties`" table is generated
 * from the typed event taxonomy in `lib/analytics-events.ts` so a new event
 * added to the union shows up in the BI doc automatically instead of becoming
 * an "unknown column" in Power Query. The doc carries a marker pair; the
 * content between the markers is owned by `scripts/generate-powerbi-schema-doc.ts`
 * (run `npm run powerbi:schema-doc` after editing the taxonomy) and CI fails
 * via `--check` when the doc drifts from the module.
 *
 * Dependency-free beyond the taxonomy module itself, so it is node-testable
 * (`__tests__/powerbi-schema-doc.test.ts`) and importable from scripts.
 */

import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
} from "@/lib/analytics-events";

export const POWERBI_SCHEMA_BEGIN = "<!-- powerbi-schema-table:begin -->";
export const POWERBI_SCHEMA_END = "<!-- powerbi-schema-table:end -->";

const GENERATED_NOTE =
  "<!-- Generated from lib/analytics-events.ts by scripts/generate-powerbi-schema-doc.ts — do not edit by hand; run `npm run powerbi:schema-doc`. -->";

/** Escape the two characters that would break a GitHub-flavoured Markdown table cell. */
export function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * The full per-event property-key table, one row per event in the taxonomy,
 * sorted by event name (via `ANALYTICS_EVENT_NAMES`) so output is stable
 * regardless of object insertion order.
 */
export function renderPowerbiSchemaTable(): string {
  const rows = ANALYTICS_EVENT_NAMES.map((name) => {
    const def = ANALYTICS_EVENTS[name];
    const props = def.props.map((p) => `\`${p}\``).join(", ");
    return `| \`${name}\` | ${props} | ${escapeTableCell(def.description)} |`;
  });
  return [
    "| Event | Property keys | Description |",
    "| ----- | ------------- | ----------- |",
    ...rows,
  ].join("\n");
}

/** The complete marker-delimited block, including the markers themselves. */
export function renderPowerbiSchemaBlock(): string {
  return [
    POWERBI_SCHEMA_BEGIN,
    GENERATED_NOTE,
    renderPowerbiSchemaTable(),
    POWERBI_SCHEMA_END,
  ].join("\n");
}

/**
 * Replace the marker-delimited block inside a doc source with the freshly
 * rendered one. Throws when the markers are missing or malformed so a doc
 * refactor that drops them fails loudly instead of silently un-generating.
 */
export function injectPowerbiSchemaBlock(docSource: string): string {
  const begin = docSource.indexOf(POWERBI_SCHEMA_BEGIN);
  const end = docSource.indexOf(POWERBI_SCHEMA_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `powerbi-schema-doc: marker pair not found (expected "${POWERBI_SCHEMA_BEGIN}" … "${POWERBI_SCHEMA_END}")`,
    );
  }
  return (
    docSource.slice(0, begin) +
    renderPowerbiSchemaBlock() +
    docSource.slice(end + POWERBI_SCHEMA_END.length)
  );
}
