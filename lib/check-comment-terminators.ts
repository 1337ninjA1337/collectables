/**
 * Block comments that end inside their own body.
 *
 * WHAT HAPPENED. A doc comment in `scripts/record-loaded-files.ts` explained
 * that `tsconfig.json`'s `include` is the recursive glob for `.ts` files — and
 * wrote that glob out. A path glob of that shape ends in the two characters
 * that close a block comment, so the comment ended in the middle of an English
 * sentence and the rest of the paragraph became code. `tsc` reported six
 * syntax errors, every one of them pointing at prose, and the first said
 * "Expression expected" at a column inside a noun phrase. The cause is
 * invisible from any of them.
 *
 * WHY IT IS WORTH A RULE. Not because it is subtle to fix — it takes seconds
 * once you see it. Because of what the failure looks like before you see it:
 * this repository's modules open with paragraphs, those paragraphs are full of
 * globs and paths, and the diagnosis a contributor gets is a list of errors
 * about code they did not write, in a file they only added a comment to. The
 * typecheck already CATCHES this; what it cannot do is say why.
 *
 * THE RULE: a block comment that OPENS on one line and CLOSES on another must
 * not have anything after its terminator on the closing line. In a healthy
 * multi-line block the terminator is the last thing on its line. Anything else
 * means the comment stopped somewhere its author was still writing prose.
 *
 * Deliberately still not "no terminator anywhere inside a block comment": an
 * inline block followed by code on the same line — `foo(/* flag *\/ true)` —
 * is legitimate, and a rule that flagged it is a rule people turn off. The
 * span the two forms differ by is the line break, which is why the rule is
 * about it.
 *
 * WHAT CHANGED, and why the first version was narrower. The rule shipped as a
 * per-line text match: a line BEGINNING with a star, carrying a terminator
 * with text after it. Every continuation line of a doc comment in this
 * repository is one, so it caught the case that motivated it — and a block
 * comment whose continuation lines are unprefixed (legal, and what a pasted-in
 * paragraph looks like before anything formats it) could carry the two
 * characters anywhere and the rule saw nothing. The follow-up filing that gap
 * priced the fix as "a scanner that tracks comment state, which is a parser,
 * which is the cost this rule was written to avoid".
 *
 * That price was already paid. `lib/strip-comments.ts` has tracked comment,
 * string and regex state for eleven callers since long before this guard
 * existed; what it lacked was a way to report WHERE a comment ended, because
 * blanked text cannot say. It exports {@link scanComments} now, so the rule
 * below is a property of a real comment span rather than a guess about a line
 * shape — and the star prefix, which was the whole of the old rule, is not
 * consulted at all.
 *
 * A scan of comment spans also cannot be fooled by the terminator appearing in
 * a STRING (this module's own suite is full of them) or in a regex literal,
 * which the text match could only avoid by never looking at lines that start
 * with code.
 *
 * Measured against this tree at 810 files: zero findings, and it flags both
 * the real case and the unprefixed one the text match missed.
 *
 * This module still cannot write the terminator out — the rule is its own
 * first customer, and the paragraph above escapes the one it quotes.
 */

import { scanComments } from "./strip-comments";

/** One line whose block comment ended before its author meant it to. */
export interface EarlyTerminator {
  /** Repo-relative path of the file. */
  readonly file: string;
  /** 1-indexed line number. */
  readonly line: number;
  /** 1-indexed column of the `*` that closed the comment. */
  readonly column: number;
  /** What survives on that line as code, trimmed — the reader's clue. */
  readonly trailing: string;
}

/** Longest trailing fragment a report will quote before it stops helping. */
export const TRAILING_LIMIT = 60;

/**
 * The advice, once, because the wrapper's report and the CI annotation both
 * carry it and a reader who sees two different sentences learns there are two
 * rules.
 */
export const EARLY_TERMINATOR_ADVICE =
  "a block comment cannot contain its own terminator — describe the glob (\"every .ts in the tree\") or break the two characters apart, rather than writing it out";

/** Characters in the terminator, so the arithmetic below can be read. */
const TERMINATOR_LENGTH = 2;

/**
 * Every place in `source` where a multi-line block comment closes with prose
 * still to come.
 *
 * Column and trailing text are both reported: the column is where the comment
 * actually ended, and the trailing text is the fragment that became code,
 * which is what the reader will recognise from `tsc`'s complaint.
 *
 * An UNCLOSED block comment is not this rule's finding. It is a different
 * failure with a different diagnosis — the compiler says so directly, naming
 * the comment — and there is no trailing fragment to quote, because nothing
 * after it became code.
 */
export function findEarlyTerminators(file: string, source: string): EarlyTerminator[] {
  const found: EarlyTerminator[] = [];
  // Offset of the start of each line, so a span index becomes a line/column
  // in one lookup rather than a re-split per finding.
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (index: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low;
  };

  for (const span of scanComments(source)) {
    if (span.kind !== "block" || !span.closed) continue;
    const openedOn = lineOf(span.start);
    const closedOn = lineOf(span.end - 1);
    // An inline block comment — opened and closed on one line — is the
    // legitimate shape. Only a comment that ran across a line break was being
    // written as prose when it stopped.
    if (openedOn === closedOn) continue;
    const nextBreak = source.indexOf("\n", span.end);
    const rest = source.slice(span.end, nextBreak < 0 ? source.length : nextBreak);
    const trailing = rest.trim();
    // Nothing after it is the ordinary close of a healthy comment.
    if (trailing === "") continue;
    // The one shape that legitimately puts code after a wrapped terminator: a
    // JSX expression container holding nothing but the comment. `{/* … */}` is
    // the only way to write a comment in JSX, prettier wraps the long ones
    // across lines, and the brace that follows is the container's own — which
    // is why the exemption checks the character BEFORE the comment too. Twelve
    // of these are in this tree and every one is prose; a stray terminator in
    // the middle of one still leaves its own paragraph behind, which does not
    // begin with a brace, so the case that matters is still reported.
    if (source[span.start - 1] === "{" && trailing.startsWith("}")) continue;
    found.push({
      file,
      line: closedOn + 1,
      column: span.end - TERMINATOR_LENGTH - lineStarts[closedOn] + 1,
      trailing:
        trailing.length > TRAILING_LIMIT ? `${trailing.slice(0, TRAILING_LIMIT)}…` : trailing,
    });
  }
  return found;
}

/** Human-readable report, or `""` when there is nothing to say. */
export function formatEarlyTerminatorReport(found: readonly EarlyTerminator[]): string {
  if (found.length === 0) return "";
  const lines = [
    `Found ${found.length} block comment(s) that end inside their own body.`,
    `The text after the terminator is parsed as CODE, so the failure arrives as syntax errors pointing at prose: ${EARLY_TERMINATOR_ADVICE}.`,
  ];
  const byFile = new Map<string, EarlyTerminator[]>();
  for (const entry of found) {
    const list = byFile.get(entry.file) ?? [];
    list.push(entry);
    byFile.set(entry.file, list);
  }
  for (const [file, list] of byFile) {
    lines.push("", `  ${file}`);
    for (const entry of list) {
      lines.push(`    ${entry.line}:${entry.column}  became code: ${entry.trailing}`);
    }
  }
  return lines.join("\n");
}
