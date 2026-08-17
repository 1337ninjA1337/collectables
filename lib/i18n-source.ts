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
 * What a misread costs, since it decides how much the two rules below have to
 * be right about: {@link skipRegExpLiteral} stops at a NEWLINE, so a `/` read
 * as a regex opener swallows the rest of its line and the scan resyncs on the
 * next one. That bound is why every hazard here is a lost key or two rather
 * than a truncated literal — and it is also why a stale-word bug cannot be
 * caught by counting keys from outside on a file prettier has wrapped.
 */
const DIVISION_FOLLOWS = /[A-Za-z0-9_$)\]}"'`]/;

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
 * literal either way. Words that end an expression (`this`, `true`, `null`,
 * `super`) are deliberately absent, and so are the ones a punctuator always
 * follows: `if`, `while`, `for` and `switch` take a `(`, and a `/` after the
 * matching `)` is the ambiguity this scanner cannot resolve without a parser.
 */
export const REGEXP_FOLLOWS_KEYWORD: Readonly<Record<string, string>> = {
  await: 'await /re/.test(s)',
  case: 'case /re/.test(s):',
  default: "export default /re/;",
  delete: "delete /re/.lastIndex",
  do: "do /re/.test(s); while (next())",
  else: "else /re/.test(s);",
  extends: "class R extends /re/ {}",
  in: '"source" in /re/',
  instanceof: "s instanceof /re/",
  new: "new /re/()",
  of: "for (const m of /re/)",
  return: "return /re/.test(s)",
  throw: "throw /re/",
  typeof: "typeof /re/",
  void: "void /re/",
  yield: "yield /re/",
};

const REGEXP_KEYWORDS: ReadonlySet<string> = new Set(
  Object.keys(REGEXP_FOLLOWS_KEYWORD),
);

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
  /** Frames of `${`-nested code inside template literals; empty = top level. */
  const frames: number[] = [];
  let depth = 0;
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

  /**
   * Records the token just consumed: its last character, and the whole word
   * when the token WAS an identifier. One call rather than two assignments,
   * because the pair has to move together — a branch that recorded the
   * character and forgot the word would leave a stale keyword one token too
   * long, and `return "x" / 2` would open a regex.
   */
  const consumed = (token: string, word = "") => {
    prev = token.length > 0 ? token[token.length - 1] : prev;
    prevWord = word;
  };

  const atTopLevel = () => depth === 0 && frames.length === 0 && !inTemplate;

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
        frames.push(depth);
        depth = 0;
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
      (!DIVISION_FOLLOWS.test(prev) || REGEXP_KEYWORDS.has(prevWord))
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
      return { keys, spreads, elements, end: i };
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
            depth = frame;
            inTemplate = true;
            consumed("}");
            i += 1;
            continue;
          }
        }
        return { keys, spreads, elements, end: i };
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
    if (ch === ",") {
      if (atTopLevel()) expectKey = true;
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
    if (isIdentifierStart(ch)) {
      // A word reached through a `.` is a PROPERTY NAME and not a keyword, and
      // the difference is the whole point of the word rule: `p.return` ends an
      // expression, so `p.return / 2` divides, while recording `return` as the
      // last word would open a regex and swallow the rest of that line — the
      // stale-word failure, arriving through a member access rather than
      // through a branch that forgot to clear. `?.` ends in the same `.`.
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

  return { keys, spreads, elements, end: source.length };
}

/**
 * What one object literal declares, and where it ended. Element spans are not
 * offered: an object scan does not collect them, and a type that carried the
 * field would hand a future reader an empty list instead of a compile error.
 */
function scanObjectBody(source: string, start: number): ParsedObjectLiteral & ScanEnd {
  const { keys, spreads, end } = scanLiteral(source, start, "}");
  return { keys, spreads, end };
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
  const { keys, spreads } = scanObjectBody(body, 0);
  return { keys, spreads };
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
  const { keys, spreads, end } = scanObjectBody(source, bodyStart);
  return { name, body: source.slice(bodyStart, end), keys, spreads };
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
