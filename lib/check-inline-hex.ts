/**
 * Inline-hex scanner used by `scripts/check-inline-hex.ts` and its tests.
 *
 * Pure module: no React Native imports, no filesystem access. Filesystem
 * walking lives in the script wrapper so the matcher can be unit-tested
 * under `node --test` without mocking `fs`.
 *
 * The check enforces the design-tokens convention shipped across the
 * Low-density design-tokens migration (lines 122-148 of .tasks/.tasks.md):
 * every 6-digit hex literal in `app/**`, `components/**` and `lib/**`
 * (`.ts` and `.tsx` alike) must route through a named export from
 * `lib/design-tokens.ts`, except the exact paths in `HEX_ALLOWLIST` that
 * legitimately produce color values. Quote-delimited 3/4-digit shorthands
 * (#fff, #fffa — migrated to PURE_WHITE in 2026-07) are caught by a second
 * pattern that requires surrounding quotes, so prose references to issue
 * numbers or shorthand hex in comments never false-positive. `rgba(...)`
 * alpha overlays (pending the OVERLAY_* family) are still exempt by design.
 */

/** Regex matching a 6-digit hex literal (case-insensitive, no word boundary). */
export const INLINE_HEX_PATTERN = /#[0-9a-fA-F]{6}/g;

/**
 * Regex matching a QUOTED 3- or 4-digit hex shorthand — the whole string
 * literal must be the shorthand (quote, hash, 3-4 hex digits, same quote).
 * Requiring the quotes keeps comment prose like "task #15b" or an unquoted
 * #fff mention in a doc block from being flagged; an actual style value in
 * RN code is always a string literal. 5+ digits fall through: 6-digit is the
 * main pattern's job and 7-digit typos still match its leading 6.
 */
export const INLINE_HEX_SHORT_PATTERN = /(["'`])#[0-9a-fA-F]{3,4}\1/g;

/**
 * Exact repo-relative paths allowed to carry 6-digit hex literals. The scan
 * covers `.ts` as well as `.tsx` (and `lib/` as well as `app/`/`components/`),
 * so the modules that legitimately produce or hard-code color values need an
 * explicit, documented exemption — anything NOT listed here fails the lint.
 *
 * - `lib/design-tokens.ts` — the palette source of truth itself.
 * - `lib/placeholder-color.ts` — derives a deterministic warm-palette color
 *   from an item id; the 12-entry PALETTE is the feature.
 * - `lib/privacy-page.ts` — renders the standalone /privacy HTML page whose
 *   inline CSS cannot import design tokens (CSP `default-src 'none'`).
 * - `lib/export-pdf.ts` — builds the print-HTML template for PDF export;
 *   same standalone-document reasoning as the privacy page.
 * - `lib/toast-context.tsx` — the 13-hex toast palette; queued for its own
 *   design-tokens migration (see .tasks/.suggestions.md), exempt until then.
 */
export const HEX_ALLOWLIST: ReadonlySet<string> = new Set([
  "lib/design-tokens.ts",
  "lib/placeholder-color.ts",
  "lib/privacy-page.ts",
  "lib/export-pdf.ts",
  "lib/toast-context.tsx",
]);

/** True when the repo-relative path is exempt from the inline-hex scan. */
export function isHexAllowlisted(file: string): boolean {
  return HEX_ALLOWLIST.has(file);
}

export type HexMatch = {
  file: string;
  line: number;
  column: number;
  value: string;
};

/**
 * Scan a single source string for 6-digit hex literals and quoted 3/4-digit
 * shorthands. Returns one entry per occurrence (line + column 1-indexed,
 * column pointing at the leading `#`), sorted by position within each line.
 */
export function findInlineHexLiterals(file: string, source: string): HexMatch[] {
  const matches: HexMatch[] = [];
  if (isHexAllowlisted(file)) return matches;
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const perLine: HexMatch[] = [];
    // Reset regex state per-line because we use `g` flag at the module scope.
    const re = new RegExp(INLINE_HEX_PATTERN.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      perLine.push({
        file,
        line: i + 1,
        column: m.index + 1,
        value: m[0],
      });
    }
    const shortRe = new RegExp(INLINE_HEX_SHORT_PATTERN.source, "g");
    while ((m = shortRe.exec(line)) !== null) {
      perLine.push({
        file,
        line: i + 1,
        // +1 for 1-indexing, +1 to skip the opening quote onto the `#`.
        column: m.index + 2,
        value: m[0].slice(1, -1),
      });
    }
    perLine.sort((a, b) => a.column - b.column);
    matches.push(...perLine);
  }
  return matches;
}

/**
 * Format a list of matches as a human-readable error message. Returns an
 * empty string when there are no matches so callers can short-circuit.
 */
export function formatHexReport(matches: HexMatch[]): string {
  if (matches.length === 0) return "";
  const grouped = new Map<string, HexMatch[]>();
  for (const m of matches) {
    const list = grouped.get(m.file) ?? [];
    list.push(m);
    grouped.set(m.file, list);
  }
  const lines: string[] = [];
  lines.push(
    `Found ${matches.length} inline hex literal(s) in app/**, components/** or lib/**.`,
  );
  lines.push(
    "Route each through a named export from lib/design-tokens.ts (see .tasks/.tasks.md ‘Low-density design-tokens migration’).",
  );
  for (const [file, list] of grouped) {
    lines.push("");
    lines.push(`  ${file}`);
    for (const m of list) {
      lines.push(`    ${m.line}:${m.column}  ${m.value}`);
    }
  }
  return lines.join("\n");
}
