import { stripComments } from "@/lib/env-inlining";

/**
 * Inline-geometry scanner behind `scripts/check-inline-radius.ts` (`npm run
 * lint:radius`): flags inline radius/gap literals in `app/**` /
 * `components/**` that have a design token. The RADIUS_PILL migration
 * (batches 1-5), the RADIUS_CARD migration (batches A-D) and the SPACING
 * gap migration (batches 1-6, all 2026-07-12) routed every occurrence
 * through `lib/design-tokens.ts`; this guard keeps the tree clean the same
 * way `lint:hex` guards the color palette.
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
 * boundaries keep 9990/220/247/100/128/80-style values from matching by
 * accident, and the leading `\b` on the gap rules keeps `rowGap:` /
 * `columnGap:` out of scope (they were not part of the migration — see the
 * rowGap/columnGap audit suggestion in .tasks/.suggestions.md).
 * Extend this table as further geometry anchors gain tokens.
 */
export const GEOMETRY_RULES: ReadonlyArray<{
  pattern: RegExp;
  token: string;
}> = [
  { pattern: /borderRadius:\s*999\b/g, token: "RADIUS_PILL" },
  { pattern: /borderRadius:\s*22\b/g, token: "RADIUS_CARD" },
  { pattern: /borderRadius:\s*24\b/g, token: "RADIUS_CARD_LG" },
  { pattern: /\bgap:\s*10\b/g, token: "SPACING_LIST" },
  { pattern: /\bgap:\s*12\b/g, token: "SPACING_CARD" },
  { pattern: /\bgap:\s*8\b/g, token: "SPACING_INLINE" },
];

/** Back-compat alias from before the table absorbed the gap rules. */
export const RADIUS_RULES = GEOMETRY_RULES;

export type RadiusMatch = {
  file: string;
  line: number;
  /** The offending source line, trimmed, for the report. */
  snippet: string;
  /** The design token the literal must route through. */
  token: string;
};

/**
 * Scan one source string for inline geometry literals. Comments are
 * ignored; string literals are left intact (a `"borderRadius: 999"` string
 * would still flag, which is fine — no legitimate one exists).
 */
export function findInlineRadiusLiterals(
  file: string,
  source: string,
): RadiusMatch[] {
  const matches: RadiusMatch[] = [];
  const stripped = stripComments(source);
  for (const rule of GEOMETRY_RULES) {
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
    `Found ${matches.length} inline geometry literal(s) in app/** or components/**.`,
  );
  lines.push(
    "Use the named token from lib/design-tokens.ts instead (see the RADIUS_PILL / RADIUS_CARD / SPACING gap migrations in .tasks/.tasks.md).",
  );
  for (const m of matches) {
    lines.push("");
    lines.push(`  ${m.file}:${m.line}  → use ${m.token}`);
    lines.push(`    ${m.snippet}`);
  }
  return lines.join("\n");
}
