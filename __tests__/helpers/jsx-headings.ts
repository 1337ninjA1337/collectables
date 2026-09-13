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
 * an open tag ENDS. The obvious `/<Text([\s\S]*?)>/` stops at the first `>`
 * inside an arrow function, and "inside a modal" is a question about
 * ANCESTORS, which needs a tag stack rather than a regex. `check-a11y-jsx`
 * reaches for `lib/jsx-open-tag` for exactly this reason, and a second copy of
 * a tag stack is the copy that drifts.
 */

import { openTagEnd } from "@/lib/jsx-open-tag";
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
  scan(code, 0, code.length, false, { file, styleMatcher, found });
  // Children of a render prop are collected while their parent tag is being
  // read, so the raw order is not the file's order — and an offender list is
  // read as one.
  return found.sort((a, b) => a.line - b.line);
}

type ScanContext = {
  readonly file: string;
  readonly styleMatcher: RegExp;
  readonly found: HeadingText[];
};

/**
 * One JSX range, with a tag stack.
 *
 * `inModalSeed` is what the range's OUTERMOST element is already nested in,
 * which matters only for the recursive call below.
 */
function scan(
  code: string,
  from: number,
  to: number,
  inModalSeed: boolean,
  context: ScanContext,
): void {
  const stack: { name: string; inModal: boolean }[] = [];
  let cursor = from;
  while (cursor < to) {
    const start = code.indexOf("<", cursor);
    if (start === -1 || start >= to) break;
    const close = /^<\/([A-Za-z][A-Za-z0-9_.]*)\s*>/.exec(code.slice(start));
    if (close) {
      const depth = stack.map((frame) => frame.name).lastIndexOf(close[1]);
      if (depth !== -1) stack.length = depth;
      cursor = start + close[0].length;
      continue;
    }
    const name = /^<([A-Za-z][A-Za-z0-9_.]*)/.exec(code.slice(start));
    if (!name) {
      cursor = start + 1;
      continue;
    }
    const attrsAt = start + name[0].length;
    const tagEnd = openTagEnd(code, attrsAt);
    if (tagEnd === -1 || tagEnd > to) break;
    cursor = tagEnd + 1;
    const attrs = code.slice(attrsAt, tagEnd);
    const inModal = stack.length > 0 ? stack[stack.length - 1].inModal : inModalSeed;
    if (name[1] === "Text" && context.styleMatcher.test(attrs)) {
      context.found.push({
        file: context.file,
        line: code.slice(0, start).split("\n").length,
        attrs,
        inModal,
      });
    }
    // A RENDER PROP CARRIES JSX INSIDE THE OPEN TAG, and the first version of
    // this walk stepped straight over it: `openTagEnd` correctly reports the
    // end of `<SwipeTabs … renderTab={(key) => (<View>…</View>)} />`, which is
    // sixty lines and two section headings later. `app/friends.tsx` renders
    // both of its tab panels that way, so the rule read the file as having
    // nothing to say about — the quietest way a sweep can be wrong.
    if (attrs.includes("<")) {
      scan(code, attrsAt, tagEnd, inModal || name[1] === "Modal", context);
    }
    // A self-closing tag opens nothing, so it never becomes an ancestor.
    const selfClosing = code[tagEnd - 1] === "/";
    if (!selfClosing) {
      stack.push({ name: name[1], inModal: inModal || name[1] === "Modal" });
    }
  }
}
