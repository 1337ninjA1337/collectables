import { stripComments } from "@/lib/env-inlining";

/**
 * Inline-radius scanner behind `scripts/check-inline-radius.ts` (`npm run
 * lint:radius`): flags inline radius literals in `app/**` / `components/**`
 * that have a design token. The RADIUS_PILL migration (batches 1-5) and the
 * RADIUS_CARD migration (batches A-D, both 2026-07-12) routed every
 * occurrence through `lib/design-tokens.ts`; this guard keeps the tree
 * clean the same way `lint:hex` guards the color palette.
 * `lib/design-tokens.ts` itself is the only file allowed to carry the
 * literals and is outside the scan roots.
 *
 * Pure module: no filesystem access — the CLI walks the directories and
 * hands sources over, so the matcher is unit-testable under node --test.
 * Comments are stripped (via the shared `stripComments`) so prose like this
 * doc block can mention `borderRadius: 999` without tripping the scan.
 */

/**
 * The guarded literals and the token each must route through. Word
 * boundaries keep 9990/220/247-style values from matching by accident.
 * Extend this table as further radius anchors gain tokens.
 */
export const RADIUS_RULES: ReadonlyArray<{
  pattern: RegExp;
  token: string;
}> = [
  { pattern: /borderRadius:\s*999\b/g, token: "RADIUS_PILL" },
  { pattern: /borderRadius:\s*22\b/g, token: "RADIUS_CARD" },
  { pattern: /borderRadius:\s*24\b/g, token: "RADIUS_CARD_LG" },
];

export type RadiusMatch = {
  file: string;
  line: number;
  /** The offending source line, trimmed, for the report. */
  snippet: string;
  /** The design token the literal must route through. */
  token: string;
};

/**
 * Scan one source string for inline radius literals. Comments are ignored;
 * string literals are left intact (a `"borderRadius: 999"` string would
 * still flag, which is fine — no legitimate one exists).
 */
export function findInlineRadiusLiterals(
  file: string,
  source: string,
): RadiusMatch[] {
  const matches: RadiusMatch[] = [];
  const stripped = stripComments(source);
  for (const rule of RADIUS_RULES) {
    const re = new RegExp(rule.pattern.source, "g");
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
        token: rule.token,
      });
    }
  }
  matches.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
  return matches;
}

/**
 * Format a list of matches as a human-readable error message. Returns an
 * empty string when there are no matches so callers can short-circuit.
 */
export function formatRadiusReport(matches: RadiusMatch[]): string {
  if (matches.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `Found ${matches.length} inline radius literal(s) in app/** or components/**.`,
  );
  lines.push(
    "Use the named token from lib/design-tokens.ts instead (see the RADIUS_PILL / RADIUS_CARD migrations in .tasks/.tasks.md).",
  );
  for (const m of matches) {
    lines.push("");
    lines.push(`  ${m.file}:${m.line}  → use ${m.token}`);
    lines.push(`    ${m.snippet}`);
  }
  return lines.join("\n");
}
