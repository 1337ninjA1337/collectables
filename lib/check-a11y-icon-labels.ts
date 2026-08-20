import { stripComments } from "@/lib/strip-comments";

/**
 * Icon-button accessibility scanner behind `scripts/check-a11y-icon-labels.ts`
 * (`npm run lint:a11y-icon-labels`).
 *
 * A `<Pressable>` whose only child is an icon has no text for an assistive
 * technology to read, so without an `accessibilityLabel` it is announced as
 * "button" and nothing else. That is invisible in every other check this
 * repository runs: it renders, it is tappable, it looks right in a screenshot,
 * and it passes any test that asserts the icon is on screen. A sweep on
 * 2026-08-20 found three, and the expensive one was the bottom navigation bar
 * — six tabs, six identical unnamed buttons, on the surface a non-visual user
 * meets first.
 *
 * The second rule is the bug the same sweep turned up next door:
 * `<CurrencyInput>`'s chip HAD a label, written in English, for all six
 * languages. A rule that only asks whether a label is present passes that
 * happily, which is why a bare string literal is its own finding.
 *
 * Why a hand-written tag scanner and not a regex: the obvious
 * `/<Pressable([\s\S]*?)>/` ends the open tag at the first `>` in the file,
 * which on this codebase is usually the one inside `onPress={() => x}`. It
 * reported ten offenders on the tree the careful version reports three for —
 * seven false positives, every one of them a button that DID carry a label,
 * in attribute text the regex never reached. So the open tag is walked with a
 * brace counter and string-literal skipping, and the close tag is matched with
 * a depth counter so a nested `<Pressable>` does not end its parent.
 *
 * What it deliberately does NOT do: understand components. A button whose
 * child is `<MyIcon />` or `{renderIcon()}` is invisible here, and a button
 * labelled through a wrapper it cannot see would be a false positive if it
 * tried. The rule is about the shape this codebase actually writes —
 * `<Ionicons>` inside a bare `<Pressable>` — and the floor under the walk is
 * what says the scan looked at anything at all.
 *
 * Pure module: no filesystem access. The CLI walks and hands sources over, so
 * the matcher is unit-testable under `tsx --test`. Comments are blanked
 * through the shared {@link stripComments}, which preserves offsets, so a doc
 * block like this one can show the forbidden shape without tripping the scan
 * and a reported line number is still the real one.
 */

/** The element that makes a `<Pressable>` an icon button for this rule. */
export const ICON_ELEMENT = "<Ionicons";

/** The element whose presence means the button has readable text already. */
export const TEXT_ELEMENT = "<Text";

export type IconLabelCode =
  /** An icon-only button with no `accessibilityLabel` at all. */
  | "unlabeled"
  /**
   * A label written as a bare string literal, so it is one language for all
   * six. Checked on EVERY `<Pressable>`, not just icon-only ones: the label is
   * the string a screen reader speaks, and a button with visible text can
   * still carry an English-only spoken one.
   */
  | "untranslated";

export type IconLabelFinding = {
  readonly file: string;
  readonly line: number;
  readonly code: IconLabelCode;
  /** The offending source line, trimmed, for the report. */
  readonly snippet: string;
};

/** Exhaustive over {@link IconLabelCode} — a new code needs a sentence. */
const FINDING_DETAIL: Record<IconLabelCode, string> = {
  unlabeled:
    "an icon-only Pressable with no accessibilityLabel — a screen reader announces it as \"button\" and nothing else",
  untranslated:
    "an accessibilityLabel written as a bare string literal — it is spoken in that one language to speakers of all six",
};

/** The sentence this scan gives one finding code. */
export function describeIconLabelFinding(code: IconLabelCode): string {
  return FINDING_DETAIL[code];
}

/**
 * Walk from just after an opening tag name to the `>` that closes it.
 *
 * Returns the index of that `>`, or -1 if the tag never closes. Brace depth
 * matters because every interesting attribute in this codebase is an
 * expression containing at least one `>`; string and template literals are
 * skipped whole so a `">"` inside one cannot end the tag either.
 */
function openTagEnd(source: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipStringLiteral(source, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
    i++;
  }
  return -1;
}

/** Index just past the closing quote of the literal starting at `i`. */
function skipStringLiteral(source: string, i: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === "\\") {
      j += 2;
      continue;
    }
    if (source[j] === quote) return j + 1;
    j++;
  }
  return source.length;
}

/**
 * Index of the `</Pressable>` matching an open tag that ended at `from`.
 *
 * Depth-counted: a row of buttons inside a pressable card is the ordinary case
 * here, and a scanner that took the first close tag would hand the parent's
 * body to the child and report the card as icon-only.
 */
function closeTagIndex(source: string, from: number, tag: string): number {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let depth = 1;
  let i = from;
  while (i < source.length) {
    const nextOpen = source.indexOf(open, i);
    const nextClose = source.indexOf(close, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + open.length;
      continue;
    }
    depth--;
    if (depth === 0) return nextClose;
    i = nextClose + close.length;
  }
  return -1;
}

const TAG = "Pressable";

/**
 * Scan one source string for icon buttons a screen reader could not name.
 *
 * Findings come back in source order, which is the order somebody fixing them
 * reads the file in.
 */
export function findUnlabeledIconButtons(file: string, source: string): IconLabelFinding[] {
  const findings: IconLabelFinding[] = [];
  const code = stripComments(source);
  const open = `<${TAG}`;
  let cursor = 0;
  while (true) {
    const start = code.indexOf(open, cursor);
    if (start === -1) break;
    const afterName = start + open.length;
    // `<PressableRow` is a different component; only a boundary character ends
    // the tag name.
    if (/[A-Za-z0-9_]/.test(code[afterName] ?? "")) {
      cursor = afterName;
      continue;
    }
    const tagEnd = openTagEnd(code, afterName);
    if (tagEnd === -1) break;
    cursor = tagEnd + 1;
    const attrs = code.slice(afterName, tagEnd);
    const selfClosing = code[tagEnd - 1] === "/";
    let body = "";
    if (!selfClosing) {
      const end = closeTagIndex(code, tagEnd + 1, TAG);
      body = end === -1 ? "" : code.slice(tagEnd + 1, end);
    }
    const at = (index: number): number => code.slice(0, index).split("\n").length;
    const snippetAt = (index: number): string => {
      const lineStart = source.lastIndexOf("\n", index) + 1;
      const lineEnd = source.indexOf("\n", index);
      return source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    };
    const literal = /accessibilityLabel\s*=\s*"/.exec(attrs);
    if (literal) {
      const index = afterName + literal.index;
      findings.push({ file, line: at(index), code: "untranslated", snippet: snippetAt(index) });
    } else if (
      !attrs.includes("accessibilityLabel") &&
      body.includes(ICON_ELEMENT) &&
      !body.includes(TEXT_ELEMENT)
    ) {
      findings.push({ file, line: at(start), code: "unlabeled", snippet: snippetAt(start) });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Format findings as the message a person acts on. Empty string when there is
 * nothing to report, so the caller can short-circuit.
 */
export function formatIconLabelReport(findings: readonly IconLabelFinding[]): string {
  if (findings.length === 0) return "";
  const lines = [
    `Found ${String(findings.length)} accessibility problem(s) on Pressables in app/** or components/**.`,
    "Every tappable element needs a name a screen reader can speak, and it has to be a t() call — see lib/check-a11y-icon-labels.ts.",
  ];
  for (const finding of findings) {
    lines.push("");
    lines.push(`  ${finding.file}:${String(finding.line)}  → ${describeIconLabelFinding(finding.code)}`);
    lines.push(`    ${finding.snippet}`);
  }
  return lines.join("\n");
}
