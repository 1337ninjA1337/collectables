import { balancedThrough } from "@/lib/balanced-source";
import { walkJsx } from "@/lib/jsx-open-tag";
import { stripComments } from "@/lib/strip-comments";

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

/** Resolve a `styles.NAME` reference to its object body in this file. */
function resolveStyleEntry(source: string, name: string): string | null {
  const entry = new RegExp(`(?<=[{,]\\s*)${name}:\\s*\\{`).exec(source);
  if (!entry) return null;
  // Through the braces, not between them: `backgroundsOf` reads an object
  // BODY. Quote-aware since this went through the shared reader — the copy
  // it replaced counted a `"}"` inside a string literal as a closer, which
  // ended the entry early and hid every declaration after it.
  return balancedThrough(source, entry.index + entry[0].length - 1, "{", "}");
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
 * What every `<EmptyState>` in a source inherits: the style attributes of the
 * `<View>`s still open above it, outermost first.
 *
 * This was `openViewStylesAt`, a `/<View\b([^>]*?)(\/?)>|<\/View>/` scan with
 * the bug `lib/jsx-open-tag.ts` exists for and `lint:jsx-walk` refuses:
 * `[^>]*?` ends the opening tag at the first `>`, which in a wrapper carrying
 * `style={{ padding: wide ? 24 : 12 }}` is fine and in one carrying
 * `onLayout={() => measure()}` is the one inside the arrow. The attributes
 * pushed onto the stack were then a fragment — a `backgroundColor` after that
 * point was invisible, so the guard reported a clean tree — and the unmatched
 * `>` left behind desynchronised the open/close pairing for everything after
 * it in the file.
 *
 * `walkJsx` also reaches a `<View>` rendered through a render prop, which the
 * forward scan stepped over along with everything inside it.
 */
const VIEW_STACK = {
  seed: [] as readonly string[],
  inherit: (tag: { name: string; attrs: string; selfClosing: boolean }, open: readonly string[]) =>
    tag.name === "View" && !tag.selfClosing ? [...open, tag.attrs] : open,
};

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
  for (const tag of walkJsx(source, VIEW_STACK)) {
    if (tag.name !== "EmptyState") continue;
    const line = source.slice(0, tag.start).split("\n").length;
    for (const attrs of tag.inherited) {
      const styleAttr = /style=\{/.exec(attrs);
      if (!styleAttr) continue;
      const styleBody =
        balancedThrough(attrs, styleAttr.index + styleAttr[0].length - 1, "{", "}") ?? "";

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
