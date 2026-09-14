/**
 * A fourth hand-rolled walk over JSX text, refused.
 *
 * WHAT HAPPENED, three times in one day. `lib/jsx-open-tag.ts` exists because
 * the same twenty lines — find a tag, find where its open tag ends, find its
 * close — were written out in the a11y guard, in a sheet-semantics suite, and
 * in a heading sweep. Two of those copies carried the SAME bug (a render
 * prop's JSX lives inside the parent's open tag, so both walks stepped over
 * everything a component renders through a prop) and were fixed an hour apart.
 * The third was merged the same afternoon.
 *
 * What stopped a fourth copy after that was a paragraph in a module header.
 * A paragraph is not a rule: the next sweep that wants "the `<HeroBanner>` in
 * this file" reaches for `match(/<HeroBanner[\s\S]*?>/)` because it is one
 * line and it works on today's tree, and nobody reads a header they have no
 * reason to open. This guard is the rule, and it found NINE more copies on
 * the day it was written, in seven files — every one of them in a suite, every
 * one of them green, and two of them carrying a live reach bug.
 *
 * THREE SHAPES, because there are three ways to fake the walk.
 *
 * `open-tag-regex` — a regex literal that opens on a component tag and then
 * runs a wildcard to the first `>`: `[^>]*>`, `[\s\S]*?>`, `.*?>`. This is the
 * exact failure `lib/jsx-open-tag.ts`'s header opens with. Every interesting
 * attribute in this codebase is an expression containing a `>` — `onPress={()
 * => close()}` is the common one — so the match ends INSIDE the tag, and every
 * assertion made about the text it returned is an assertion about the first
 * two props. On the a11y sweep that produced seven false positives, each one a
 * button that did carry a label, in attribute text the regex never reached.
 *
 * `open-tag-loop` — the walk written out as a character loop instead of as a
 * regex: `char === ">" && depth === 0` is the whole of `openTagEnd`, and two
 * files had it. One was `lib/check-clarity-input-mask.ts`, a SHIPPING guard,
 * whose copy counted braces and did not skip string literals — which is the
 * exact half the header of `lib/jsx-open-tag.ts` records an earlier copy
 * leaving out, reproduced independently months later. The other was a suite
 * that had reimplemented `openTagsNamed` around it, string skipping included
 * but without the backslash escapes.
 *
 * A depth counter over `(`, `[` and `{` is NOT this rule — `declared-shape`
 * and `check-platform-pairs` both count brackets in TypeScript type text,
 * which has nothing to do with JSX — so the rule is the pair: a `>` test AND
 * an immediately following depth-is-zero test, which together mean "this is
 * where the opening tag ends".
 *
 * `close-tag-search` — locating an element's end with a raw text search for
 * `"</Component>"`. `indexOf` takes the FIRST close tag, which belongs to the
 * innermost element of that name, not to the one being asked about: a row of
 * buttons inside a pressable card hands the parent's body to the child.
 * `closeTagIndex` counts depth and is the same one line at the call site.
 *
 * WHY UPPERCASE ONLY. A tag name that starts with a capital is a React
 * component, which is the JSX this rule is about; a lowercase one is HTML, and
 * this repository genuinely parses HTML in three places that have nothing to
 * do with the app's markup — `lib/bundle-smoke.ts` reads the `<h1>` out of the
 * built page, `lib/web-security-headers.ts` finds `<head>` to inject into, and
 * a suite checks the `</head>` position in the SPA fallback. Those are text
 * scans over generated output where `jsx-open-tag`'s premises (brace
 * expressions, render props, component nesting) do not hold. The case split is
 * the JSX naming convention itself rather than an exemption list, so nothing
 * has to be maintained as those three files change.
 *
 * COMMENTS ARE BLANKED FIRST. Both rules match text that a doc comment about
 * the rules would contain — the paragraphs above are full of it, and so is the
 * header of `lib/jsx-open-tag.ts`, which quotes the regex that motivated it.
 * `stripComments` preserves offsets, so the reported line is still the real
 * one. String literals are deliberately NOT blanked: `indexOf("</Modal>")`
 * hides its whole offence inside one.
 *
 * Measured against this tree at 966 files: nine findings on the first run,
 * forty once the anchored form below was added, and forty-two once the loop
 * rule was — every one of them migrated in the commit that found it, zero
 * since.
 */

import { annotation } from "./github-annotations";
import { stripComments } from "./strip-comments";

/** The module every one of these shapes belongs in. */
export const JSX_WALK_OWNER = "lib/jsx-open-tag.ts";

/** Which of the three fakes a finding is. */
export type JsxWalkRule = "open-tag-regex" | "open-tag-loop" | "close-tag-search";

/** One hand-rolled JSX scan. */
export interface JsxWalkFinding {
  /** Repo-relative path of the file. */
  readonly file: string;
  /** 1-indexed line number. */
  readonly line: number;
  /** 1-indexed column of the offending text. */
  readonly column: number;
  /** Which shape was matched. */
  readonly rule: JsxWalkRule;
  /** The matched text, trimmed to something a report can print. */
  readonly text: string;
  /** The component name the scan was reaching for. */
  readonly tag: string;
}

/** Longest fragment a report will quote before it stops helping. */
export const MATCH_LIMIT = 72;

/**
 * A regex literal that opens on a component tag and wildcards to a `>`.
 *
 * The `[^\n]{0,160}?` between the name and the wildcard is what lets the
 * middle of `/<Link\b[^>]*\basChild\b[^>]*>/` pass under it; lazy, so the
 * first wildcard-to-`>` in the literal is the one reported. Bounded to one
 * line because a regex literal cannot span one, which also stops the scan
 * from pairing a `<Foo` in one place with a `[^>]*>` several lines away.
 *
 * THE SECOND BOUND, and why the rule shipped without it. It matched a
 * wildcard IMMEDIATELY followed by `>`, and thirty-one call sites reached the
 * `>` through a couple of anchoring characters instead:
 * `/<FlatList[\s\S]*?windowSize=\{5\}[\s\S]*?\/>/` and
 * `/<Pressable[\s\S]*?\n {6}>/` are the two commonest shapes here, and they
 * are the same walk — the second one finds the element's end by its
 * INDENTATION. So a short lazy tail is allowed between the wildcard and the
 * `>`, which is what turned a green first run into nine findings and then
 * into forty.
 *
 * TWO THINGS THE WIDENING HAD TO EXCLUDE, both found by running it.
 *
 * A TYPE ARGUMENT is not a tag: `flushPendingQueue<ChatMessage>(pending, {…})`
 * is TypeScript, and the only thing separating it from JSX in text is what
 * comes BEFORE the `<` — an identifier character, which no JSX tag has. Hence
 * the lookbehind.
 *
 * A TAG SPELLED OUT IN FULL is not a tag this rule is about:
 * `/<I18nProvider>[\s\S]*?<DiagnosticsProvider>/` is a nesting assertion, and
 * its author already knows where that opening tag ends because they wrote its
 * `>`. The hazard here is a wildcard used to FIND the end of an open tag, so a
 * name followed directly by `>` is outside it. Tested in code below rather
 * than as a `(?!>)` here: a lookahead lets the name group backtrack, and this
 * one duly reported `<I18nProvide>` — the name a character short, matched
 * against a rule the full name had just failed.
 */
const OPEN_TAG_REGEX =
  /(?<![\w$])<([A-Z][A-Za-z0-9_.]*)[^\n]{0,160}?(?:\[\^>\]\*|\[\\s\\S\]\*\??|\.\*\??)[^\n]{0,40}?\/?>/g;

/**
 * `openTagEnd`'s body, written out: a `>` test AND a depth-is-zero test.
 *
 * The pair is the rule. A loop comparing a character against `">"` alone is
 * ordinary text handling, and a depth counter alone is how this repository
 * reads TypeScript type text in two places; together they are the sentence
 * "the opening tag ends here", which belongs in one module.
 *
 * The depth test has to come RIGHT after the `&&`, which is what keeps
 * `check-platform-pairs`'s `char === ">" && code[i - 1] !== "="` out: that one
 * is about a generic's closing bracket, not a tag's.
 */
const OPEN_TAG_LOOP = /===\s*">"\s*&&\s*[A-Za-z_$][\w$]*\s*===\s*0/g;

/**
 * A component close tag handed to a string search.
 *
 * The method list is what a scan actually reaches for. `split` is in it
 * because `code.split("</Modal>")[0]` is the same first-close-wins answer
 * written as a slice, and a rule that named only `indexOf` would teach the
 * next copy to use it.
 */
const CLOSE_TAG_SEARCH =
  /\.(?:indexOf|lastIndexOf|includes|search|split)\(\s*(["'`])<\/([A-Z][A-Za-z0-9_.]*)>\1/g;

/**
 * The same, built by interpolation: ``code.indexOf(`</${tag}>`)``.
 *
 * A separate pattern rather than an alternative inside the one above, because
 * there is no component name to report — the tag is a variable — and a finding
 * that printed the source text of the interpolation as its `tag` would read as
 * a component called `${tag}`.
 */
const CLOSE_TAG_INTERPOLATED =
  /\.(?:indexOf|lastIndexOf|includes|search|split)\(\s*`<\/\$\{/g;

/** 1-indexed line and column of an offset, by counting the breaks before it. */
function lineColumn(source: string, at: number): { line: number; column: number } {
  const before = source.slice(0, at);
  const lastBreak = before.lastIndexOf("\n");
  return { line: before.split("\n").length, column: at - lastBreak };
}

/** Quote a match without letting one long line fill the report. */
function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MATCH_LIMIT ? `${flat.slice(0, MATCH_LIMIT)}…` : flat;
}

/**
 * Every hand-rolled JSX scan in one file.
 *
 * `file` is carried rather than derived so a caller scanning a fixture string
 * can name it whatever the report should say.
 */
export function findJsxWalks(file: string, source: string): JsxWalkFinding[] {
  // The owner is where all of this is supposed to live, so its own
  // implementation is not a finding. Checked by path rather than by an
  // exemption list of one, because the list would be the thing that grows.
  if (file === JSX_WALK_OWNER) return [];

  const code = stripComments(source);
  const found: JsxWalkFinding[] = [];

  for (const match of code.matchAll(OPEN_TAG_REGEX)) {
    // The author wrote the tag's own `>`, so no wildcard is being used to find
    // where the opening tag ends — see the second exclusion above.
    if (match[0].startsWith(`<${match[1]}>`)) continue;
    const { line, column } = lineColumn(code, match.index ?? 0);
    found.push({
      file,
      line,
      column,
      rule: "open-tag-regex",
      text: quote(match[0]),
      tag: match[1],
    });
  }
  for (const match of code.matchAll(OPEN_TAG_LOOP)) {
    const { line, column } = lineColumn(code, match.index ?? 0);
    found.push({
      file,
      line,
      column,
      rule: "open-tag-loop",
      text: quote(match[0]),
      // There is no element name in a loop: it ends whatever tag the cursor is
      // inside. Reported as the thing it is rather than as a guessed name.
      tag: "(any tag)",
    });
  }
  for (const match of code.matchAll(CLOSE_TAG_SEARCH)) {
    const { line, column } = lineColumn(code, match.index ?? 0);
    found.push({
      file,
      line,
      column,
      rule: "close-tag-search",
      text: quote(match[0]),
      tag: match[2],
    });
  }
  for (const match of code.matchAll(CLOSE_TAG_INTERPOLATED)) {
    const { line, column } = lineColumn(code, match.index ?? 0);
    found.push({
      file,
      line,
      column,
      rule: "close-tag-search",
      text: quote(match[0]),
      tag: "(interpolated)",
    });
  }

  found.sort((a, b) => a.line - b.line || a.column - b.column);
  return found;
}

/**
 * What to do instead, per rule.
 *
 * One sentence each, naming the function rather than the module: a reader who
 * has just been told their line is banned wants the replacement, and "see
 * lib/jsx-open-tag.ts" is a second search.
 */
export const JSX_WALK_ADVICE: Readonly<Record<JsxWalkRule, string>> = {
  "open-tag-regex":
    `a wildcard run to the first ">" ends the match inside the tag, because every interesting attribute here is an expression containing one (\`onPress={() => close()}\`) — use walkJsx or openTagAt from ${JSX_WALK_OWNER}, which count brace depth and skip string literals`,
  "open-tag-loop":
    `this is openTagEnd's body — a ">" at brace depth zero ends the opening tag — and a copy of it is where the string-literal skipping gets left out, so a quoted ">" in an attribute ends the tag early and silently; call openTagEnd, walkJsx or tagsNamed from ${JSX_WALK_OWNER} instead`,
  "close-tag-search":
    `the first "</Tag>" belongs to the innermost element of that name, not to the one being asked about — use closeTagIndex from ${JSX_WALK_OWNER}, which counts depth`,
};

/** Human-readable report, or `""` when there is nothing to say. */
export function formatJsxWalkReport(found: readonly JsxWalkFinding[]): string {
  if (found.length === 0) return "";
  const lines = [
    `Found ${found.length} hand-rolled JSX scan(s) outside ${JSX_WALK_OWNER}.`,
    "Three copies of this walk were merged into that module on 2026-09-13; two of them carried the same bug. A fourth copy is how that bug comes back.",
  ];
  const byFile = new Map<string, JsxWalkFinding[]>();
  for (const entry of found) {
    const list = byFile.get(entry.file) ?? [];
    list.push(entry);
    byFile.set(entry.file, list);
  }
  for (const [file, list] of byFile) {
    lines.push("", `  ${file}`);
    for (const entry of list) {
      lines.push(`    ${entry.line}:${entry.column}  ${entry.rule} <${entry.tag}>: ${entry.text}`);
      lines.push(`      ${JSX_WALK_ADVICE[entry.rule]}`);
    }
  }
  return lines.join("\n");
}

/** One `::error` per finding, so CI puts it on the line of the PR diff. */
export function jsxWalkAnnotations(found: readonly JsxWalkFinding[]): string[] {
  return found.map((entry) =>
    annotation("error", `Hand-rolled JSX scan for <${entry.tag}> — ${JSX_WALK_ADVICE[entry.rule]}`, {
      file: entry.file,
      line: entry.line,
      col: entry.column,
    }),
  );
}
