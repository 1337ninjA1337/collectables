import { stripComments } from "./strip-comments";

/**
 * The text scan two guards needed and neither owns.
 *
 * `check-chunked-list-items` was written first and wrote all of this: read the
 * first argument of a call, resolve what a name is bound to, blank the string
 * bodies so prose about a call is not a call. `check-context-array-stability`
 * asks the second of those three questions about a different subject — is this
 * array-typed context field memoized on its own dependencies — and the answer
 * comes from the same walk. A module named after one rule holding the scanner
 * the next one needs is how a tree grows two scanners that are almost the same,
 * which is the failure `lint:jsx-walk` exists to refuse one directory over.
 *
 * WHAT IS HERE AND WHAT IS NOT. This module knows about declarations, brackets,
 * call arguments and string literals. It knows nothing about hooks, React, or
 * what makes a value stable — each rule decides that from what it reads here,
 * because the two rules accept different things (a context field may be a
 * module constant; a screen-level `items` argument may not be one usefully).
 */

/** A bare JavaScript identifier, anchored. */
export const BARE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Comments removed and every string/template body replaced by spaces of the
 * same length, so offsets and line numbers still point at the real source.
 * Prose about this hook inside a string literal is not a call to it.
 */
export function scannableCode(source: string): string {
  const code = stripComments(source);
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") {
        out += "  ";
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        out += ch;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The first argument of the call whose `(` is at `open`, read with a depth
 * counter so a nested call, an arrow body, an object or an array literal is
 * part of the argument rather than the end of it. Quotes and template literals
 * are skipped whole, so a comma inside a string does not end anything.
 *
 * Returns `null` for an unterminated call, which is a syntax error the
 * compiler reports better than a lint rule can.
 */
export function firstArgumentAt(code: string, open: number): string | null {
  const span = firstArgumentSpanAt(code, open);
  return span ? code.slice(span.start, span.end).trim() : null;
}

/**
 * The same scan as {@link firstArgumentAt}, as offsets rather than text.
 *
 * The offsets are what let the report quote the REAL source while the scan
 * reads the blanked copy: `stripComments` and {@link scannableCode} both
 * preserve length and line breaks, so an offset means the same thing in both.
 * Without this the report said `items.filter((i) => i.role === " ")` — the
 * guard quoting its own blanking back at the reader.
 */
export function firstArgumentSpanAt(
  code: string,
  open: number,
): { start: number; end: number } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return { start: open + 1, end: i };
      continue;
    }
    if (ch === "," && depth === 1) return { start: open + 1, end: i };
  }
  return null;
}

/** The local names a destructuring pattern body binds (`a, b: c, ...rest`). */
export function destructuredNames(body: string): string[] {
  return body
    .split(",")
    .map((part) => {
      const piece = part.includes(":") ? part.slice(part.indexOf(":") + 1) : part;
      return piece.replace(/\.\.\./, "").trim().replace(/=[\s\S]*$/, "").trim();
    })
    .filter((name) => BARE_IDENTIFIER.test(name));
}

/** One `const`/`let`/`var` declaration, as a binding pattern and the head of its initialiser. */
export interface Declaration {
  /** Bare name for `const x = …`, or the pattern body for `const { a, b } = …`. */
  readonly names: readonly string[];
  /** Up to 60 characters of whatever follows the `=`, on one line. */
  readonly rhs: string;
  /**
   * Spaces before the keyword on its own line.
   *
   * The honest signal for scope, and the same one `check-latest-ref` settled
   * on: zero means module level, which is the difference between
   * `const EMPTY = []` at the top of a file (one array, forever) and
   * `const rows = []` inside a component (a new one per render). Deciding it
   * properly means parsing the function, and this repository has written down
   * what it thinks of hand-rolled parsers that are almost right.
   */
  readonly indent: number;
  /** Offset of the `const`/`let`/`var` keyword, for "which of these two is in scope here". */
  readonly at: number;
}

/**
 * Every declaration in the file, found by walking rather than by one regex.
 *
 * The regex version of this had the bug a fixed-width tail always has: a
 * pattern ending in `([\s\S]{0,60})` consumes sixty characters past the `=`,
 * which on `app/index.tsx` swallowed the `const {` of the very next
 * declaration — the eleven-name `useCollections()` destructure that feeds two
 * of the five windows. `matchAll` cannot return overlapping matches, so the
 * declaration was not merely mis-read, it was invisible, and the guard
 * reported the home screen's argument as unresolved on its first run.
 */
export function declarations(code: string): Declaration[] {
  const found: Declaration[] = [];
  for (const match of code.matchAll(/\b(?:const|let|var)\s+/g)) {
    const at = match.index + match[0].length;
    const opener = code[at];
    let namesEnd = at;
    let names: string[];
    if (opener === "{" || opener === "[") {
      const close = matchingBracket(code, at);
      if (close === null) continue;
      names = destructuredNames(code.slice(at + 1, close));
      namesEnd = close + 1;
    } else {
      const identifier = /^[A-Za-z_$][\w$]*/.exec(code.slice(at));
      if (!identifier) continue;
      names = [identifier[0]];
      namesEnd = at + identifier[0].length;
    }
    // Skip a type annotation, which may itself contain `=` in an arrow type.
    const assign = code.indexOf("=", namesEnd);
    if (assign === -1) continue;
    const between = code.slice(namesEnd, assign);
    if (/[;)\n]/.test(between) && !between.includes(":")) continue;
    const lineStart = code.lastIndexOf("\n", match.index) + 1;
    found.push({
      names,
      rhs: code.slice(assign + 1, assign + 61).trim().split("\n")[0].trim(),
      indent: /^[ \t]*/.exec(code.slice(lineStart, match.index))?.[0].length ?? 0,
      at: match.index,
    });
  }
  return found;
}

/** Index of the bracket closing the one at `open`, or `null` when unterminated. */
export function matchingBracket(code: string, open: number): number | null {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

