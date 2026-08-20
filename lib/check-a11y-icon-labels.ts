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
 * The third is about the opposite instruction — HIDING a decorative node —
 * and it is the one mistake here that a person cannot see on their own
 * machine. It takes THREE props, not two, because this app ships to three
 * platforms: `accessibilityElementsHidden` is iOS, `importantForAccessibility`
 * is Android, and `aria-hidden` is the web. React Native's `<View>` maps
 * `aria-hidden` onto the two native props for you, but `<Text>` does not — and
 * every decorative node in this tree is an `<Ionicons>`, which renders a
 * `<Text>` — so the web prop is an addition to the native pair here and not a
 * replacement for it. Shipping a subset is a fix that works on the platform
 * its author tested and silently does nothing on the others; before
 * 2026-08-20 all seven sites carried the native pair and none carried the web
 * prop, so the browser — this app's primary surface — announced every one of
 * them. This checks every element in both roots.
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
  | "untranslated"
  /**
   * An element hidden from assistive technology on SOME platforms. Hiding a
   * decorative node needs `accessibilityElementsHidden` (iOS),
   * `importantForAccessibility="no"` (Android) and `aria-hidden` (web)
   * together; any subset is a fix that works on the platform its author
   * tested and silently does nothing on the rest. Checked on every element,
   * not just Pressables — the seven sites in this tree are icons, views and
   * text.
   */
  | "half_hidden";

/** A platform whose accessibility tree has its own way of being told to skip a node. */
export type HidePlatform = "ios" | "android" | "web";

/**
 * The three platforms, in the order a finding lists them. Exported so a
 * caller — and the suite — can be exhaustive over the set rather than
 * repeating the three names.
 */
export const HIDE_PLATFORMS: readonly HidePlatform[] = ["ios", "android", "web"];

/** The prop each platform reads, for the sentence that tells somebody what to add. */
const HIDE_PROP: Record<HidePlatform, string> = {
  ios: "accessibilityElementsHidden",
  android: 'importantForAccessibility="no"',
  web: "aria-hidden",
};

export type IconLabelFinding = {
  readonly file: string;
  readonly line: number;
  readonly code: IconLabelCode;
  /** The offending source line, trimmed, for the report. */
  readonly snippet: string;
  /**
   * For `half_hidden` only: the platforms this node is still ANNOUNCED on,
   * in {@link HIDE_PLATFORMS} order. Never empty when present — a node hidden
   * everywhere is not a finding, and one hidden nowhere was never asking to
   * be hidden. Absent on the two label codes, which are platform-neutral.
   */
  readonly missing?: readonly HidePlatform[];
};

/** Exhaustive over {@link IconLabelCode} — a new code needs a sentence. */
const FINDING_DETAIL: Record<IconLabelCode, string> = {
  unlabeled:
    "an icon-only Pressable with no accessibilityLabel — a screen reader announces it as \"button\" and nothing else",
  untranslated:
    "an accessibilityLabel written as a bare string literal — it is spoken in that one language to speakers of all six",
  half_hidden:
    "hidden from assistive technology on some platforms only — accessibilityElementsHidden (iOS), importantForAccessibility=\"no\" (Android) and aria-hidden (web) have to travel together, or the node stays announced on whichever platform the author did not test",
};

/**
 * The sentence this scan gives one finding code.
 *
 * `missing` is the `half_hidden` extra: the generic sentence says the three
 * props travel together, and this says which of them this node is short of,
 * which is the difference between reading the rule and applying it.
 */
export function describeIconLabelFinding(
  code: IconLabelCode,
  missing?: readonly HidePlatform[],
): string {
  const said = FINDING_DETAIL[code];
  if (code !== "half_hidden" || missing === undefined || missing.length === 0) return said;
  const props = missing.map((p) => `${HIDE_PROP[p]} (${p})`).join(" + ");
  return `${said}; still announced on ${missing.join(", ")} — add ${props}`;
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

/** One JSX opening tag, as the scan sees it. */
type OpenTag = {
  readonly name: string;
  /** Everything between the tag name and its closing `>`. */
  readonly attrs: string;
  /** Offset of the `<`, and of the attribute text, in the stripped source. */
  readonly start: number;
  readonly attrsAt: number;
  /** Offset of the `>` that closed the open tag. */
  readonly tagEnd: number;
  readonly selfClosing: boolean;
};

/**
 * Every JSX opening tag in a stripped source, in order.
 *
 * One walk for both rules: the label rules care only about `<Pressable>` and
 * the paired-hiding rule applies to every element, and running two scanners
 * over one file would be two chances to disagree about where a tag ends —
 * which is the thing that was hard to get right here.
 *
 * `<` followed by a letter is the whole tag test. A closing tag starts `</`
 * and a fragment `<>`, so neither matches, and a bare `<` in an expression
 * (`a < b`) is followed by a space in every formatting this repository uses.
 * A `<` that turns out not to open a tag costs a fruitless brace walk and no
 * finding, because the rules below both require a named attribute.
 */
function* openTags(code: string): Generator<OpenTag> {
  let cursor = 0;
  while (cursor < code.length) {
    const start = code.indexOf("<", cursor);
    if (start === -1) return;
    const nameMatch = /^<([A-Za-z][A-Za-z0-9_.]*)/.exec(code.slice(start));
    if (!nameMatch) {
      cursor = start + 1;
      continue;
    }
    const attrsAt = start + nameMatch[0].length;
    const tagEnd = openTagEnd(code, attrsAt);
    if (tagEnd === -1) return;
    cursor = tagEnd + 1;
    yield {
      name: nameMatch[1],
      attrs: code.slice(attrsAt, tagEnd),
      start,
      attrsAt,
      tagEnd,
      selfClosing: code[tagEnd - 1] === "/",
    };
  }
}

/**
 * What each platform's "skip this node" instruction looks like in source.
 *
 * The pairing is on the INSTRUCTION rather than the prop name, which is why
 * these are not three name matches. `importantForAccessibility="yes"` is the
 * OPPOSITE instruction and wants no partners; `accessibilityElementsHidden=
 * {false}` and `aria-hidden={false}` are not hides either. A rule that
 * matched names would report all three as incomplete.
 */
const HIDDEN_BY: Record<HidePlatform, RegExp> = {
  ios: /accessibilityElementsHidden(?!\s*=\s*\{\s*false\s*\})/,
  android: /importantForAccessibility\s*=\s*"(no|no-hide-descendants)"/,
  /**
   * Web reads `aria-hidden`, which react-native-web forwards to the DOM
   * attribute of the same name. The lookbehind rejects a longer attribute
   * ENDING in it — `data-aria-hidden` would otherwise satisfy the rule by
   * containing it, and `\b` does not help because `-` is already a boundary.
   */
  web: /(?<![\w-])aria-hidden(?!\s*=\s*\{\s*false\s*\})/,
};

/**
 * Scan one source string for the accessibility problems this guard names.
 *
 * Findings come back in source order, which is the order somebody fixing them
 * reads the file in.
 */
export function findUnlabeledIconButtons(file: string, source: string): IconLabelFinding[] {
  const findings: IconLabelFinding[] = [];
  const code = stripComments(source);
  const at = (index: number): number => code.slice(0, index).split("\n").length;
  const snippetAt = (index: number): string => {
    const lineStart = source.lastIndexOf("\n", index) + 1;
    const lineEnd = source.indexOf("\n", index);
    return source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  };
  for (const tag of openTags(code)) {
    const { attrs, attrsAt, start } = tag;
    const missing = HIDE_PLATFORMS.filter((platform) => !HIDDEN_BY[platform].test(attrs));
    // A node hidden everywhere is done; one hidden nowhere never asked to be.
    // Everything between is a hide that stops at a platform boundary.
    if (missing.length > 0 && missing.length < HIDE_PLATFORMS.length) {
      findings.push({
        file,
        line: at(start),
        code: "half_hidden",
        snippet: snippetAt(start),
        missing,
      });
    }
    if (tag.name !== TAG) continue;
    let body = "";
    if (!tag.selfClosing) {
      const end = closeTagIndex(code, tag.tagEnd + 1, TAG);
      body = end === -1 ? "" : code.slice(tag.tagEnd + 1, end);
    }
    const literal = /accessibilityLabel\s*=\s*"/.exec(attrs);
    if (literal) {
      const index = attrsAt + literal.index;
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
    `Found ${String(findings.length)} accessibility problem(s) in app/** or components/**.`,
    "Every tappable element needs a name a screen reader can speak, it has to be a t() call, and a node hidden from one platform has to be hidden from all three — see lib/check-a11y-icon-labels.ts.",
  ];
  for (const finding of findings) {
    lines.push("");
    lines.push(
      `  ${finding.file}:${String(finding.line)}  → ${describeIconLabelFinding(finding.code, finding.missing)}`,
    );
    lines.push(`    ${finding.snippet}`);
  }
  return lines.join("\n");
}
