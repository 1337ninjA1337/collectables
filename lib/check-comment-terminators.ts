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
 * TWO RULES, because the first one has an exemption and the second is what
 * makes the exemption safe. The wrapped JSX comment container — the only way
 * to write a comment in JSX, and prettier wraps the long ones across lines —
 * legitimately puts a closing brace after a terminator, so the first rule
 * skips a comment opened straight after a `{` whose trailing text starts with
 * `}`. That skip was defended by a claim about ENGLISH: no orphaned paragraph
 * begins with a brace. Nobody can write the counter-example without inventing
 * it, which is the same thing as nobody being able to check it.
 *
 * So the second rule does not depend on it. A comment that ends early leaves
 * its ORIGINAL terminator standing in what is now code, and a terminator in
 * code is a thing no valid program contains — `tsc` calls it a syntax error
 * wherever it lands. {@link findOrphanTerminators} looks for exactly that,
 * using {@link scanSpans}' complement (everything outside every comment and
 * every literal), so a broken comment the first rule skipped is still named,
 * by the wreckage rather than by the cause.
 *
 * The two are reported as CAUSE and SYMPTOM, never both for one offence: an
 * early terminator in a file is the reason its orphan exists, so the orphans
 * of a file with an early finding are dropped. A file with orphans and no
 * early finding is the case the second rule exists for, and its message says
 * so rather than repeating the first rule's advice.
 *
 * Measured against this tree at 812 files: zero findings from either rule.
 *
 * This module still cannot write the terminator out — the rules are their own
 * first customer, and the paragraphs above escape the one they quote.
 */

import { annotation } from "./github-annotations";
import { scanComments, scanSpans, codeOffsets } from "./strip-comments";

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
 * The terminator, assembled rather than typed.
 *
 * Spelling it out here would end this module's own doc comment on the day
 * somebody moves this constant above one, which is the bug under guard. Both
 * rules search with it.
 */
const TERMINATOR = `*${"/"}`;

/**
 * Line starts and an index-to-line lookup, built once per file.
 *
 * Both rules turn offsets into `line:column`, and a re-split per finding is
 * how the cheap one becomes the expensive one on a file with many.
 */
function lineIndex(source: string): {
  starts: readonly number[];
  lineOf: (index: number) => number;
} {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return {
    starts,
    lineOf: (index: number): number => {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (starts[mid] <= index) low = mid;
        else high = mid - 1;
      }
      return low;
    },
  };
}

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
  const { starts: lineStarts, lineOf } = lineIndex(source);

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

/** One comment terminator standing in code, closing nothing. */
export interface OrphanTerminator {
  /** Repo-relative path of the file. */
  readonly file: string;
  /** 1-indexed line number. */
  readonly line: number;
  /** 1-indexed column of the `*`. */
  readonly column: number;
  /** The line it stands on, trimmed — the reader's clue. */
  readonly text: string;
}

/**
 * The advice for an orphan, which is not the advice for its cause.
 *
 * A reader who reaches this message has a terminator with no comment above it,
 * and the useful instruction is to go LOOK for the comment that ended early —
 * not to stop writing globs, which is what the other sentence says.
 */
export const ORPHAN_TERMINATOR_ADVICE =
  "no valid program contains a comment terminator in code, so a block comment above this one ended before its author meant it to — find the terminator inside its body";

/**
 * Every comment terminator in `source` that stands in code.
 *
 * Not inside a comment (it would be that comment's own close, or content) and
 * not inside a string, template or regex literal (where it is ordinary text —
 * this module's suite writes it, and so does anything quoting a glob). What is
 * left is a terminator the compiler will reject, and the only way one gets
 * there is a comment that ended somewhere earlier than its author intended.
 *
 * The rule needs no exemption and has none. That is the point of it: the first
 * rule has one, and this is what stands behind the skip.
 */
export function findOrphanTerminators(file: string, source: string): OrphanTerminator[] {
  const found: OrphanTerminator[] = [];
  const spans = scanSpans(source);
  const inCode = codeOffsets(source, spans);
  const { starts: lineStarts, lineOf } = lineIndex(source);
  for (let at = source.indexOf(TERMINATOR); at >= 0; at = source.indexOf(TERMINATOR, at + 1)) {
    if (!inCode(at)) continue;
    const line = lineOf(at);
    const nextBreak = source.indexOf("\n", lineStarts[line]);
    const text = source.slice(lineStarts[line], nextBreak < 0 ? source.length : nextBreak).trim();
    found.push({
      file,
      line: line + 1,
      column: at - lineStarts[line] + 1,
      text: text.length > TRAILING_LIMIT ? `${text.slice(0, TRAILING_LIMIT)}…` : text,
    });
  }
  return found;
}

/**
 * The orphans worth reporting: those in files with no early finding.
 *
 * An early terminator is the REASON the orphans below it exist — the comment
 * it ended left its original close standing in code — so reporting both names
 * one offence twice, once by its cause and once by its wreckage. The cause is
 * the one a reader can act on, so it wins and the symptoms are dropped.
 *
 * What survives is the case this rule was added for: a file whose broken
 * comment the first rule could not see, because its one exemption skipped it.
 */
export function orphansWithoutCause(
  early: readonly EarlyTerminator[],
  orphans: readonly OrphanTerminator[],
): OrphanTerminator[] {
  const explained = new Set(early.map((entry) => entry.file));
  return orphans.filter((entry) => !explained.has(entry.file));
}

/** Human-readable report, or `""` when there is nothing to say. */
export function formatOrphanTerminatorReport(found: readonly OrphanTerminator[]): string {
  if (found.length === 0) return "";
  const lines = [
    `Found ${found.length} comment terminator(s) standing in code, closing nothing.`,
    `${ORPHAN_TERMINATOR_ADVICE}.`,
  ];
  const byFile = new Map<string, OrphanTerminator[]>();
  for (const entry of found) {
    const list = byFile.get(entry.file) ?? [];
    list.push(entry);
    byFile.set(entry.file, list);
  }
  for (const [file, list] of byFile) {
    lines.push("", `  ${file}`);
    for (const entry of list) {
      lines.push(`    ${entry.line}:${entry.column}  in code: ${entry.text}`);
    }
  }
  return lines.join("\n");
}

/**
 * One `::error` per finding, so CI puts it on the line of the PR diff.
 *
 * This guard wants the annotation more than most: the compiler's own errors
 * land on the lines BELOW the real one, so a reviewer reading the diff sees
 * complaints about code and nothing at all on the comment that caused them.
 *
 * Here rather than in `scripts/check-comment-terminators.ts`, where it was
 * written, for the reason every other gate's decisions moved into `lib/`: a
 * private function in a script is checkable only by reading the file for an
 * exact expression, which is a check on the spelling of the code rather than
 * on what it does. This one had never been run at all — it was the third
 * producer of annotations in the tree and the only one whose output had never
 * been through {@link isAnnotationLine}.
 */
export function earlyTerminatorAnnotations(found: readonly EarlyTerminator[]): string[] {
  return found.map((entry) =>
    annotation(
      "error",
      `This block comment ends here; "${entry.trailing}" after it is parsed as code — ${EARLY_TERMINATOR_ADVICE}`,
      { file: entry.file, line: entry.line, col: entry.column },
    ),
  );
}

/**
 * The same, for an orphan.
 *
 * A separate function because the message is a different one, and sharing it
 * would put a sentence about globs on a line whose problem is a comment that
 * ended above it.
 */
export function orphanTerminatorAnnotations(found: readonly OrphanTerminator[]): string[] {
  return found.map((entry) =>
    annotation(
      "error",
      `This comment terminator stands in code and closes nothing — ${ORPHAN_TERMINATOR_ADVICE}`,
      { file: entry.file, line: entry.line, col: entry.column },
    ),
  );
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
