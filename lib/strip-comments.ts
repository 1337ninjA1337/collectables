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
 * division rule is {@link startsRegExp}'s, shared with the scanner in
 * `lib/i18n-source.ts` that needed the same answer first.
 *
 * It is still not a parser. It tracks the previous token approximately — the
 * last non-space character, and the last identifier word — which is what the
 * shared rule takes, and which is wrong only where a full parse is required
 * (a `/` after the `)` of an `if (…)`). `lib/js-tokens.ts` says where that
 * line is.
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

import { DIVISION_FOLLOWS, followsRegExpKeyword } from "./js-tokens";

/**
 * Comment bodies replaced by spaces, newlines and string literals preserved.
 */
export function stripComments(source: string): string {
  const out = source.split("");
  type Mode = "code" | "line" | "block" | "single" | "double" | "template" | "regex";
  let mode: Mode = "code";
  /** Last non-whitespace character seen in code — the `/` rule's left side. */
  let prev = "";
  /** The identifier run ending at {@link prev}, for the keyword rows. */
  let prevWord = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") mode = "line";
      else if (c === "/" && next === "*") mode = "block";
      else if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      else if (c === "/" && (!DIVISION_FOLLOWS.test(prev) || followsRegExpKeyword(prevWord))) {
        mode = "regex";
      }
      if (mode === "line" || mode === "block") out[i] = " ";
      if (mode === "code" && !/\s/.test(c)) {
        prevWord = /[A-Za-z0-9_$]/.test(c) ? prevWord + c : "";
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
      }
    } else if (mode === "line") {
      if (c === "\n") mode = "code";
      else out[i] = " ";
    } else if (mode === "block") {
      if (c === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        mode = "code";
      } else if (c !== "\n") {
        out[i] = " ";
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
      }
    }
  }
  return out.join("");
}
