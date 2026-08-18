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
 * Not a parser and not trying to be. It does not know about regex literals —
 * a `/` that opens one, or a quote inside one — which is exactly the ambiguity
 * `lib/i18n-source.ts` had to build a real token scanner for when its question
 * needed it. This is the cheap answer, and it is the right one for source a
 * human wrote and a formatter normalised.
 */

/**
 * Comment bodies replaced by spaces, newlines and string literals preserved.
 */
export function stripComments(source: string): string {
  const out = source.split("");
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") mode = "line";
      else if (c === "/" && next === "*") mode = "block";
      else if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      if (mode === "line" || mode === "block") out[i] = " ";
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
    }
  }
  return out.join("");
}
