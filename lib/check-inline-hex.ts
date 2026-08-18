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

import { stripComments } from "./strip-comments";

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
 *
 * `lib/toast-context.tsx` was exempt here until 2026-08-09 for its 13-hex toast
 * palette; that file is now fully tokenised, so the exemption is gone and the
 * lint guards it like any other module.
 */
export const HEX_ALLOWLIST: ReadonlySet<string> = new Set([
  "lib/design-tokens.ts",
  "lib/placeholder-color.ts",
  "lib/privacy-page.ts",
  "lib/export-pdf.ts",
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
 *
 * Comments are removed first, and `stripComments` blanks rather than deletes —
 * every offset and newline survives, so the line and column reported here
 * still point at the original source. Until this guard was the last scanner in
 * the repo not doing it, the quote requirement on the SHORTHAND pattern was
 * carrying the whole load: it kept `#fff` in prose from being flagged, and
 * nothing protected the 6-digit pattern, which has no quotes to require. A
 * comment reading "was #1a2b3c before the token migration" would have failed
 * CI on prose. The quote requirement stays — an unquoted hex in real code is
 * still not a style value — but it is no longer the only thing standing
 * between a doc block and a red build.
 */
export function findInlineHexLiterals(file: string, source: string): HexMatch[] {
  if (isHexAllowlisted(file)) return [];
  const code = stripComments(source);
  const at = lineColumnLookup(code);
  /** Offset kept beside the match, because it is what the sort orders by. */
  const found: { offset: number; value: string }[] = [];
  for (const m of code.matchAll(new RegExp(INLINE_HEX_PATTERN.source, "g"))) {
    found.push({ offset: m.index, value: m[0] });
  }
  for (const m of code.matchAll(new RegExp(INLINE_HEX_SHORT_PATTERN.source, "g"))) {
    // +1 to step past the opening quote onto the `#`, so the reported column
    // points at the hash for both patterns rather than at the delimiter.
    found.push({ offset: m.index + 1, value: m[0].slice(1, -1) });
  }
  // By offset, which orders by line and then by column in one comparison —
  // the two per-line arrays this used to merge were the same order arrived at
  // in two steps.
  found.sort((a, b) => a.offset - b.offset);
  return found.map(({ offset, value }) => ({ file, ...at(offset), value }));
}

/**
 * An offset → `{ line, column }` reader over one file, both 1-indexed.
 *
 * The scan used to split into lines and run a fresh `RegExp` per line, because
 * the two patterns carry `g` at module scope and `exec` state would otherwise
 * carry across files. `matchAll` on a per-call clone answers that without the
 * split, which leaves one pass over the whole text and this lookup as the only
 * thing the split was buying. It is also how the four `stripComments` lint
 * guards already report, so the last scanner not doing it now agrees with the
 * rest.
 *
 * Binary search rather than a scan, so a file with a match near the end costs
 * the same as one with a match near the start; and the offsets are the
 * ORIGINAL ones, because `stripComments` blanks rather than deletes.
 */
function lineColumnLookup(code: string): (offset: number) => { line: number; column: number } {
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "\n") lineStarts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };
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

/** Escape a workflow-command property value (file=..., etc.). */
function escapeAnnotationProperty(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

/** Escape a workflow-command message (the part after `::`). */
function escapeAnnotationMessage(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Format matches as GitHub Actions `::error` workflow commands — one line per
 * finding — so CI surfaces each inline hex as a click-through annotation on
 * the PR diff instead of only a log-buried report. The script wrapper prints
 * these IN ADDITION to `formatHexReport` when running under Actions
 * (`GITHUB_ACTIONS=true`); locally they are skipped as noise.
 */
export function formatGitHubAnnotations(matches: HexMatch[]): string[] {
  return matches.map(
    (m) =>
      `::error file=${escapeAnnotationProperty(m.file)},line=${m.line},col=${m.column}::` +
      escapeAnnotationMessage(
        `Inline hex literal ${m.value} — route it through a named export from lib/design-tokens.ts`,
      ),
  );
}
