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
 * THE RULE, narrow on purpose: a line that begins with a star — the
 * continuation line of a doc-comment block, where every line is one — must not
 * contain a comment terminator with anything after it. In a healthy block the
 * only terminator is the last one, at the end of its line. Anything else means
 * the comment stopped somewhere its author was still writing prose.
 *
 * Deliberately NOT "no terminator anywhere inside a block comment", which
 * cannot be decided by looking at one line; and deliberately not a scan of
 * every line, because an inline block comment followed by code on the same
 * line is legitimate and a rule that flagged it is a rule people disable.
 * Measured against this tree at 809 files: zero findings, and it flags the
 * real case.
 *
 * This module cannot write the terminator out either — the rule is its own
 * first customer, and the paragraphs above are phrased the way they are for
 * exactly the reason the rule exists.
 *
 * Pure: no imports at all, like the other leaf rule modules here.
 */

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

/**
 * Every line in `source` where a doc-comment body closes the comment.
 *
 * Column and trailing text are both reported: the column is where the comment
 * actually ended, and the trailing text is the fragment that became code,
 * which is what the reader will recognise from `tsc`'s complaint.
 */
export function findEarlyTerminators(file: string, source: string): EarlyTerminator[] {
  const found: EarlyTerminator[] = [];
  source.split("\n").forEach((text, index) => {
    // A continuation line of a block comment. Every line of a doc comment in
    // this repository is one, and no ordinary statement starts with `*`.
    if (!/^\s*\*/.test(text)) return;
    const at = text.indexOf("*/");
    if (at < 0) return;
    const trailing = text.slice(at + 2).trim();
    // Nothing after it is the ordinary close of a healthy comment.
    if (trailing === "") return;
    found.push({
      file,
      line: index + 1,
      column: at + 1,
      trailing:
        trailing.length > TRAILING_LIMIT ? `${trailing.slice(0, TRAILING_LIMIT)}…` : trailing,
    });
  });
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
