import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DIVISION_FOLLOWS,
  REGEXP_FOLLOWS_KEYWORD,
  followsRegExpKeyword,
  opensRegExp,
} from "@/lib/js-tokens";

import { readRepoFile } from "./helpers/repo-file";

/**
 * `lib/js-tokens.ts` — the regex-versus-division rule, audited on its own.
 *
 * The audit was written where the rule was: inside `__tests__/i18n-source.
 * test.ts`, because `lib/i18n-source.ts` is the scanner that needed the answer
 * first and paid for it. The rule moved out to its own module when
 * `stripComments` turned out to need the same answer; the ~250 lines checking
 * it did not, so the table had an exhaustive ECMA-262 audit and no suite named
 * after it — a reader opening `js-tokens.ts` found nothing, and a reader
 * deleting the i18n parser would have taken the audit for two callers with it.
 *
 * What stayed behind in `i18n-source.test.ts` is the pair of cases that drive
 * `parseObjectLiteral` over every row: those assert that a CALLER obeys the
 * table, which is a fact about the scanner and not about the table. This file
 * is the table and the two exports read off it.
 */

/** The module's own text, for the two claims that are about how it is written. */
const SOURCE = readRepoFile("lib/js-tokens.ts");

/**
 * The keyword list was fourteen entries written from memory, and one of them
 * was exercised. A list recalled rather than derived is wrong in the row nobody
 * checks, so it is a table now — each row carrying the shape that puts a regex
 * after the word — and these cases check it against the rule it is derived
 * from (can an expression BEGIN after this word) rather than against the same
 * memory that produced it.
 */
/**
 * ECMA-262 §12.7.2, the `ReservedWord` production, verbatim and alphabetical.
 * The independent authority the table is audited against: `REGEXP_FOLLOWS_KEYWORD`
 * says which words let a regex follow, and a list derived from the same memory
 * could only ever confirm it.
 */
const RESERVED_WORDS: readonly string[] = [
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
];

/**
 * Words that are ordinary identifiers except inside one production. They are
 * not reserved — `const from = 1` is legal — so `ReservedWord` does not cover
 * them, and one of them (`of`) is a table row, which is why the partition has
 * to reach past the spec's list. Scoped to the ones that can stand as the word
 * immediately before a `/`; a modifier like `implements` or `package` only
 * appears in positions where a `/` cannot follow at all.
 *
 * This list is the recall problem one level down, and cannot be fixed the way
 * the reserved half was: `RESERVED_WORDS` is a spec production and is
 * exhaustive by construction, while these eight are a judgement call, so the
 * exhaustiveness case proves the partition covers `RESERVED_WORDS ∪
 * CONTEXTUAL_KEYWORDS` and says nothing about whether that union is the
 * language. What can be done is to name the productions that were read, so an
 * omission is reviewable instead of invisible — a word from a production NOT on
 * this list is the shape of the next hole:
 *  - `ForInOfStatement` (§14.7.5) — `of`, and `await` in `for await`;
 *  - `MethodDefinition` accessor names (§15.4) — `get`, `set`;
 *  - `ImportDeclaration` / `ExportDeclaration` clauses (§16.2) — `as`, `from`;
 *  - `AsyncFunctionDefinitions` (§15.8) — `async`;
 *  - `ClassElement` modifiers (§15.7) — `static`;
 *  - `LexicalDeclaration` (§14.3.1) — `let`.
 * Deliberately not consulted, because no `/` can stand after the word in them:
 * the strict-mode `FutureReservedWord` modifiers (`implements`, `interface`,
 * `package`, `private`, `protected`, `public`), and `accessor`, which takes a
 * class element name.
 */
const CONTEXTUAL_KEYWORDS: readonly string[] = [
  "as",
  "async",
  "from",
  "get",
  "let",
  "of",
  "set",
  "static",
];

/**
 * The other side of the partition: every word of the language that is NOT a
 * table row, and the reason a `/` after it is a division (or cannot occur).
 * A record rather than a list, because the reason is the part worth reviewing
 * — "it is not a keyword" is not a reason, and half of these ARE keywords.
 */
const DIVIDES_AFTER: Readonly<Record<string, string>> = {
  as: "an import/export clause follows it with a binding name",
  async: "an identifier here, or `function`/`(` — never a regex",
  catch: "takes a `(` or a `{`",
  class: "takes a name, a `{`, or `extends`",
  const: "takes a binding name",
  enum: "reserved with no production at all",
  export: "takes a declaration, a `{`, a `*`, or `default` — which is the row",
  false: "ends an expression",
  finally: "takes a `{`",
  for: "takes a `(` (or `await`, which is the row)",
  from: "an identifier, or a module specifier string",
  function: "takes a name or a `(`",
  get: "an identifier, or an accessor's property name",
  if: "takes a `(`",
  import: "takes a specifier, a `(`, or a `.`",
  let: "takes a binding name, and is an identifier everywhere else",
  null: "ends an expression",
  set: "an identifier, or an accessor's property name",
  static: "takes a class element name",
  super: "ends an expression",
  switch: "takes a `(`",
  this: "ends an expression",
  true: "ends an expression",
  try: "takes a `{`",
  var: "takes a binding name",
  while: "takes a `(`",
  with: "takes a `(`",
};

describe("the keyword table the regex rule is read from", () => {
  const ROWS = Object.entries(REGEXP_FOLLOWS_KEYWORD);
  const KEYWORDS = Object.keys(REGEXP_FOLLOWS_KEYWORD);

  it("shows, for every row, a regex standing where the word puts one", () => {
    // A row whose example does not put a `/` after its own word is a row
    // somebody added on the strength of it being a keyword. Each row is checked
    // against the separator it DECLARES rather than against `\s*`, which is
    // where this case had drifted: `\s*` was adopted so the three ASI rows
    // would pass and it loosened all nineteen at once, after which a `return`
    // row rewritten across a line break would still have been green — and
    // whether a `/` can stand on the word's own line is the only part of a row
    // that describes a division this scanner can get wrong.
    for (const [word, row] of ROWS) {
      const between = row.separator === "inline" ? " +" : "\\n";
      assert.match(
        row.example,
        new RegExp(`\\b${word}${between}/re/`),
        `\`${word}\` row does not show a regex standing ${row.separator} after the word: ${row.example}`,
      );
    }
  });

  it("declares a separator per row, and the newline ones are the statement-enders", () => {
    // The weak claim has to stay rare and stay justified: a `"newline"` row
    // says only that the word cannot be followed by a `/` on its own line, so
    // the row is there to keep the word out of the "in neither list" hole
    // rather than to describe a hazard. Exactly three words in the language
    // qualify — the ones that END a statement and take no operand — and any
    // future row that reaches for `"newline"` to avoid writing a same-line
    // example turns this red.
    const newline = ROWS.filter(([, row]) => row.separator === "newline").map(
      ([word]) => word,
    );
    assert.deepEqual(newline, ["break", "continue", "debugger"]);
    for (const [word, row] of ROWS) {
      assert.ok(
        row.separator === "inline" || row.separator === "newline",
        `\`${word}\` declares an unknown separator`,
      );
      assert.equal(typeof row.example, "string");
    }
  });

  it("checks the inline rows strictly enough to catch a reformatted example", () => {
    // The point of the field, stated as the mutation it catches: taking any
    // inline row's example and breaking the line — which the old `\s*` match
    // accepted — must now fail, because the row still claims `"inline"`.
    for (const [word, row] of ROWS) {
      if (row.separator !== "inline") continue;
      const reformatted = row.example.replace(`${word} /re/`, `${word}\n/re/`);
      assert.notEqual(
        reformatted,
        row.example,
        `\`${word}\` inline row does not write its regex a space after the word`,
      );
      assert.doesNotMatch(reformatted, new RegExp(`\\b${word} +/re/`));
    }
  });


  it("is lowercase and alphabetical, so a new row lands where it is looked for", () => {
    // Duplicates cannot survive an object literal, which is half the reason
    // this stopped being a `Set([...])` of bare strings.
    assert.deepEqual(KEYWORDS, [...KEYWORDS].sort());
    for (const word of KEYWORDS) assert.match(word, /^[a-z]+$/);
  });

  it("leaves out every other word of the language, with a reason each", () => {
    // The exclusions used to be two hand-typed lists, which is the same recall
    // problem the table itself escaped one level up: a word in NEITHER list is
    // invisible — no case mentions it, so nothing says whether a `/` after it
    // divides or opens. Both sides are read off one authority now
    // ({@link RESERVED_WORDS}), and the exhaustiveness case below is what makes
    // an unclassified word red rather than absent.
    for (const [word, reason] of Object.entries(DIVIDES_AFTER)) {
      assert.ok(!KEYWORDS.includes(word), `\`${word}\` is a row: ${reason}`);
    }
  });

  it("partitions ECMA-262's reserved words, and the contextual ones, in two", () => {
    // Exhaustive AND disjoint: every word of the language is either a row (an
    // expression can begin after it) or an exclusion carrying why it cannot
    // be, and none is both. Adding a row without deleting its exclusion, or
    // adding a word to neither, turns this red — which is the whole point of
    // deriving the two sides from one list instead of recalling each.
    const classified = [...KEYWORDS, ...Object.keys(DIVIDES_AFTER)].sort();
    const language = [...RESERVED_WORDS, ...CONTEXTUAL_KEYWORDS].sort();
    assert.deepEqual(classified, language);
    assert.equal(new Set(classified).size, classified.length);
  });

  it("holds the reserved-word list ECMA-262 states, not one filtered to taste", () => {
    // The authority both sides are derived from, pinned so a future edit
    // cannot make the partition exhaustive by deleting the word that broke it.
    // 38 entries is the `ReservedWord` production of §12.7.2 verbatim.
    assert.equal(RESERVED_WORDS.length, 38);
    assert.deepEqual([...RESERVED_WORDS], [...RESERVED_WORDS].sort());
    assert.equal(new Set(RESERVED_WORDS).size, RESERVED_WORDS.length);
    for (const word of ["enum", "with", "debugger", "await", "yield"]) {
      assert.ok(RESERVED_WORDS.includes(word), `\`${word}\` is reserved`);
    }
    // `of` is the reason the contextual list has to exist at all: it is a row,
    // and it is not a reserved word — `const of = 1` is legal.
    assert.ok(!RESERVED_WORDS.includes("of"));
    assert.ok(CONTEXTUAL_KEYWORDS.includes("of"));
    assert.ok(KEYWORDS.includes("of"));
  });


  it("carries the three rows the parser accepts and the runtime does not", () => {
    // `new /re/()`, `s instanceof /re/` and `class R extends /re/ {}` all
    // throw when they run, and all three are still regex literals a tokeniser
    // has to read past. Pinned because "that would crash" is exactly the
    // argument for deleting them from the table.
    for (const word of ["extends", "instanceof", "new"]) {
      assert.ok(KEYWORDS.includes(word), `\`${word}\` row missing`);
    }
  });
});

describe("DIVISION_FOLLOWS — the one-character half of the rule", () => {
  /**
   * The constant had no cases of its own anywhere: it shipped inside the i18n
   * scanner, where every claim about it was made through a parse, and moved
   * here with the same silence. Two callers now branch on it directly, and the
   * character set is the kind of thing an edit widens by one bracket.
   */
  it("covers every character class that can END an expression", () => {
    // One assertion per reason a character is in the set, so a deletion says
    // which grammar fact it broke rather than "the regex changed".
    const ENDS_AN_EXPRESSION: Readonly<Record<string, string>> = {
      a: "an identifier",
      Z: "an identifier",
      "7": "a numeric literal",
      _: "an identifier",
      $: "an identifier",
      ")": "a parenthesised expression, or a call's argument list",
      "]": "an index or an array literal",
      "}": "an object literal, or a template's substitution",
      '"': "a string literal",
      "'": "a string literal",
      "`": "a template literal",
      ".": "a numeric literal written `2.` — the trailing-dot form",
    };
    for (const [char, why] of Object.entries(ENDS_AN_EXPRESSION)) {
      assert.ok(DIVISION_FOLLOWS.test(char), `\`${char}\` ends an expression: ${why}`);
    }
  });

  it("leaves out the characters after which a regex can begin", () => {
    // The other side, and the one that decides whether a pattern is read as
    // one: after any of these the grammar wants an expression, so a `/` opens
    // a literal. A character wrongly ADDED here makes the scanner read a
    // pattern as structure — the failure both callers exist to avoid.
    for (const char of ["(", "[", "{", ",", ";", "=", "+", "-", "*", "/", "<", ">", "!", "&", "|", "?", ":", "%", "^", "~"]) {
      assert.ok(!DIVISION_FOLLOWS.test(char), `a regex can begin after \`${char}\``);
    }
    // Whitespace is not in the set either, and must not be: the callers track
    // the last NON-space character precisely so a space cannot answer this.
    for (const char of [" ", "\n", "\t"]) {
      assert.ok(!DIVISION_FOLLOWS.test(char), "whitespace is not a token");
    }
  });

  it("is a single-character test, not an anchored one", () => {
    // `test` on a multi-character string would search it, which is not what
    // either caller means — both pass exactly one character. Pinned so an
    // edit that anchors the pattern (or drops the character class for a
    // string compare) has to notice the callers pass a single char.
    assert.equal(DIVISION_FOLLOWS.source.startsWith("["), true);
    assert.equal(DIVISION_FOLLOWS.flags, "");
  });
});

describe("followsRegExpKeyword — membership, read off the table itself", () => {
  it("answers yes for every row and no for an ordinary identifier", () => {
    for (const word of Object.keys(REGEXP_FOLLOWS_KEYWORD)) {
      assert.ok(followsRegExpKeyword(word), `\`${word}\` is a row`);
    }
    for (const word of ["returnValue", "x", "s", "newValue", "typeofX", ""]) {
      assert.ok(!followsRegExpKeyword(word), `\`${word}\` is not a keyword`);
    }
  });

  it("uses Object.hasOwn, so an inherited property name is not a keyword", () => {
    // The reason the function exists rather than a bare `word in TABLE`: `in`
    // walks the prototype, so `constructor`, `toString` and `valueOf` would
    // all report as keywords and a `/` after any of them would be read as a
    // pattern. `lib/i18n-source.ts`'s suite drives the consequence through the
    // parser; this is the property on its own.
    for (const word of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      assert.ok(!followsRegExpKeyword(word), `\`${word}\` is inherited, not a row`);
    }
  });

  it("is the only structure membership is read from", () => {
    // A `Set` rebuilt from these keys at import is two structures that cannot
    // drift on the day they are written and is precisely what a later hand
    // edit drifts — with every membership case still green, because they read
    // the record and the scanner read the set.
    assert.doesNotMatch(SOURCE, /new Set\(/);
    assert.match(SOURCE, /Object\.hasOwn\(REGEXP_FOLLOWS_KEYWORD, word\)/);
  });
});


describe("opensRegExp — the rule both scanners branch on", () => {
  it("opens after a character no expression can end with", () => {
    for (const prev of ["(", "[", "{", ",", ";", "=", "+", "!", "?", ":", "&", "|", ""]) {
      assert.ok(opensRegExp(prev, ""), `a regex can begin after \`${prev}\``);
    }
  });

  it("divides after a character that ends an expression", () => {
    for (const prev of ["a", "7", ")", "]", "}", '"', "'", "`", ".", "_", "$"]) {
      assert.ok(!opensRegExp(prev, ""), `\`${prev}\` ends an expression`);
    }
  });

  it("opens after a keyword even though the keyword ends in an identifier character", () => {
    // The whole reason the word half exists: `return` ends in `n`, which
    // `DIVISION_FOLLOWS` covers, and `return /}/.test(s)` is still a pattern.
    for (const word of ["return", "typeof", "case", "of", "in", "new"]) {
      assert.ok(opensRegExp(word[word.length - 1], word), `\`${word}\` puts a regex after it`);
    }
  });

  it("takes an EMPTY word for a name reached through a `.`, and that is the caller's job", () => {
    // The function cannot see where a token began, so a caller that records
    // `return` for `p.return` gets a regex — which is what `stripComments` did
    // until the member-dot flag landed. Stated here as the contract rather
    // than left implicit in two loops.
    assert.ok(opensRegExp("n", "return"));
    assert.ok(!opensRegExp("n", ""));
  });

  it("is what both scanners call, rather than each spelling the rule", () => {
    for (const caller of ["lib/strip-comments.ts", "lib/i18n-source.ts"]) {
      const source = readRepoFile(caller);
      assert.match(source, /\bopensRegExp\(prev, prevWord\)/, `${caller} does not call the rule`);
      assert.doesNotMatch(
        source,
        /!DIVISION_FOLLOWS\.test\(prev\)/,
        `${caller} still spells the rule out`,
      );
    }
  });
});
