/**
 * Blank out the comments in a source file, so a scan reads code and not prose.
 *
 * Every structural check in this repository is a text match, and every one of
 * them eventually meets the same problem: the file that documents a forbidden
 * shape is the file most likely to contain it. A guard that retires
 * `process.env` passed whole has to say so in a doc comment; a guard that
 * retires `process.cwd()` in the suites quotes it to explain what it replaced.
 * Stripping first is what lets those rules stay "not at all" instead of
 * growing an exemption for every file that mentions them.
 *
 * Whitespace, not deletion: every character becomes a space and every newline
 * survives, so offsets and line numbers in the stripped text still map to the
 * original. A caller reporting `file:line` reports the real one.
 *
 * String literals are tracked, so `"// not a comment"` stays intact — which
 * matters more than it sounds, because a guard's own list of forbidden shapes
 * is usually an array of strings.
 *
 * Its own module because it is not about any one scan. It lived in
 * `lib/env-inlining.ts` — a module whose subject is Metro's
 * `process.env.EXPO_PUBLIC_*` transform — and grew ten importers that have
 * nothing to do with bundling: four lint guards (analytics imports, inline
 * radius, empty-state wrappers, problem-phrasing imports) and six test suites.
 * A reader deleting env-inlining's last bundle caller would not have expected
 * six guards to go red.
 *
 * It DOES know about regex literals, and has to: a quote or a backtick inside
 * a pattern (`/["']key["']/`, ``/`msg-\$\{x\}/``) puts a stripper without that
 * knowledge into string mode, after which every comment below survives into
 * what a guard reads as code. That was live in four files — twenty comment
 * lines in `chat-context-uuid.test.ts`, `i18n-source.test.ts`,
 * `lib/privacy-page.ts` and `lib/spa-fallback.ts`, all of them downstream of a
 * single unpaired backtick or quote inside a pattern. The regex-versus-
 * division rule is `opensRegExp`'s, in `lib/js-tokens.ts`, shared with the
 * scanner in `lib/i18n-source.ts` that needed the same answer first.
 *
 * It is still not a parser. It tracks the previous token approximately — the
 * last non-space character, and the last identifier word — which is what the
 * shared rule takes, and which is wrong only where a full parse is required
 * (a `/` after the `)` of an `if (…)`). `lib/js-tokens.ts` says where that
 * line is.
 *
 * Sharing the rule is not the same as sharing the tracking, and the difference
 * was a live hazard here: `lib/i18n-source.ts` clears the word for a name
 * reached through a `.`, because `p.return` is a property name that ends an
 * expression and `p.return / 2` divides. This module's smaller copy did not,
 * so it opened a pattern there and blanked the rest of the line — a comment
 * below it surviving into what a guard reads as code, which is the one thing
 * stripping exists to prevent. Nothing in the tree triggered it, which is why
 * it was a hazard rather than a failure; the cases pin both directions, since
 * clearing the word too eagerly makes `return /}/` a division and blanks real
 * code instead.
 *
 * A caller has to decide one more thing after stripping — whether to flatten
 * whitespace as well — and the eleven that call this had each decided it
 * separately with nothing stating the three shapes together. They are:
 *
 * 1. **Stripped, offsets intact** (`sourceCode` in
 *    `__tests__/helpers/source-files.ts`). The default, and what the four lint
 *    guards under `scripts/` want: comment bodies become spaces, so a match
 *    index here is a match index in the original and a reported `file:line` is
 *    the real one. Reach for this whenever the finding is printed with a
 *    location.
 * 2. **Stripped then flattened** (`suiteCode` in `helpers/suite-files.ts`,
 *    `sourceCodeFlat` in `helpers/source-files.ts`). For a rule that matches a
 *    SHAPE rather than reporting a place — a shape spanning lines otherwise
 *    hides behind a prettier rewrap, which is how three suites once read clean
 *    while still doing the thing. Offsets do not survive, so a caller that
 *    prints a line number wants the first form.
 * 3. **Split by line first** (`scripts/check-inline-hex.ts`). A per-line scan,
 *    which is the same answer as the first form arrived at differently; it is
 *    that way because its pattern carries `g` at module scope. New scanners
 *    should take the first form instead.
 *
 * A scanner that flattens when it meant to report, or reports offsets from
 * flattened text, is wrong in a way that still passes on a clean tree — which
 * is why the choice is written down here rather than left to whichever caller
 * a reader opens first.
 */

import { opensRegExp } from "./js-tokens";

/**
 * One comment, as a half-open span of the source it was found in.
 *
 * Exported because blanking is not the only question a caller has about a
 * comment. `lib/check-comment-terminators.ts` asks WHERE one ended, which the
 * stripped text cannot answer — a blanked comment and the spaces around it are
 * the same characters — and the alternative was a second copy of the state
 * machine below, in a module whose whole subject is comments read wrongly.
 */
export interface CommentSpan {
  /** `"line"` for `//`, `"block"` for the paired form. */
  readonly kind: "line" | "block";
  /** Index of the `/` that opened it. */
  readonly start: number;
  /**
   * Index one past the comment: the newline ending a line comment (or the end
   * of the source), the character after the terminator of a block one. A line
   * comment's newline is therefore OUTSIDE the span, which is what lets
   * {@link stripComments} blank every span by the same rule.
   */
  readonly end: number;
  /**
   * Whether the comment was terminated before the file ended.
   *
   * Only a block comment can be `false`: a line comment is closed by the end
   * of the source as legitimately as by a newline. A caller reasoning about
   * where a comment ENDED has to know the difference, since an unclosed block
   * ends nowhere its author chose.
   */
  readonly closed: boolean;
}

/**
 * Every comment in `source`, in the order they open.
 *
 * The state machine is here rather than in {@link stripComments} because both
 * callers need the same one and only one of them needs the blanking. String
 * literals and regex literals are tracked for the reason the module header
 * gives: a quote inside a pattern puts a scanner without that knowledge into
 * string mode, after which every comment below it is invisible.
 */
export function scanComments(source: string): CommentSpan[] {
  const found: CommentSpan[] = [];
  type Mode = "code" | "line" | "block" | "single" | "double" | "template" | "regex";
  let mode: Mode = "code";
  /** Index of the `/` that opened the comment being read. */
  let start = 0;
  /** Last non-whitespace character seen in code — the `/` rule's left side. */
  let prev = "";
  /** The identifier run ending at {@link prev}, for the keyword rows. */
  let prevWord = "";
  /** Whether {@link prev} is inside an identifier run rather than ending one. */
  let inWord = false;
  /**
   * Whether the run being accumulated began right after a `.`.
   *
   * A word reached through a member access is a PROPERTY NAME, not a keyword:
   * `p.return` ends an expression, so `p.return / 2` divides. Recording
   * `return` as the last word opens a regex and blanks the rest of the line —
   * a comment below it then survives into what a guard reads as code, which is
   * the failure this module exists to prevent. `?.` ends in the same `.`.
   */
  let afterMemberDot = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") mode = "line";
      else if (c === "/" && next === "*") mode = "block";
      else if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      else if (c === "/" && opensRegExp(prev, prevWord)) mode = "regex";
      if (mode === "line" || mode === "block") start = i;
      if (mode === "code" && !/\s/.test(c)) {
        if (/[A-Za-z0-9_$]/.test(c)) {
          // The flag is read at the START of a run and held for the rest of
          // it: recomputing it per character would answer `prev === "."` only
          // for the first one, which is the same bug one character narrower.
          // Whitespace does not break a run here because it does not move
          // `prev` — `p . return` is still a member access.
          if (!inWord) afterMemberDot = prev === ".";
          inWord = true;
          prevWord = afterMemberDot ? "" : prevWord + c;
        } else {
          inWord = false;
          afterMemberDot = false;
          prevWord = "";
        }
        prev = c;
      }
    } else if (mode === "regex") {
      // A character class may hold an unescaped `/`, so track it: `/[/]/` is
      // one literal and not two. A newline cannot appear in a pattern, so it
      // is the resync point if this was a division after all.
      if (c === "\\") i++;
      else if (c === "[") {
        while (i < source.length && source[i] !== "]" && source[i] !== "\n") {
          i += source[i] === "\\" ? 2 : 1;
        }
      } else if (c === "/" || c === "\n") {
        mode = "code";
        prev = "/";
        prevWord = "";
        inWord = false;
      }
    } else if (mode === "line") {
      if (c === "\n") {
        found.push({ kind: "line", start, end: i, closed: true });
        mode = "code";
      }
    } else if (mode === "block") {
      if (c === "*" && next === "/") {
        i++;
        mode = "code";
        found.push({ kind: "block", start, end: i + 1, closed: true });
      }
    } else {
      // Inside a string literal: honour escapes, exit on the matching quote.
      if (c === "\\") i++;
      else if (mode === "single" && (c === "'" || c === "\n")) mode = "code";
      else if (mode === "double" && (c === '"' || c === "\n")) mode = "code";
      else if (mode === "template" && c === "`") mode = "code";
      // A closing quote ends an expression, so a `/` after it is division —
      // which is what `DIVISION_FOLLOWS` says about all three characters.
      if (mode === "code") {
        prev = c === "\n" ? prev : c;
        prevWord = "";
        inWord = false;
      }
    }
  }
  // A comment still open at the end of the file ends there. The line form is
  // closed by end-of-source as legitimately as by a newline; the block form is
  // not, and says so, because a caller asking where a comment ended must not
  // read "the last character of the file" as an answer its author chose.
  if (mode === "line") found.push({ kind: "line", start, end: source.length, closed: true });
  if (mode === "block") found.push({ kind: "block", start, end: source.length, closed: false });
  return found;
}

/**
 * Comment bodies replaced by spaces, newlines and string literals preserved.
 */
export function stripComments(source: string): string {
  const out = source.split("");
  for (const span of scanComments(source)) {
    for (let i = span.start; i < span.end; i++) {
      // Newlines survive so offsets and line numbers still map to the
      // original. One rule covers both forms: a line comment's span stops
      // BEFORE its newline, so there is never one inside it to preserve.
      if (source[i] === "\n") continue;
      out[i] = " ";
    }
  }
  return out.join("");
}
