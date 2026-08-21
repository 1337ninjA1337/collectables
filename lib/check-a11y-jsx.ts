import { closeTagIndex, openTagEnd } from "@/lib/jsx-open-tag";
import { stripComments } from "@/lib/strip-comments";

/**
 * Accessibility problems a text scan can see, behind `scripts/check-a11y-jsx.ts`
 * (`npm run lint:a11y-jsx`).
 *
 * Named for what it reads rather than for its first rule. It shipped as
 * `check-a11y-icon-labels` with one rule about icon buttons and grew three
 * more the same day — untranslated labels, one-sided hiding, and icons nobody
 * decided about — of which two are not about labels and one is not about icons
 * either. The rename cost an entry in six places, every one of them checked by
 * a suite, and it happened when the name stopped describing the file rather
 * than when a fifth rule made it embarrassing.
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
 * The fourth is the one this file could not carry until the tree earned it.
 * A sweep on 2026-08-20 found 36 of this tree's 44 `<Ionicons>` carrying
 * neither a hide nor a label — nobody had decided whether they were decoration
 * or content, and every screen reader announced whatever the glyph font
 * resolved to. That is not a rule you can add while it has 36 findings: it
 * gets floored at 36 and stops meaning anything. It is a rule you can add the
 * day the count reaches zero, which the sweep did, so `undecided_icon` now
 * says every icon is hidden or named and the tree is the proof it passes.
 *
 * Hiding is INHERITED, which is why the walk keeps a stack rather than
 * scanning tags flat: `item-card.tsx`'s photo-count badge is a glyph AND a
 * bare number, and it is hidden as a subtree so the two go together. A rule
 * that only read each tag's own props would report both of those icons and
 * demand redundant props on them. Android is the platform that makes this
 * more than a detail — `importantForAccessibility="no"` hides the node and
 * leaves its children announced, and only `"no-hide-descendants"` takes the
 * subtree.
 *
 * Why a hand-written tag scanner and not a regex: the obvious
 * `/<Pressable([\s\S]*?)>/` ends the open tag at the first `>` in the file,
 * which on this codebase is usually the one inside `onPress={() => x}`. It
 * reported ten offenders on the tree the careful version reports three for —
 * seven false positives, every one of them a button that DID carry a label,
 * in attribute text the regex never reached. The walk that gets this right
 * now lives in `lib/jsx-open-tag.ts`, because it stopped being this guard's
 * private business the moment a suite reimplemented it and left out the
 * string-literal half. What stays here is the tag STACK below: tracking
 * ancestors so a node inside a hidden subtree is not asked for props of its
 * own is a rule about this guard's domain, not a primitive.
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
   *
   * Not reported inside a subtree an ancestor already hides: hiding a parent
   * hides what is under it, so a child in there needs nothing and a rule that
   * demanded props of it would be asking for the redundant.
   */
  | "half_hidden"
  /**
   * An `<Ionicons>` that is neither hidden nor named — nobody has decided
   * whether it is decoration or content, so it is announced as whatever the
   * glyph font resolves to. This rule could not be written until a sweep on
   * 2026-08-20 decided all 44 of them: a guard whose first run reports 36
   * findings is a guard somebody floors at 36.
   *
   * "Hidden" counts an ancestor, because that is how the two icons in
   * `item-card.tsx`'s photo-count badge are hidden — the badge is a glyph AND
   * a bare number, and hiding it as a subtree is what keeps the two together.
   *
   * "Named" is an `accessibilityLabel` on the icon itself. It deliberately
   * does NOT count a label on an ancestor `<Pressable>`: on iOS that label
   * REPLACES the subtree, so the icon is silent there and announced on the
   * web, which is the split this guard exists to catch. Hiding it says the
   * same thing on all three platforms.
   */
  | "undecided_icon"
  /**
   * A `<Pressable>` that takes `disabled` and does not say so. Greyed-out is
   * a colour, and a colour reaches nobody: without
   * `accessibilityState={{ disabled }}` a screen reader offers the button as
   * though pressing it would do something. A sweep on 2026-08-20 found 29 of
   * this tree's 33, including both of the photo lightbox's chevrons at the
   * first and last photo.
   *
   * `<Pressable>` only, for the same reason the icon rule looks for
   * `<Ionicons>`: a custom component may forward `disabled` to a Pressable
   * that announces it correctly, which is what `<DangerSection>` does, and a
   * rule that could not see that would be wrong about it.
   *
   * `accessibilityState` has to NAME disabled, not merely exist — a tab
   * carrying `{{ selected }}` beside a `disabled` prop is exactly as silent
   * as one carrying nothing.
   */
  | "silent_disabled"
  /**
   * An interactive `<Pressable>` — one with an `onPress` — that declares no
   * `accessibilityRole`. Neither React Native's `<Pressable>` nor
   * react-native-web's sets a default, so it announces as a generic element:
   * a screen reader user is told there is text there, not that it can be
   * pressed. A sweep on 2026-08-20 found 152 of this tree's 194 in that state
   * and closed the gap over five slices before this rule could go in.
   *
   * `onPress` is the interactive test, because a `<Pressable>` without one is
   * a layout wrapper. `accessibilityRole="none"` is a role, and a deliberate
   * one — a modal backdrop opts out with it — so "declares no role" is the
   * bar, not "declares a role that does something".
   */
  | "no_role";

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
  no_role:
    "an interactive <Pressable> with no accessibilityRole — a screen reader announces it as generic text rather than as something that can be pressed; add accessibilityRole=\"button\" (or the right role, or \"none\" for a backdrop that only dismisses)",
  silent_disabled:
    "a <Pressable> that takes `disabled` without accessibilityState={{ disabled }} — greyed-out is a colour, so a screen reader offers the button as though pressing it would do something",
  undecided_icon:
    "an <Ionicons> that is neither hidden nor named — every icon in this tree is one or the other, so decide: hide it on all three platforms if it is decoration, or give it an accessibilityLabel if it is content",
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
  /**
   * True when some ANCESTOR of this tag hides its whole subtree on all three
   * platforms. Such a node is already unreachable, so it needs no props of its
   * own and asking for them would be asking for the redundant.
   */
  readonly coveredByAncestor: boolean;
};

/**
 * Every JSX opening tag in a stripped source, in order.
 *
 * One walk for both rules: the label rules care only about `<Pressable>` and
 * the paired-hiding rule applies to every element, and running two scanners
 * over one file would be two chances to disagree about where a tag ends —
 * which is the thing that was hard to get right here.
 *
 * `<` followed by a letter is the whole tag test. A bare `<` in an expression
 * (`a < b`) is followed by a space in every formatting this repository uses,
 * and a fragment `<>` has no name. A `<` that turns out not to open a tag
 * costs a fruitless brace walk and no finding, because every rule below
 * requires a named attribute.
 *
 * Closing tags are read too, for one reason: hiding is INHERITED. A node
 * inside a subtree its parent hides is already unreachable, so the rules have
 * to know where that parent's subtree ends, and that means a stack rather
 * than a flat scan. `</>` closes a fragment and matches no name, so it is
 * skipped along with the `<>` that opened it — a fragment cannot carry props
 * and so can never be the ancestor that hides anything.
 *
 * An unmatched close tag pops down to its name if the name is open, and is
 * ignored otherwise. Both are the forgiving choice: this scanner reads files
 * mid-edit, and a stack that threw would turn a lint run into a crash.
 */
function* openTags(code: string): Generator<OpenTag> {
  /** Open ancestors, innermost last; `covered` is inherited then widened. */
  const stack: { name: string; covered: boolean }[] = [];
  let cursor = 0;
  while (cursor < code.length) {
    const start = code.indexOf("<", cursor);
    if (start === -1) return;
    const closeMatch = /^<\/([A-Za-z][A-Za-z0-9_.]*)\s*>/.exec(code.slice(start));
    if (closeMatch) {
      const depth = stack.map((f) => f.name).lastIndexOf(closeMatch[1]);
      if (depth !== -1) stack.length = depth;
      cursor = start + closeMatch[0].length;
      continue;
    }
    const nameMatch = /^<([A-Za-z][A-Za-z0-9_.]*)/.exec(code.slice(start));
    if (!nameMatch) {
      cursor = start + 1;
      continue;
    }
    const attrsAt = start + nameMatch[0].length;
    const tagEnd = openTagEnd(code, attrsAt);
    if (tagEnd === -1) return;
    cursor = tagEnd + 1;
    const attrs = code.slice(attrsAt, tagEnd);
    const selfClosing = code[tagEnd - 1] === "/";
    const coveredByAncestor = stack.length > 0 && stack[stack.length - 1].covered;
    yield {
      name: nameMatch[1],
      attrs,
      start,
      attrsAt,
      tagEnd,
      selfClosing,
      coveredByAncestor,
    };
    if (!selfClosing) {
      stack.push({
        name: nameMatch[1],
        covered: coveredByAncestor || hidesSubtree(attrs),
      });
    }
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
 * The same instruction, in the form that reaches DESCENDANTS.
 *
 * Two of the three already do: `accessibilityElementsHidden` removes an iOS
 * subtree and `aria-hidden` removes a DOM one. Android is the exception and
 * the reason this table is not just the one above — `importantForAccessibility
 * ="no"` hides the node and leaves its children announced, and only
 * `"no-hide-descendants"` takes the subtree with it.
 *
 * Used for one question: is this tag already unreachable because of something
 * above it? A node inside such a subtree needs no props of its own.
 */
const HIDES_SUBTREE_BY: Record<HidePlatform, RegExp> = {
  ios: HIDDEN_BY.ios,
  android: /importantForAccessibility\s*=\s*"no-hide-descendants"/,
  web: HIDDEN_BY.web,
};

/** An `onPress` prop — what separates an interactive Pressable from a layout wrapper. */
const IS_INTERACTIVE = /\sonPress\s*=/;

/** Any `accessibilityRole`, including `"none"`, which is a deliberate opt-out. */
const HAS_ROLE = /accessibilityRole\s*=/;

/** A `disabled` prop with a value — `disabledFoo` is a different attribute. */
const TAKES_DISABLED = /\sdisabled\s*=/;

/** An `accessibilityState` that names `disabled`, not merely one that exists. */
const ANNOUNCES_DISABLED = /accessibilityState\s*=\s*\{\{[^}]*\bdisabled\b/;

/** True when these attributes hide the tag AND everything under it, everywhere. */
function hidesSubtree(attrs: string): boolean {
  return HIDE_PLATFORMS.every((platform) => HIDES_SUBTREE_BY[platform].test(attrs));
}

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
    // Everything between is a hide that stops at a platform boundary — unless
    // an ancestor already took the whole subtree, in which case this node is
    // unreachable however many props it happens to carry.
    if (!tag.coveredByAncestor && missing.length > 0 && missing.length < HIDE_PLATFORMS.length) {
      findings.push({
        file,
        line: at(start),
        code: "half_hidden",
        snippet: snippetAt(start),
        missing,
      });
    }
    // Every icon in this tree is hidden or named. One that is neither has not
    // been decided about, and it is announced as whatever the glyph resolves
    // to until somebody does.
    if (
      `<${tag.name}` === ICON_ELEMENT &&
      !tag.coveredByAncestor &&
      missing.length > 0 &&
      !attrs.includes("accessibilityLabel")
    ) {
      findings.push({ file, line: at(start), code: "undecided_icon", snippet: snippetAt(start) });
    }
    // Greyed-out is a colour and a colour reaches nobody.
    if (tag.name === TAG && TAKES_DISABLED.test(attrs) && !ANNOUNCES_DISABLED.test(attrs)) {
      findings.push({ file, line: at(start), code: "silent_disabled", snippet: snippetAt(start) });
    }
    // A tappable that never says it is a button.
    if (tag.name === TAG && IS_INTERACTIVE.test(attrs) && !HAS_ROLE.test(attrs)) {
      findings.push({ file, line: at(start), code: "no_role", snippet: snippetAt(start) });
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
    "Every tappable element needs a name a screen reader can speak, it has to be a t() call, a node hidden from one platform has to be hidden from all three, every icon has to be hidden or named, a disabled button has to say so, and an interactive one has to declare its role — see lib/check-a11y-jsx.ts.",
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
