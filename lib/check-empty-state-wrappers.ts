import { stripComments } from "@/lib/env-inlining";

/**
 * EmptyState wrapper audit (EmptyState design-tokens migration, 2026-05-25).
 *
 * `<EmptyState>` owns a layered cream visual (theme.card wrap over the
 * CARD_BG_2 → CARD_BG_3 → CARD_BG_14 icon rings). If a caller wraps it in
 * a `<View>` whose style sets a card-ish `backgroundColor`, the layers go
 * cream-on-cream and the dashed-border card silently disappears into its
 * container. This scanner finds every `<EmptyState` usage, resolves the
 * styles of each still-open enclosing `<View>` at that point, and flags any
 * enclosing background that is not a page-background token.
 *
 * Page backgrounds are legitimate: `CrashFallback` wraps its EmptyState in
 * a `PAGE_BG_2` container because the error boundary renders outside the
 * normal `<Screen>` chrome. Anything else (CARD_BG_*, AMBER_*, hex
 * literals, theme.card) is exactly the regression this guard pins down.
 *
 * Pure module: no filesystem access — callers walk the tree and hand
 * sources over, so the matcher is unit-testable under node --test.
 */

/** Wrapper backgrounds that stand in for the screen, not the card. */
export const ALLOWED_WRAPPER_BACKGROUNDS: ReadonlyArray<RegExp> = [
  /^PAGE_BG(_\d+)?$/,
  /^theme\.background$/,
];

export type EmptyStateWrapperFinding = {
  file: string;
  /** 1-indexed line of the `<EmptyState` usage. */
  line: number;
  /** The offending backgroundColor value, verbatim. */
  background: string;
  /** Where the background came from, e.g. `styles.selfHint` or "inline". */
  source: string;
};

/** Extract the balanced `{...}` object that starts at `openBrace`. */
function balancedBraces(text: string, openBrace: number): string | null {
  let depth = 0;
  for (let i = openBrace; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openBrace, i + 1);
    }
  }
  return null;
}

/** Resolve a `styles.NAME` reference to its object body in this file. */
function resolveStyleEntry(source: string, name: string): string | null {
  const entry = new RegExp(`(?<=[{,]\\s*)${name}:\\s*\\{`).exec(source);
  if (!entry) return null;
  return balancedBraces(source, entry.index + entry[0].length - 1);
}

const BACKGROUND_RE = /backgroundColor:\s*([^,}\n]+)/g;

function backgroundsOf(objectBody: string): string[] {
  const found: string[] = [];
  for (const m of objectBody.matchAll(BACKGROUND_RE)) {
    found.push(m[1].trim());
  }
  return found;
}

function isAllowed(value: string): boolean {
  return ALLOWED_WRAPPER_BACKGROUNDS.some((rule) => rule.test(value));
}

/**
 * Track `<View>` nesting up to `index` and return the style attributes of
 * every View still open at that point (outermost first). Self-closing
 * `<View ... />` tags never enclose anything and are skipped.
 */
function openViewStylesAt(source: string, index: number): string[] {
  const stack: string[] = [];
  const tag = /<View\b([^>]*?)(\/?)>|<\/View>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(source)) && m.index < index) {
    if (m[0] === "</View>") stack.pop();
    else if (m[2] !== "/") stack.push(m[1] ?? "");
  }
  return stack;
}

/**
 * Scan one source string for `<EmptyState` usages wrapped in a
 * custom-colored `<View>`. Comments are stripped first so prose mentioning
 * the pattern (like this doc block) never trips the scan.
 */
export function findEmptyStateWrapperOverrides(
  file: string,
  rawSource: string,
): EmptyStateWrapperFinding[] {
  const source = stripComments(rawSource);
  const findings: EmptyStateWrapperFinding[] = [];
  const usage = /<EmptyState\b/g;
  let m: RegExpExecArray | null;
  while ((m = usage.exec(source))) {
    const line = source.slice(0, m.index).split("\n").length;
    for (const attrs of openViewStylesAt(source, m.index)) {
      const styleAttr = /style=\{/.exec(attrs);
      if (!styleAttr) continue;
      const styleBody =
        balancedBraces(attrs, styleAttr.index + styleAttr[0].length - 1) ?? "";

      for (const bg of backgroundsOf(styleBody)) {
        if (!isAllowed(bg)) {
          findings.push({ file, line, background: bg, source: "inline" });
        }
      }
      for (const ref of styleBody.matchAll(/styles\.(\w+)/g)) {
        const body = resolveStyleEntry(source, ref[1]);
        if (!body) continue;
        for (const bg of backgroundsOf(body)) {
          if (!isAllowed(bg)) {
            findings.push({
              file,
              line,
              background: bg,
              source: `styles.${ref[1]}`,
            });
          }
        }
      }
    }
  }
  return findings;
}

/** Human-readable report, one line per finding. */
export function formatEmptyStateWrapperReport(
  findings: EmptyStateWrapperFinding[],
): string {
  return findings
    .map(
      (f) =>
        `${f.file}:${f.line} — <EmptyState> is wrapped in a View whose ` +
        `${f.source} sets backgroundColor: ${f.background}; the layered ` +
        `cream card goes cream-on-cream. Use a PAGE_BG_* token or drop ` +
        `the override.`,
    )
    .join("\n");
}
