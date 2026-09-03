import { importSpecifiers, specifierEndsWithModule } from "@/lib/import-specifiers";

/**
 * Scanner behind `scripts/check-analytics-imports.ts` (`npm run
 * lint:analytics-imports`): flags any `app/**` / `components/**` module that
 * imports `@/lib/analytics-events` directly. Screens must consume the
 * taxonomy through `lib/analytics.ts` (`getAnalyticsEventCatalog`,
 * `trackEvent`) instead — the registry grows a `description` string per
 * event, so a direct screen import drags every description into the runtime
 * bundle and lets UI code bypass the wrapper's gates. Docs / Power BI
 * tooling and tests consume the module server-side, so `lib/`, `scripts/`
 * and `__tests__/` stay out of scope.
 *
 * Pure module: no filesystem access — the CLI walks the directories and
 * hands sources over, so the matcher is unit-testable under node --test.
 */

/**
 * The taxonomy module, named by the suffix of a specifier that reaches it.
 *
 * `specifierEndsWithModule` applies the rule: the `@/lib/...` alias or any
 * relative path ending in `/analytics-events`, with or without extension, and
 * longer names (`analytics-events-migration`) do not match.
 */
const ANALYTICS_EVENTS_MODULE = "analytics-events";

export type AnalyticsImportMatch = {
  file: string;
  line: number;
  /** The offending source line, trimmed, for the report. */
  snippet: string;
};

/**
 * Scan one source string for direct taxonomy imports. Comments are ignored
 * so prose like this module's own doc block can mention the specifier.
 *
 * The four spellings come from `lib/import-specifiers.ts` rather than from a
 * pattern written here. That is one shape wider than what this guard used to
 * match: the side-effect `import "@/lib/analytics-events"` has no `from` and
 * was invisible to a rule whose whole subject is what a UI file drags into the
 * bundle. Offsets survive the comment strip, so `file:line` and the reported
 * snippet are still the real ones.
 */
export function findAnalyticsEventsImports(
  file: string,
  source: string,
): AnalyticsImportMatch[] {
  const matches: AnalyticsImportMatch[] = [];
  for (const record of importSpecifiers(source)) {
    if (!specifierEndsWithModule(record.specifier, ANALYTICS_EVENTS_MODULE)) continue;
    const before = source.slice(0, record.index);
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = source.indexOf("\n", record.index);
    matches.push({
      file,
      line: before.split("\n").length,
      snippet: source
        .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
        .trim(),
    });
  }
  return matches;
}

/**
 * Human-readable failure report; empty string when there is nothing to
 * report so callers can short-circuit.
 */
export function formatAnalyticsImportReport(
  matches: AnalyticsImportMatch[],
): string {
  if (matches.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `Found ${matches.length} direct import(s) of lib/analytics-events from UI code.`,
  );
  lines.push(
    "Screens must consume the taxonomy via lib/analytics.ts (getAnalyticsEventCatalog / trackEvent) so event descriptions stay out of the runtime bundle.",
  );
  for (const m of matches) {
    lines.push(`  ${m.file}:${m.line}  ${m.snippet}`);
  }
  return lines.join("\n");
}
