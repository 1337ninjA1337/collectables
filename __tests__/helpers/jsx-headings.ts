/**
 * Every `<Text>` in the tree whose style names it a heading, and whether it is
 * inside a `<Modal>`.
 *
 * ONE WALK, TWO RULES. `modal-heading-role` asks whether a sheet's title is
 * announced as a heading; `screen-heading-role` asks the same of the section
 * labels on an ordinary screen. They are different rules — a sheet has no
 * landmark of its own and a screen has its route, and the modal rule allows
 * exemptions where the screen one has nothing to exempt — but they are the
 * same question about the same JSX, and the hard part is shared: finding where
 * an open tag ENDS, and answering "is this inside a `<Modal>`", which is a
 * question about ANCESTORS and needs a tag stack rather than a regex.
 *
 * BOTH ARE `lib/jsx-open-tag.ts`'s `walkJsx` NOW. This file kept its own copy
 * of that walk for an hour, which was long enough for the copy to be found
 * carrying the same render-prop bug as the guard's — a copy of a tag stack is
 * the copy that drifts, and this one drifted before it was a day old. What
 * stays here is the only part that is about headings: a `<Modal>` is what
 * descendants inherit.
 */

import { walkJsx } from "@/lib/jsx-open-tag";
import { stripComments } from "@/lib/strip-comments";

import { sourceCode } from "./source-files";

export type HeadingText = {
  /** Repo-relative path, as an offender list should print it. */
  readonly file: string;
  /** 1-based line of the `<Text` itself. */
  readonly line: number;
  /** The open tag's attributes, which is where the role would be. */
  readonly attrs: string;
  /** Whether a `<Modal>` is one of its ancestors in this file. */
  readonly inModal: boolean;
};

/** Whether this element already says it is a heading. */
export function isHeader(text: HeadingText): boolean {
  return text.attrs.includes('accessibilityRole="header"');
}

/**
 * `<Text>` elements in one file whose style attribute matches `styleMatcher`.
 *
 * Comments are stripped first — a rule that reads raw source goes red on
 * correct code the day somebody writes the pattern into a comment explaining
 * it, which has happened three times in this repository.
 */
export function headingTexts(file: string, styleMatcher: RegExp): HeadingText[] {
  const code = stripComments(sourceCode(file));
  const found: HeadingText[] = [];
  for (const tag of walkJsx(code, {
    seed: false,
    inherit: (candidate, inModal) => inModal || candidate.name === "Modal",
  })) {
    if (tag.name !== "Text" || !styleMatcher.test(tag.attrs)) continue;
    found.push({
      file,
      line: code.slice(0, tag.start).split("\n").length,
      attrs: tag.attrs,
      inModal: tag.inherited,
    });
  }
  // Children of a render prop are yielded while their parent tag is being
  // read, so the raw order is not the file's order — and an offender list is
  // read as one.
  return found.sort((a, b) => a.line - b.line);
}
