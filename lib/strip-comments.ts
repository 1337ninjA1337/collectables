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
 * The six things in a source file that are not code.
 *
 * Named individually rather than collapsed to "comment" and "literal" because
 * every caller so far cares about a different subset, and the distinctions are
 * not cosmetic: a line comment ends at a newline and a block one does not, a
 * template literal spans lines and the other two quotes do not.
 */
export type SpanKind = "line" | "block" | "single" | "double" | "template" | "regex";

/**
 * One comment or literal, as a half-open span of the source it was found in.
 *
 * Exported because blanking is not the only question a caller has. `WHERE did
 * this comment end` cannot be answered from stripped text — a blanked comment
 * and the spaces around it are the same characters — and `is this offset in
 * code at all` needs the literals as well as the comments. Both callers would
 * otherwise have been a second copy of the state machine below, one of them in
 * a module whose entire subject is source read wrongly.
 */
export interface SourceSpan {
  /** Which of the six. */
  readonly kind: SpanKind;
  /** Index of the character that opened it: the `/`, or the quote. */
  readonly start: number;
  /**
   * Index one past the span.
   *
   * For anything with a terminator — a block comment, a closed literal — that
   * is the character after it. For a span a NEWLINE ended (a line comment, an
   * unterminated `'` or `"`) the newline is outside, which is what lets
   * {@link stripComments} blank every span by one rule and keep line numbers.
   */
  readonly end: number;
  /**
   * Whether the span reached its own terminator rather than an end it was
   * handed.
   *
   * A line comment is closed by end-of-source as legitimately as by a newline,
   * so it is the one kind that is always `true`. Everything else can be
   * `false`, and a caller reasoning about where something ENDED has to know:
   * an unterminated literal or block comment ends nowhere its author chose.
   */
  readonly closed: boolean;
}

/** A {@link SourceSpan} that is one of the two comment kinds. */
export interface CommentSpan extends SourceSpan {
  readonly kind: "line" | "block";
}

/**
 * Every comment in `source`, in the order they open.
 *
 * The comment-only view of {@link scanSpans}, which is what the two callers
 * that do not care about literals want — and a filter rather than a second
 * walk, so the two views cannot disagree about where a comment is.
 */
export function scanComments(source: string): CommentSpan[] {
  return scanSpans(source).filter(
    (span): span is CommentSpan => span.kind === "line" || span.kind === "block",
  );
}

/**
 * Every comment and literal in `source`, in the order they open.
 *
 * The state machine, and the only one in this module. Regex literals are
 * tracked for the reason the module header gives — a quote inside a pattern
 * puts a scanner without that knowledge into string mode, after which every
 * comment below it is invisible — and they are REPORTED for the same reason a
 * string literal is: everything this returns is a place where two characters
 * that look like syntax are content instead.
 *
 * What is NOT a span is code. That complement is the whole value to a caller
 * asking whether a shape it found is real: `lib/check-comment-terminators.ts`
 * reads it to find a comment terminator standing in code, which is a thing no
 * valid program contains and a thing every comment that ended early leaves
 * behind.
 */
export function scanSpans(source: string): SourceSpan[] {
  const found: SourceSpan[] = [];
  type Mode = "code" | SpanKind;
  let mode: Mode = "code";
  /** Index of the character that opened the span being read. */
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
      if (mode !== "code") start = i;
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
        // A newline here means the `/` was a division after all, so the span
        // is unclosed and stops before the newline — the same boundary rule a
        // line comment gets, for the same reason.
        found.push({ kind: "regex", start, end: c === "/" ? i + 1 : i, closed: c === "/" });
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
      else {
        const terminated =
          (mode === "single" && c === "'") ||
          (mode === "double" && c === '"') ||
          (mode === "template" && c === "`");
        // A raw newline ends `'` and `"` and not a template literal, which is
        // the one quote allowed to span lines. The literal is unclosed in that
        // case, and the newline is outside it.
        const cutByNewline = c === "\n" && (mode === "single" || mode === "double");
        if (terminated || cutByNewline) {
          found.push({
            kind: mode,
            start,
            end: terminated ? i + 1 : i,
            closed: terminated,
          });
          mode = "code";
          // A closing quote ends an expression, so a `/` after it is division —
          // which is what `DIVISION_FOLLOWS` says about all three characters.
          prev = c === "\n" ? prev : c;
          prevWord = "";
          inWord = false;
        }
      }
    }
  }
  // Anything still open at the end of the file ends there. The line comment is
  // closed by end-of-source as legitimately as by a newline; nothing else is,
  // and says so, because a caller asking where something ended must not read
  // "the last character of the file" as an answer its author chose.
  if (mode !== "code") {
    found.push({ kind: mode, start, end: source.length, closed: mode === "line" });
  }
  return found;
}

/**
 * Whether `index` is in code — outside every comment and every literal.
 *
 * The complement of {@link scanSpans}, as a lookup, because the question is
 * always asked about many offsets at once and a linear scan per offset is the
 * shape that turns a guard into the slow one.
 */
export function codeOffsets(source: string, spans?: readonly SourceSpan[]): (index: number) => boolean {
  const covered = new Uint8Array(source.length);
  for (const span of spans ?? scanSpans(source)) {
    for (let i = span.start; i < span.end; i++) covered[i] = 1;
  }
  return (index) => index >= 0 && index < source.length && covered[index] === 0;
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
