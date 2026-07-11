import { stripComments } from "@/lib/env-inlining";

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
 * Matches static imports, re-exports, `require(...)` and dynamic
 * `import(...)` whose specifier resolves to the taxonomy module — the
 * `@/lib/...` alias or any relative path ending in `/analytics-events`
 * (with or without extension). Longer names (`analytics-events-migration`)
 * do not match.
 */
export const ANALYTICS_EVENTS_IMPORT_PATTERN =
  /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["'][^"']*\/analytics-events(?:\.[jt]sx?)?["']/g;

export type AnalyticsImportMatch = {
  file: string;
  line: number;
  /** The offending source line, trimmed, for the report. */
  snippet: string;
};

/**
 * Scan one source string for direct taxonomy imports. Comments are ignored
 * so prose like this module's own doc block can mention the specifier.
 */
export function findAnalyticsEventsImports(
  file: string,
  source: string,
): AnalyticsImportMatch[] {
  const matches: AnalyticsImportMatch[] = [];
  const stripped = stripComments(source);
  const re = new RegExp(ANALYTICS_EVENTS_IMPORT_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const before = stripped.slice(0, m.index);
    const line = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = source.indexOf("\n", m.index);
    matches.push({
      file,
      line,
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
