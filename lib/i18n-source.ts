/**
 * The one reader of `lib/i18n-context.tsx`'s SOURCE.
 *
 * That file pulls React Native peers, so every structural test about it parses
 * the text instead of importing the module — and each of them grew its own
 * habit for finding a declaration. Four suites were reading one file four ways:
 * `i18n-translations.test.ts` matched `const ru = {` with a regex and sliced a
 * map's body by "up to the next declaration", `i18n-locale-map-parity.test.ts`
 * and `privacy-page-i18n.test.ts` each scraped `languageOptions` with the same
 * `[\s\S]*?\];` pattern copied between them, and `i18n-translation-coverage.ts`
 * scanned for the matching brace. They agreed because the file is formatted the
 * way all four expected; the first one to reformat it would have made three of
 * them wrong and left the fourth to report the difference as a translation
 * finding.
 *
 * So the parsing lives here, once, and the suites ask questions instead of
 * matching text.
 *
 * What this scanner reads:
 *  - object literals: keys written `name:` and shorthand keys (`{ en, ru }`),
 *    plus identifiers spread in (`...en`), at the literal's OWN level;
 *  - array literals, and the top-level object literals inside them;
 *  - strings, template literals (their `${}` slots as code, not text), line and
 *    block comments, and regular-expression literals.
 *
 * What it does NOT read, deliberately: quoted (`"a-b":`) or computed
 * (`[key]:`) keys, both absent from this file and both a compile error against
 * `TranslationMap`; and declarations other than a top-level `const`. It is a
 * scanner for the shapes this repository writes, not a JavaScript parser, and
 * the cases that pin those absences live in `__tests__/i18n-source.test.ts`.
 *
 * Two failure shapes, and which one a reader gets depends on the question it
 * asked. The `find*` readers return NULL, because "there is no such
 * declaration" is an answer a caller can act on — that is what
 * `findLocaleBlock(source, "fr")` means. {@link localeKeys} THROWS, because its
 * callers are asserting parity with the file: an empty set there would report a
 * renamed or deleted map as every key being untranslated, which reads as a
 * finding about the translations. Ask with `find*` when the absence is the
 * question; ask with `localeKeys` when the map's existence is a premise.
 */

/** The map every other locale spreads, and the denominator of every ratio. */
export const TRANSLATION_BASE_LANGUAGE = "en";

/** What one object literal declares: its own keys, and what it spread in. */
export type ParsedObjectLiteral = {
  /** Keys written at the literal's own level, in source order. */
  readonly keys: readonly string[];
  /** Identifiers spread at that level, e.g. `en` for `...en`. */
  readonly spreads: readonly string[];
  /**
   * Each `name:` key's VALUE, trimmed — colon to the comma that ends the entry,
   * or to the end of the body for the last one.
   *
   * The exact span, which is the point. A caller that wants to say something
   * about a value ("this one is a formatter", "it routes `count` through a
   * `?? 0`") otherwise writes `key:[\s\S]*?SHAPE` against the whole map and
   * gets an assertion that is satisfied by the SHAPE appearing under any LATER
   * key — the same lazy-crossing mistake that made the per-locale slice match
   * across maps, one level down. Match against this and the value is all there
   * is to match.
   *
   * Shorthand keys (`{ en, ru }`) are in {@link keys} and not here: they have
   * no value written at this level, and an empty string would be a claim about
   * one.
   */
  readonly values: ReadonlyMap<string, string>;
};

/** A `const <name> = { … }` located in the source. */
export type ObjectLiteralBlock = ParsedObjectLiteral & {
  readonly name: string;
  /** The literal's body — brace-to-brace, exclusive. */
  readonly body: string;
};

/**
 * One locale map located in the source: the text between its braces, plus what
 * that text declares.
 */
export type LocaleBlock = ObjectLiteralBlock & {
  readonly language: string;
  /** True when the map spreads {@link TRANSLATION_BASE_LANGUAGE}. */
  readonly inheritsBase: boolean;
};

/** A `const <name> = [ … ]` located in the source. */
export type ArrayLiteralBlock = {
  readonly name: string;
  /** The literal's body — bracket-to-bracket, exclusive. */
  readonly body: string;
  /** Bodies of the object literals written at the array's own level. */
  readonly elements: readonly string[];
};

/** The character that ends the literal a scan was started on. */
type Closer = "}" | "]";

/** Where a scan stopped: the index of its {@link Closer}, or the source length. */
type ScanEnd = { readonly end: number };

type ScanResult = ParsedObjectLiteral &
  ScanEnd & {
    /** Bodies of the object literals at the scanned literal's own level. */
    readonly elements: readonly string[];
  };

/**
 * After one of these, a `/` is division; anywhere else it opens a regular
 * expression. The standard disambiguation, and the reason it is needed here at
 * all: a value like `(p) => p.name.replace(/}/g, "")` puts a brace inside a
 * regex, and a scanner that reads it as structure ends the literal early and
 * loses every key below it.
 *
 * The `.` is in the class for one shape and one only: a trailing-dot numeric
 * literal. `2. / 2` is a division, and `.` was outside the class, so the `/`
 * opened a regex and ate the rest of its line — `1.5 / 2` escaped it by ending
 * in a DIGIT, which is why the hole stayed invisible while every decimal in
 * the file went through. A `.` can be the token before a `/` in no other valid
 * program (`p./re/` is a syntax error, and no statement begins with a dot), so
 * reading it as end-of-expression is unconditional rather than a guess.
 *
 * What a misread costs, since it decides how much the two rules below have to
 * be right about: {@link skipRegExpLiteral} stops at a NEWLINE, so a `/` read
 * as a regex opener swallows the rest of its line and the scan resyncs on the
 * next one. That bound is why every hazard here is a lost key or two rather
 * than a truncated literal — and it is also why a stale-word bug cannot be
 * caught by counting keys from outside on a file prettier has wrapped.
 *
 * The `.` argument is the third claim in this file that is load-bearing and
 * unassertable, and they are worth naming together because each is defended
 * only by the comment above it:
 *  1. this one — the counter-example (`p./re/`) is a SYNTAX ERROR, so it
 *     cannot be written into a fixture that compiles, and the scanner would
 *     read the fixture the same way whichever side of the class the `.` sat on;
 *  2. the ASI rows of {@link REGEXP_FOLLOWS_KEYWORD} — `break`, `continue` and
 *     `debugger` cost nothing because no valid program puts a `/` on their
 *     line, which is again a statement about the grammar and not about a scan;
 *  3. the newline bound just described — it is why every misread here is
 *     survivable, and a case asserting it would be asserting that a bug this
 *     scanner does not have would have been cheap.
 * A reader tempted to delete any of the three for want of a test should read
 * that absence as the claim being about JavaScript rather than about this file.
 */
const DIVISION_FOLLOWS = /[A-Za-z0-9_$)\]}"'`.]/;

/**
 * One row of {@link REGEXP_FOLLOWS_KEYWORD}: the shape that puts a regex after
 * the word, and — separately — what stands between the two.
 *
 * The separator is its own field because the two claims are not the same one
 * and only one of them is about a division this scanner can get wrong. An
 * `"inline"` row asserts the strong thing: a `/` can follow the word on the
 * SAME line, so a program really can write `return /re/.test(s)` and a scanner
 * reading that `/` as division loses the rest of the line. A `"newline"` row
 * asserts the weak one: the word ends a statement, so the only place its regex
 * can stand is the line below, and the row exists to keep the word out of the
 * "in neither list" hole rather than to describe a hazard.
 *
 * Collapsing them is how the row-shape case quietly stopped checking anything:
 * it matched the word and its regex with a single space until the three ASI
 * rows arrived, then loosened to "any whitespace" for every row at once —
 * after which a `return` row rewritten across a line break would still have
 * passed, and the distinction that decides whether there is a division to get
 * wrong was no longer stated anywhere. With the field, the inline rows are
 * checked strictly again.
 */
export type KeywordRegExpRow = {
  /** A valid fragment in which a regex stands immediately after the word. */
  readonly example: string;
  /** Whether {@link example} separates word from `/` by spaces or a newline. */
  readonly separator: "inline" | "newline";
};

/**
 * …except after one of these words, which end in an identifier character and
 * still leave the grammar expecting an expression — so the one-character rule
 * above calls `return /}/.test(s)` a division and reads the pattern as
 * structure, the exact failure the regex branch exists to prevent, one keyword
 * away. `x / 2` and `returnValue / 2` are still divisions: what matters is the
 * whole word before the slash, not its last letter.
 *
 * The list is derived rather than recalled, because a list written from memory
 * is the kind that is wrong in one row nobody checks. ECMA-262 tokenises with
 * two goal symbols — `InputElementRegExp`, where a `/` starts a
 * `RegularExpressionLiteral`, and `InputElementDiv`, where it is the division
 * operator — and the goal is chosen by whether the grammar is at the START of
 * an expression. `DIVISION_FOLLOWS` approximates "the previous token ended an
 * expression"; a reserved word is where that approximation breaks, so the
 * membership rule is not "is this a keyword" but "can an expression begin
 * immediately after this word".
 *
 * Every row therefore carries the shape that puts one there, and three of them
 * (`extends`, `instanceof`, `new`) are rows the PARSER accepts and the runtime
 * then rejects — which changes nothing here, since a tokeniser has to read the
 * literal either way. Three more (`break`, `continue`, `debugger`) put their
 * regex on the NEXT LINE, because that is the only place one can stand: each
 * ends a statement, so no valid program writes a `/` straight after them, and
 * ASI closes the statement at the line break so the `/re/` below opens a new
 * one. Those three say so in their {@link KeywordRegExpRow.separator}, which is
 * what keeps the other sixteen checkable as the same-line claim they are. A row
 * costs nothing where there is no division to get wrong, and leaving them out
 * is exactly how a word ends up in neither the table nor the audit.
 *
 * Words that end an expression (`this`, `true`, `null`, `super`) are
 * deliberately absent, and so are the ones a punctuator or a binding name
 * always follows: `if`, `while`, `for` and `switch` take a `(`, and a `/`
 * after the matching `)` is the ambiguity this scanner cannot resolve without
 * a parser. Which side each word of the language falls on is checked
 * exhaustively against ECMA-262's `ReservedWord` production in
 * `__tests__/i18n-source.test.ts`, so a word in NEITHER list is a red case
 * rather than an invisible one.
 */
export const REGEXP_FOLLOWS_KEYWORD: Readonly<Record<string, KeywordRegExpRow>> = {
  await: { example: "await /re/.test(s)", separator: "inline" },
  break: { example: "break\n/re/.test(s);", separator: "newline" },
  case: { example: "case /re/.test(s):", separator: "inline" },
  continue: { example: "continue\n/re/.test(s);", separator: "newline" },
  debugger: { example: "debugger\n/re/.test(s);", separator: "newline" },
  default: { example: "export default /re/;", separator: "inline" },
  delete: { example: "delete /re/.lastIndex", separator: "inline" },
  do: { example: "do /re/.test(s); while (next())", separator: "inline" },
  else: { example: "else /re/.test(s);", separator: "inline" },
  extends: { example: "class R extends /re/ {}", separator: "inline" },
  in: { example: '"source" in /re/', separator: "inline" },
  instanceof: { example: "s instanceof /re/", separator: "inline" },
  new: { example: "new /re/()", separator: "inline" },
  of: { example: "for (const m of /re/)", separator: "inline" },
  return: { example: "return /re/.test(s)", separator: "inline" },
  throw: { example: "throw /re/", separator: "inline" },
  typeof: { example: "typeof /re/", separator: "inline" },
  void: { example: "void /re/", separator: "inline" },
  yield: { example: "yield /re/", separator: "inline" },
};

/**
 * Membership is read off the table itself rather than off a `Set` rebuilt from
 * its keys at import: a second structure derived from the first cannot drift on
 * the day it is written and is precisely what a later hand-edit drifts, with
 * every membership case still green — they read the record, and the scanner
 * read the set. `Object.hasOwn` rather than `in`, so a value named
 * `constructor` or `toString` is not a keyword by inheritance.
 */
const followsRegExpKeyword = (word: string): boolean =>
  Object.hasOwn(REGEXP_FOLLOWS_KEYWORD, word);

/**
 * Scans a literal body and reports what it declares at its OWN level.
 *
 * A brace counter is not enough on its own: the values here are strings and
 * template-literal arrow functions, so `{`, `}` and `:` all appear inside text
 * the parser must not read as structure — a ternary in a `${...}` slot
 * (`Number(count) === 1 ? "item" : "items"`) is a colon at what a naive scan
 * would call the top level. The scan therefore tracks string, template,
 * comment and regex context, and treats a template's `${` as a nested code
 * frame, which is what it is.
 *
 * Depth is relative to `start`, so callers pass the index just after the
 * literal's opening brace or bracket and get back the index of the character
 * that closes it.
 */
function scanLiteral(
  source: string,
  start: number,
  close: Closer = "}",
): ScanResult {
  /** Element spans are what {@link findArrayLiteral} wants; nothing reads an
   * object literal's nested values, so they are not collected for one. */
  const collectElements = close === "]";
  const keys: string[] = [];
  const spreads: string[] = [];
  const elements: string[] = [];
  const values = new Map<string, string>();
  /** Frames of `${`-nested code inside template literals; empty = top level. */
  const frames: { readonly depth: number; readonly parens: number }[] = [];
  let depth = 0;
  /**
   * Open `(` at the current level.
   *
   * Brace depth alone was enough while the scan only had to find KEYS: a comma
   * inside a call's arguments set `expectKey` at what the scan called the top
   * level, and the identifier after it was not followed by a `:`, so nothing
   * was recorded and the mistake cost nothing. It stops being free once value
   * SPANS are collected — `(p) => String(p.name).replace(/}/g, "")` ends at
   * that comma, and the value is reported as the text up to it. Parentheses
   * are counted separately from `depth` because the two closers are not
   * interchangeable: a `}` may not close the literal from inside an open call
   * either, which is why {@link atTopLevel} reads both.
   */
  let parens = 0;
  let i = start;
  /** True while the next identifier at the top level would be a key. */
  let expectKey = true;
  /** True while inside a template literal (its `${` slots push a frame). */
  let inTemplate = false;
  /** Start of the top-level object literal currently open, if any. */
  let elementStart: number | null = null;
  /** Last significant character consumed — only the `/` rule reads it. */
  let prev = "";
  /** Last identifier consumed, cleared by any other token. Same reader. */
  let prevWord = "";
  /** The `name:` key whose value is currently being scanned, if any. */
  let valueKey: string | null = null;
  /** Where that value's text began — just past its colon. */
  let valueStart = 0;

  /**
   * Closes the value span open at `at`, if one is.
   *
   * Called from every place a top-level entry can end — the separating comma,
   * the literal's own closer, an unbalanced closer, and the end of the text —
   * because a value that is never closed is a key silently absent from
   * {@link ParsedObjectLiteral.values}, which reads as "no such key" rather
   * than as a scan that stopped early. The LAST entry of a body handed to
   * `parseObjectLiteral` has no comma after it, so the end-of-text call is the
   * ordinary case and not the defensive one.
   */
  const closeValue = (at: number) => {
    if (valueKey === null) return;
    values.set(valueKey, source.slice(valueStart, at).trim());
    valueKey = null;
  };

  /**
   * Records the token just consumed: its last character, and the whole word
   * when the token WAS an identifier. One call rather than two assignments,
   * because the pair has to move together — a branch that recorded the
   * character and forgot the word would leave a stale keyword one token too
   * long, and `return "x" / 2` would open a regex.
   *
   * One call per TOKEN, with one deliberate exception at the bottom of the
   * loop: the tail fires per CHARACTER for the punctuation no branch claims,
   * so `===` is three calls. Harmless — only the last character survives and
   * the word is cleared either way — and it is why an operator needs no branch
   * of its own. Numbers used to ride that same tail (`1_000n` was six calls),
   * which made the invariant false for a whole class of literal that
   * {@link DIVISION_FOLLOWS} then had to be right about one character at a
   * time; they get {@link readNumericLiteral} instead.
   */
  const consumed = (token: string, word = "") => {
    prev = token.length > 0 ? token[token.length - 1] : prev;
    prevWord = word;
  };

  const atTopLevel = () =>
    depth === 0 && parens === 0 && frames.length === 0 && !inTemplate;

  while (i < source.length) {
    const ch = source[i];

    if (inTemplate) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        inTemplate = false;
        consumed("`");
        i += 1;
        continue;
      }
      if (ch === "$" && source[i + 1] === "{") {
        frames.push({ depth, parens });
        depth = 0;
        parens = 0;
        inTemplate = false;
        consumed("{");
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      i = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const closeAt = source.indexOf("*/", i + 2);
      i = closeAt === -1 ? source.length : closeAt + 2;
      continue;
    }
    if (
      ch === "/" &&
      (!DIVISION_FOLLOWS.test(prev) || followsRegExpKeyword(prevWord))
    ) {
      i = skipRegExpLiteral(source, i);
      consumed("/");
      expectKey = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        i += source[i] === "\\" ? 2 : 1;
      }
      i += 1;
      consumed(ch);
      expectKey = false;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      consumed("`");
      i += 1;
      expectKey = false;
      continue;
    }
    if (ch === close && atTopLevel()) {
      closeValue(i);
      return { keys, spreads, values, elements, end: i };
    }
    if (ch === "{" || ch === "[") {
      if (ch === "{" && collectElements && atTopLevel()) elementStart = i + 1;
      depth += 1;
      consumed(ch);
      i += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (depth === 0) {
        // Returning to the template literal whose `${` opened this frame. Any
        // other closer at depth 0 is unbalanced against what the scan was
        // started on, and ends it where it stands.
        if (ch === "}") {
          const frame = frames.pop();
          if (frame !== undefined) {
            depth = frame.depth;
            parens = frame.parens;
            inTemplate = true;
            consumed("}");
            i += 1;
            continue;
          }
        }
        closeValue(i);
        return { keys, spreads, values, elements, end: i };
      }
      depth -= 1;
      if (ch === "}" && depth === 0 && elementStart !== null && atTopLevel()) {
        elements.push(source.slice(elementStart, i));
        elementStart = null;
      }
      consumed(ch);
      i += 1;
      continue;
    }
    if (ch === "(") {
      parens += 1;
      consumed("(");
      i += 1;
      continue;
    }
    if (ch === ")") {
      // Floored at zero: an unbalanced `)` is a scan that was started inside a
      // call, and going negative would make `atTopLevel()` false for the rest
      // of the body — one stray character silencing every key below it.
      if (parens > 0) parens -= 1;
      consumed(")");
      i += 1;
      continue;
    }
    if (ch === ",") {
      if (atTopLevel()) {
        closeValue(i);
        expectKey = true;
      }
      consumed(",");
      i += 1;
      continue;
    }
    if (ch === "." && source.startsWith("...", i)) {
      i += 3;
      const spread = readIdentifier(source, i);
      if (atTopLevel() && spread) spreads.push(spread);
      i += spread.length;
      consumed(spread.length > 0 ? spread : ".");
      expectKey = false;
      continue;
    }
    if (startsNumericLiteral(source, i)) {
      // Read whole rather than character by character, so `consumed()` sees one
      // token and `prev` is the literal's LAST character — which is the one the
      // `/` rule needs: `n` for `1_000n`, `f` for `0x1f`, `5` for `1e5`, and a
      // `.` for `2.`, the trailing-dot form {@link DIVISION_FOLLOWS} carries
      // the `.` for. The tail below reached the same answer by consuming every
      // character in turn; what it did not do is say that a number is a token.
      //
      // Reached for a leading-dot number (`.5`) as well, which is why the test
      // is a helper and not `/[0-9]/`: that `.` must not be mistaken for the
      // member-access dot the identifier branch reads back, and `p.5` is not a
      // program, so a digit after the dot settles it.
      const literal = readNumericLiteral(source, i);
      i += literal.length;
      consumed(literal);
      expectKey = false;
      continue;
    }
    if (isIdentifierStart(ch)) {
      // A word reached through a `.` is a PROPERTY NAME and not a keyword, and
      // the difference is the whole point of the word rule: `p.return` ends an
      // expression, so `p.return / 2` divides, while recording `return` as the
      // last word would open a regex and swallow the rest of that line — the
      // stale-word failure, arriving through a member access rather than
      // through a branch that forgot to clear. `?.` ends in the same `.`.
      //
      // This clause never runs for a NUMBER: a digit is not an identifier
      // start, and the branch above has already taken the whole literal, so
      // `1.5 / 2` reaches the `/` rule with a digit recorded, not a dot. What
      // the two dots share is {@link DIVISION_FOLLOWS}, which is where the
      // trailing-dot literal is handled.
      const afterMemberDot = prev === ".";
      const name = readIdentifier(source, i);
      i += name.length;
      consumed(name, afterMemberDot ? "" : name);
      if (atTopLevel() && expectKey) {
        let j = i;
        while (j < source.length && /\s/.test(source[j])) j += 1;
        if (source[j] === ":") {
          keys.push(name);
          i = j + 1;
          valueKey = name;
          valueStart = i;
          // The second call on this path, and still one per TOKEN: the
          // lookahead consumed a `:` of its own, and a key's colon has to
          // clear the word the same way any other punctuation does —
          // `{ return: 1, half: (p) => p.n / 2 }` divides.
          consumed(":");
        } else if (
          source[j] === "," ||
          source[j] === close ||
          j >= source.length
        ) {
          // Shorthand property: `const translations = { en, ru, be, … }`. The
          // separator is left for the loop, which is what sets `expectKey`, and
          // the end of a body counts as one — `parseObjectLiteral` is handed
          // the text between the braces, so the last entry has no closer.
          keys.push(name);
        }
      }
      expectKey = false;
      continue;
    }
    if (!/\s/.test(ch)) consumed(ch);
    i += 1;
  }

  closeValue(source.length);
  return { keys, spreads, values, elements, end: source.length };
}

/**
 * What one object literal declares, and where it ended. Element spans are not
 * offered: an object scan does not collect them, and a type that carried the
 * field would hand a future reader an empty list instead of a compile error.
 */
function scanObjectBody(source: string, start: number): ParsedObjectLiteral & ScanEnd {
  const { keys, spreads, values, end } = scanLiteral(source, start, "}");
  return { keys, spreads, values, end };
}

/** The object literals written at one array literal's own level, and its end. */
function scanArrayBody(
  source: string,
  start: number,
): { readonly elements: readonly string[] } & ScanEnd {
  const { elements, end } = scanLiteral(source, start, "]");
  return { elements, end };
}

/**
 * Steps over a regex literal, starting at its opening `/`, and returns the
 * index just past its flags.
 *
 * A newline ends the scan: an unterminated regex is a syntax error, and
 * stopping at the line keeps a `/` this heuristic misread from swallowing the
 * rest of the file.
 */
function skipRegExpLiteral(source: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return i;
    if (inClass) {
      if (ch === "]") inClass = false;
      i += 1;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      i += 1;
      continue;
    }
    if (ch === "/") {
      i += 1;
      break;
    }
    i += 1;
  }
  while (i < source.length && /[a-z]/.test(source[i])) i += 1;
  return i;
}

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

/**
 * Every numeric form the language writes, anchored (`y`) so it can only match
 * where the scan already stands. Binary/octal/hex first, because `0x1f` would
 * otherwise be read as the decimal `0` and leave `x1f` behind as an
 * identifier — which is exactly the kind of resync that turns a following `/`
 * into a regex opener.
 *
 * Deliberately permissive about separator placement (`1__0`, `1_` both match).
 * This is a scanner, not a validator: its only job is to consume the run of
 * characters that is one token, and a malformed literal is a compile error
 * long before it reaches here.
 */
const NUMERIC_LITERAL =
  /0[xX][0-9a-fA-F_]+n?|0[oO][0-7_]+n?|0[bB][01_]+n?|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?n?/y;

/**
 * True where a numeric literal begins: a digit, or the `.` of a leading-dot
 * form. The dot is admitted only when a digit follows it, which is what keeps
 * `p.name` and `...en` out — no member access reaches a digit.
 */
function startsNumericLiteral(source: string, at: number): boolean {
  const ch = source[at];
  if (/[0-9]/.test(ch)) return true;
  return ch === "." && /[0-9]/.test(source[at + 1] ?? "");
}

/** The numeric literal starting at `at`, whole. Never empty — callers gate on
 * {@link startsNumericLiteral}, and a lone digit matches. */
function readNumericLiteral(source: string, at: number): string {
  NUMERIC_LITERAL.lastIndex = at;
  const match = NUMERIC_LITERAL.exec(source);
  return match ? match[0] : source[at];
}

function readIdentifier(source: string, at: number): string {
  let end = at;
  while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
  return source.slice(at, end);
}

/**
 * The keys and spreads of one object literal body — the syntax-aware
 * derivation, and the one every count in `lib/i18n-coverage.ts` is measured
 * from.
 */
export function parseObjectLiteral(body: string): ParsedObjectLiteral {
  const { keys, spreads, values } = scanObjectBody(body, 0);
  return { keys, spreads, values };
}

/**
 * The same question answered from FORMATTING: a key is a line indented by
 * exactly two spaces. True of `lib/i18n-context.tsx` because prettier writes it
 * that way, and false of the language in general.
 *
 * This exists to DISAGREE, and is not a parser. It is the second statement of
 * "what does this literal declare", derived from something
 * {@link parseObjectLiteral} does not look at, so the case comparing them can
 * fail: a scanner bug that swallows entries (an unbalanced template, a string
 * quote it mishandles) shows up as a disagreement rather than as a smaller
 * number that still looks plausible. Anything that wants the keys of a literal
 * wants the scanner — this reader is wrong on purpose about packed lines and
 * multi-line templates, and the case at the bottom of its suite proves both.
 */
export function declaredKeysByFormatting(body: string): readonly string[] {
  const keys: string[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^ {2}([A-Za-z_$][A-Za-z0-9_$]*):/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/**
 * Matches a top-level `const <name> = <open>`, with or without a type
 * annotation (`: TranslationMap`, `: Record<AppLanguage, TranslationMap>`,
 * `: { code: AppLanguage; label: string }[]`).
 *
 * Line-anchored, so prose in a doc comment that happens to quote a declaration
 * is not one. The annotation may not cross a newline or contain `=`, which is
 * what keeps a lazy match from running into a later statement's `=`.
 */
function declarationPattern(name: string, open: "{" | "["): RegExp {
  return new RegExp(
    `^\\s*const\\s+${name}\\b[^=\\n]*=\\s*\\${open}`,
    "m",
  );
}

/**
 * Locates `const <name> = {` and reads the literal that follows. Null when
 * there is no such declaration, which is a different finding from a literal
 * that declares nothing.
 */
export function findObjectLiteral(
  source: string,
  name: string,
): ObjectLiteralBlock | null {
  const declaration = declarationPattern(name, "{").exec(source);
  if (!declaration) return null;
  const bodyStart = declaration.index + declaration[0].length;
  const { keys, spreads, values, end } = scanObjectBody(source, bodyStart);
  return { name, body: source.slice(bodyStart, end), keys, spreads, values };
}

/**
 * Locates `const <name> = [` and reads the literal that follows, including the
 * bodies of the object literals written at its own level.
 */
export function findArrayLiteral(
  source: string,
  name: string,
): ArrayLiteralBlock | null {
  const declaration = declarationPattern(name, "[").exec(source);
  if (!declaration) return null;
  const bodyStart = declaration.index + declaration[0].length;
  const { elements, end } = scanArrayBody(source, bodyStart);
  return { name, body: source.slice(bodyStart, end), elements };
}

/**
 * One locale map, with the base-map spread it inherits from named.
 *
 * `const <language> = {` and `const <language>: TranslationMap = {` are both
 * written in this file; the annotation arrived with the shape being locked in
 * and the base map never took it.
 */
export function findLocaleBlock(
  source: string,
  language: string,
): LocaleBlock | null {
  const block = findObjectLiteral(source, language);
  if (!block) return null;
  return {
    ...block,
    language,
    inheritsBase: block.spreads.includes(TRANSLATION_BASE_LANGUAGE),
  };
}

/**
 * The keys one language declares for itself, as a set.
 *
 * This is the question a dozen suites ask of this file — "does this locale
 * translate this key, or is it serving the English one?" — and each of them
 * used to answer it by slicing the map's text and testing `key:` against it.
 * Two ways that goes wrong: the slice ran from one declaration to the next, so
 * a map moved below another took its keys with it; and a substring test finds
 * `deleteItem:` inside a template that mentions it, which is not a declaration.
 *
 * Throws when the language has no map, rather than reporting an empty set: a
 * caller asking about a map that is not there would otherwise see every key
 * reported missing, which reads as a translation finding instead of a renamed
 * or deleted block.
 */
export function localeKeys(
  source: string,
  language: string,
): ReadonlySet<string> {
  const block = findLocaleBlock(source, language);
  if (!block) {
    throw new Error(
      `no \`const ${language}\` translation map in the source — the block was renamed or deleted, not the keys`,
    );
  }
  return new Set(block.keys);
}

/** One row of the in-app language picker. */
export type LanguageOption = {
  readonly code: string;
  /** The language's own name for itself, as the picker shows it. */
  readonly label: string;
};

/**
 * The picker's rows, in picker order — what the UI actually surfaces, and the
 * list four suites check their own tables against.
 *
 * Throws when the declaration is absent or holds no row: every caller is
 * asserting parity WITH this list, and an empty one would turn every such
 * assertion vacuous while still passing.
 */
export function findLanguageOptions(source: string): readonly LanguageOption[] {
  const block = findArrayLiteral(source, "languageOptions");
  if (!block) {
    throw new Error(
      "no `const languageOptions = [` in the source — the picker's rows are what every language table here is checked against",
    );
  }
  const options: LanguageOption[] = [];
  for (const element of block.elements) {
    const code = /\bcode:\s*"([^"]*)"/.exec(element);
    const label = /\blabel:\s*"([^"]*)"/.exec(element);
    if (code && label) options.push({ code: code[1], label: label[1] });
  }
  if (options.length === 0) {
    throw new Error(
      "`languageOptions` parsed to no rows — a vacuous parity check passes against anything",
    );
  }
  return options;
}

/** Just the codes of {@link findLanguageOptions}, in picker order. */
export function languageOptionCodes(source: string): readonly string[] {
  return findLanguageOptions(source).map((option) => option.code);
}
