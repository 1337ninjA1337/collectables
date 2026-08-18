import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  declaredKeysByFormatting,
  findArrayLiteral,
  findLanguageOptions,
  findLocaleBlock,
  findObjectLiteral,
  languageOptionCodes,
  localeKeys,
  parseObjectLiteral,
  REGEXP_FOLLOWS_KEYWORD,
} from "@/lib/i18n-source";
import { TRANSLATION_LANGUAGES } from "@/lib/i18n-coverage";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * The one parser for `lib/i18n-context.tsx`, and the shapes it does not read.
 *
 * Four suites parse that file (it pulls React Native peers, so importing it in
 * a node test is not an option) and each of them used to locate declarations
 * its own way — two regexes for `languageOptions` copied between suites, a
 * "slice to the next `const`" for a locale map, a `([^}]+)` for the
 * `translations` record, and a brace scanner. They agreed because the file is
 * formatted the way all four expected. Now they ask this module, and the cases
 * below are where its answers are defended: the inputs that tell a real scan
 * apart from a regex that happens to work, and the shapes it deliberately
 * refuses — asserted absent from the real file rather than assumed absent.
 */

const SOURCE = readI18nSource();

describe("translation literal parser", () => {
  it("reads the keys and the spread of a plain map", () => {
    const parsed = parseObjectLiteral(`
  ...en,
  first: "one",
  second: "two",
`);
    assert.deepEqual(parsed.keys, ["first", "second"]);
    assert.deepEqual(parsed.spreads, ["en"]);
  });

  it("does not read braces inside a string value as structure", () => {
    // The brace-counting version of this parser reported one key here and then
    // ran off the end of the literal looking for a close.
    const parsed = parseObjectLiteral(`
  opener: "a { brace",
  closer: "a } brace",
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["opener", "closer", "after"]);
  });

  it("does not read a template ternary's colon as a key separator", () => {
    // `Number(count) === 1 ? "item" : "items"` is a colon inside a `${}` slot,
    // which a line-oriented scan sees at the literal's own level.
    const parsed = parseObjectLiteral(`
  plural: (params?: TranslationParams) =>
    \`Delete \${params?.count ?? 0} \${Number(params?.count) === 1 ? "item" : "items"}?\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["plural", "after"]);
  });

  it("treats a template's `${}` slot as code rather than as more text", () => {
    // The one input that tells the two readings apart. A slot holding a NESTED
    // template balances either way — backticks come in pairs, so a scan that
    // reads the slot as text still ends the outer literal in the right place by
    // luck. A slot holding a string that CONTAINS a backtick does not: read as
    // text, that backtick closes the outer template, the `}` after it is taken
    // for the literal's own closing brace, and every key below this one
    // disappears from the count without anything looking wrong.
    const parsed = parseObjectLiteral(
      '\n  nested: (p) => `a ${p.n ? "`" : ""} b`,\n  after: "still here",\n',
    );
    assert.deepEqual(parsed.keys, ["nested", "after"]);
  });

  it("does not read a function body's own keys", () => {
    const parsed = parseObjectLiteral(`
  outer: (params?: TranslationParams) => {
    const inner = { nested: 1, alsoNested: 2 };
    return \`\${inner.nested}\`;
  },
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["outer", "after"]);
  });

  it("does not read a URL inside a string as a comment", () => {
    // Real row: `runtimeConfigUrlPlaceholder: "https://your-project.supabase.co"`.
    const parsed = parseObjectLiteral(`
  url: "https://your-project.supabase.co",
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["url", "after"]);
  });

  it("skips comments and escaped quotes", () => {
    const parsed = parseObjectLiteral(`
  // leading: "not a key",
  real: "value",
  /* blockKey: "also not a key" */
  quoted: "she said \\"hi: there\\"",
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["real", "quoted", "after"]);
  });

  it("does not read a brace inside a regex literal as structure", () => {
    // No translation value holds a regex today, which is exactly why the gap
    // was worth closing: `/}/` is one `}` away from ending the literal early
    // and dropping every key below it, and the first `.replace()` in a value
    // would have done it silently.
    const parsed = parseObjectLiteral(`
  tidy: (p) => String(p.name).replace(/}/g, ""),
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["tidy", "after"]);
  });

  it("reads a regex character class holding its own delimiter", () => {
    // `[/}]` puts both the closing delimiter and a brace inside a class, so a
    // scan that ends the regex at the first `/` is left reading `}]+/g` as
    // structure.
    const parsed = parseObjectLiteral(`
  slug: (p) => \`\${String(p.s).replace(/[/}]+/g, "-")}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["slug", "after"]);
  });

  it("reads a division as division, not as an unterminated regex", () => {
    // The other half of the same branch: after an identifier or a `)`, a `/`
    // divides. Read as a regex opener, the scan would swallow to the next `/`
    // — here the second slot's — and lose the keys in between.
    const parsed = parseObjectLiteral(`
  half: (p) => \`\${p.n / 2}\`,
  paren: (p) => \`\${(p.n) / 2}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["half", "paren", "after"]);
  });

  it("opens a regex after a keyword and still divides after an identifier", () => {
    // A keyword ends in an identifier character, so the one-character rule
    // that tells a regex from a division reads `return /}/` as a division and
    // the `}` as structure — closing the function body early and taking every
    // key below it. `returnValue / 2` is the other side of the same rule: what
    // decides is the whole word before the slash, not its last letter.
    const parsed = parseObjectLiteral(`
  guard: (p) => {
    return /}/.test(String(p.s)) ? "1" : "2";
  },
  ratio: (p) => \`\${p.returnValue / 2}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["guard", "ratio", "after"]);
  });

  it("keeps the keyword across whitespace and across a comment", () => {
    // The word before the slash is what decides, and it has to survive what
    // prettier puts between the two — spaces, and a comment it wrapped a long
    // ternary around. The other direction cannot be pinned from out here: a
    // stale word would misread a division as a regex, and `skipRegExpLiteral`
    // stops at the line end, so the scan resyncs on the next line with the
    // count unchanged. That the pair moves together is a property of
    // `consumed()` having one call site per token, not of an assertion.
    const parsed = parseObjectLiteral(`
  spaced: (p) => {
    return  /}/.test(String(p.s)) ? "1" : "2";
  },
  commented: (p) => {
    return /* keep */ /}/.test(String(p.s)) ? "3" : "4";
  },
  divided: (p) => \`\${p.a / p.b}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, [
      "spaced",
      "commented",
      "divided",
      "after",
    ]);
  });

  it("divides after a property whose name happens to be a keyword", () => {
    // The word rule reads the last identifier, and a member access puts a
    // keyword there stripped of everything that made it one: `p.return` ENDS
    // an expression, so the `/` after it divides. Recorded as a keyword it
    // opens a regex instead, and the misread runs to the end of the line —
    // taking the `${}` slot's close, the template and the `,` with it, so the
    // scan spends the rest of the literal inside a frame that never closed and
    // every key below is silently not a key. Same stale-word failure
    // `consumed()` was written to make unreachable, arriving through a member
    // access rather than through a branch that forgot to clear.
    const parsed = parseObjectLiteral(`
  ratio: (p) => \`\${p.return / 2}\`,
  chained: (p) => \`\${p?.of / 2}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["ratio", "chained", "after"]);
  });

  it("divides after a number, including one that ends in its decimal point", () => {
    // Filed as "the member-dot clause is accidentally right about `1.5 / 2`
    // too". It never ran for it: `prev === "."` lives in the identifier branch
    // and a digit never reaches it — `1.5 / 2` divided because it ends in a
    // DIGIT, which `DIVISION_FOLLOWS` has always covered. Which left the shape
    // that ends in the dot itself: `2.` is a legal numeric literal, `2. / 2`
    // is a division, and `.` was outside the character class — so the `/`
    // opened a regex and swallowed the `}` closing the `${}` slot, the
    // template, the `,`, and every key below. Same cost as the keyword hole,
    // reached through a number instead of a word.
    const parsed = parseObjectLiteral(`
  half: (p) => \`\${p.n * 1.5 / 2}\`,
  trailing: (p) => \`\${p.n * 2. / 2}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["half", "trailing", "after"]);
  });

  it("divides after every numeric form, not just the ones ending in a digit", () => {
    // Numbers used to ride the loop's per-character tail, which reached the
    // right answer for the decimal forms by accident of their last character
    // and is why the trailing-dot hole above stayed invisible. They are one
    // token now, and this is the sweep the tail never had: a division after a
    // hex, octal, binary, BigInt, exponent, separator-bearing and leading-dot
    // literal in turn. A form the reader stops short of resyncs mid-token, the
    // `/` opens a regex, and the `}` closing the `${}` slot is swallowed with
    // every key below it.
    const parsed = parseObjectLiteral(`
  hex: (p) => \`\${p.n * 0x1f / 2}\`,
  octal: (p) => \`\${p.n * 0o17 / 2}\`,
  binary: (p) => \`\${p.n * 0b1011 / 2}\`,
  big: (p) => \`\${p.n * 1_000n / 2n}\`,
  exponent: (p) => \`\${p.n * 1e5 / 2}\`,
  signedExponent: (p) => \`\${p.n * 1.5e-3 / 2}\`,
  leadingDot: (p) => \`\${p.n * .5 / 2}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, [
      "hex",
      "octal",
      "binary",
      "big",
      "exponent",
      "signedExponent",
      "leadingDot",
      "after",
    ]);
  });

  it("reads a number as one token without letting its dot look like a member access", () => {
    // The leading-dot form is the reason the numeric branch is gated on a
    // helper rather than on `/[0-9]/`: `.5` starts with the same character a
    // property access does. If the gate ever widened to a bare `.`, `p.return`
    // would stop clearing the recorded word — the stale-keyword failure — and
    // `p.return / 2` would open a regex and eat the rest of its line.
    const parsed = parseObjectLiteral(`
  member: (p) => \`\${p.return / 2}\`,
  spread: (p) => ({ ...p, n: p.n }),
  mixed: (p) => \`\${p.of * .25 / 2}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["member", "spread", "mixed", "after"]);
  });

  it("does not invent a key out of the letters inside a numeric key", () => {
    // The bug the per-character tail was hiding, and the reason reading a
    // number whole is more than a tidy-up. A numeric property name is legal
    // JavaScript and this scanner deliberately does not read one — same family
    // as the quoted and computed keys it declines. But the tail resynced INSIDE
    // the literal: `0x2f:` was consumed as the digit `0`, after which `x2f` hit
    // the identifier branch with `expectKey` still true, found the colon a
    // lookahead away, and was pushed as a key named `x2f`. Not a key it
    // declined to read — a key that is not in the file at all, invented from
    // the middle of a number and reported to every caller counting keys.
    //
    // Every form carrying a letter or an underscore had it: radix prefixes,
    // exponents, BigInt suffixes, separators. Plain `1:` never did, which is
    // why nothing caught it.
    const parsed = parseObjectLiteral(`
  0x2f: "hex",
  1e5: "exponent",
  1_000: "separator",
  0b11n: "big",
  real: "still here",
`);
    assert.deepEqual(parsed.keys, ["real"]);
  });

  it("reads shorthand properties, which is how the translations record is written", () => {
    // `const translations: Record<AppLanguage, TranslationMap> = { en, ru, … }`
    // declares six keys and writes not one colon.
    const parsed = parseObjectLiteral(` en, ru, be, pl, de, es `);
    assert.deepEqual(parsed.keys, ["en", "ru", "be", "pl", "de", "es"]);
  });

  it("stops at the brace that closes the literal", () => {
    const source = `const a = {\n  only: "1",\n};\n\nconst b = {\n  ...en,\n  other: "2",\n};\n`;
    const a = findLocaleBlock(source, "a");
    assert.ok(a);
    assert.deepEqual(a!.keys, ["only"]);
    assert.equal(a!.body.includes("other"), false);
    const b = findLocaleBlock(source, "b");
    assert.deepEqual(b!.keys, ["other"]);
  });

  it("returns null for a language with no map", () => {
    assert.equal(findLocaleBlock(`const en = {\n  a: "1",\n};\n`, "fr"), null);
  });

  it("reads the TranslationMap annotation the non-base maps carry", () => {
    const block = findLocaleBlock(
      `const ru: TranslationMap = {\n  ...en,\n  a: "1",\n};\n`,
      "ru",
    );
    assert.ok(block);
    assert.equal(block!.inheritsBase, true);
    assert.deepEqual(block!.keys, ["a"]);
  });

  it("does not mistake a longer name for the one asked about", () => {
    // `const enabled = {` and `const en = {` differ by a word boundary, and
    // the map this file is measured against is the two-letter one.
    const source = `const enabled = {\n  wrong: "1",\n};\n\nconst en = {\n  right: "2",\n};\n`;
    assert.deepEqual(findObjectLiteral(source, "en")!.keys, ["right"]);
  });

  it("does not read a declaration quoted in a doc comment as a declaration", () => {
    // This repository's modules quote each other's declarations in prose — the
    // header of `lib/i18n-coverage.ts` names ``const en`` twice — so the match
    // is line-anchored and a leading `*` is not whitespace.
    const source = [
      "/**",
      " * The base map is declared as `const en = {` with no annotation.",
      " */",
      "const en = {",
      '  real: "1",',
      "};",
      "",
    ].join("\n");
    assert.deepEqual(findObjectLiteral(source, "en")!.keys, ["real"]);
  });
});

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

  it("is the only structure the scanner reads membership from", () => {
    // The rule used to be a `Set` rebuilt from these keys at import: two
    // structures that could not drift on the day they were written, and whose
    // agreement nothing asserted — so a hand-edited set would have kept every
    // membership case green (they read the record) while changing what the
    // scanner did (it read the set). Membership is `Object.hasOwn` on the
    // record now, and this is what says so: a word the table does not carry
    // divides, INCLUDING the inherited property names `in` would have accepted.
    for (const word of ["constructor", "toString", "valueOf", "hasOwnProperty"])
      assert.ok(!KEYWORDS.includes(word), `\`${word}\` is not a keyword`);

    // A BARE `constructor`, because a word reached through a `.` clears itself
    // and would pass this either way: `constructor in REGEXP_FOLLOWS_KEYWORD`
    // is true through the prototype, so an `in` test here opens a regex and
    // both keys survive. `Object.hasOwn` divides, the `}` closes the literal,
    // and the second key is lost — which is what makes the two spellings
    // tell apart.
    const parsed = parseObjectLiteral(`
  a: (p) => constructor /}/,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["a"]);
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

  it("consults every row, and a word outside the table divides", () => {
    // Each row driven through the scanner, which is what makes the table a
    // rule the code obeys rather than documentation beside it: with the word
    // recognised, `/}/` is a pattern and both keys survive. The control is the
    // same fixture with a non-row word — the `}` is read as the literal's
    // close and everything below it is lost, which is the cost of a row that
    // should be here and is not.
    for (const word of KEYWORDS) {
      const parsed = parseObjectLiteral(`
  a: (p) => ${word} /}/.test(p.s),
  after: "still here",
`);
      assert.deepEqual(parsed.keys, ["a", "after"], `after \`${word}\``);
    }

    const control = parseObjectLiteral(`
  a: (p) => returnValue /}/.test(p.s),
  after: "still here",
`);
    assert.deepEqual(control.keys, ["a"]);
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

describe("translation literal parser — second derivation", () => {
  // The scanner reads syntax; `declaredKeysByFormatting` reads prettier's
  // output. Two statements of "what does this literal declare" that can
  // disagree, which is the point: a scanner bug that swallows entries shows up
  // here rather than as a smaller number that still looks plausible.
  for (const language of TRANSLATION_LANGUAGES) {
    it(`agrees with the formatting derivation for '${language}'`, () => {
      const block = findLocaleBlock(SOURCE, language);
      assert.ok(block, `no '${language}' map`);
      assert.deepEqual(
        [...block!.keys],
        [...declaredKeysByFormatting(block!.body)],
        `the two derivations disagree about what '${language}' declares`,
      );
    });
  }

  it("the two derivations can disagree, so the agreement above is worth asserting", () => {
    // A continuation line inside a multi-line template: the formatting rule
    // reads `fake` as a key, the scanner reads it as text.
    const spanning = "\n  note: `line one\n  fake: still inside the template`,\n";
    assert.deepEqual(parseObjectLiteral(spanning).keys, ["note"]);
    assert.deepEqual(declaredKeysByFormatting(spanning), ["note", "fake"]);

    // And the other direction: two entries on one line, which the formatting
    // rule can only ever see the first of.
    const packed = `\n  first: "one", second: "two",\n`;
    assert.deepEqual(parseObjectLiteral(packed).keys, ["first", "second"]);
    assert.deepEqual(declaredKeysByFormatting(packed), ["first"]);
  });
});

describe("localeKeys — the question a dozen suites ask", () => {
  it("answers with what the language declares, not with what its text mentions", () => {
    // The substring test these suites used to run (`block.includes("k:")`)
    // finds a key named inside another value. `deleteItem:` appears in the
    // template below and is declared nowhere.
    const source = [
      "const ru: TranslationMap = {",
      "  ...en,",
      '  hint: (p) => `use ${p.what} — deleteItem: no`,',
      '  real: "1",',
      "};",
      "",
    ].join("\n");
    const keys = localeKeys(source, "ru");
    assert.deepEqual([...keys].sort(), ["hint", "real"]);
    assert.equal(keys.has("deleteItem"), false);
  });

  it("throws for a language whose map is gone, rather than reporting every key missing", () => {
    assert.throws(
      () => localeKeys(`const en = {\n  a: "1",\n};\n`, "ru"),
      /no `const ru` translation map/,
      "an empty set would report a renamed block as a missing translation for every key",
    );
  });

  it("reads the real maps every suite that calls it depends on", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      assert.ok(localeKeys(SOURCE, language).size > 0, `'${language}' is empty`);
    }
  });
});

describe("the shapes the parser declines to read", () => {
  // Quoted and computed keys are a compile error against `TranslationMap`, so
  // the scanner does not read them — and "no locale map has one" is a fact
  // about the file, which makes it a case rather than a sentence in a doc
  // comment. If one ever lands, the count drops silently and this is the row
  // that says why.
  it("no locale map declares a quoted or computed key", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      const block = findLocaleBlock(SOURCE, language);
      assert.ok(block);
      const offenders = block!.body
        .split("\n")
        .filter((line) => /^ {2}(?:["']|\[)/.test(line));
      assert.deepEqual(
        offenders,
        [],
        `'${language}' declares a key the scanner cannot see: ${offenders.join(" | ")}`,
      );
    }
  });

  it("skips a quoted key rather than guessing at it", () => {
    const parsed = parseObjectLiteral(`
  plain: "1",
  "quoted-key": "2",
  after: "3",
`);
    assert.deepEqual(parsed.keys, ["plain", "after"]);
  });
});

describe("the language picker", () => {
  it("reads the rows the app surfaces, in picker order", () => {
    const options = findLanguageOptions(SOURCE);
    assert.deepEqual(
      options.map((option) => option.code),
      [...TRANSLATION_LANGUAGES],
      "the picker's order is the order the settings screen renders",
    );
    for (const { code, label } of options) {
      assert.ok(label.trim().length > 0, `'${code}' has no label`);
    }
    assert.equal(options[0].label, "Русский");
  });

  it("survives a label the old regex would have ended the array on", () => {
    // The four copies of `= \[([\s\S]*?)\];` stopped at the first `];` in the
    // file, wherever it was. A label containing one drops every row below it —
    // and a parity check against a SHORTER list still passes, because the
    // languages it does compare are all present.
    const source = [
      "const languageOptions: { code: AppLanguage; label: string }[] = [",
      '  { code: "ru", label: "a]; b" },',
      '  { code: "en", label: "English" },',
      "];",
      "",
    ].join("\n");
    assert.deepEqual(languageOptionCodes(source), ["ru", "en"]);
    assert.match(/= \[([\s\S]*?)\];/.exec(source)![1], /"a$/);
  });

  it("reads the array's own rows and not a nested object's", () => {
    const source = [
      "const languageOptions: { code: string; label: string }[] = [",
      '  { code: "ru", label: "Русский", meta: { code: "nested", label: "no" } },',
      "];",
      "",
    ].join("\n");
    assert.deepEqual(languageOptionCodes(source), ["ru"]);
  });

  it("throws rather than reporting an empty picker", () => {
    // Every caller asserts parity WITH this list, so an empty one would make
    // four suites vacuously green.
    assert.throws(
      () => languageOptionCodes("const somethingElse = [1, 2];\n"),
      /no `const languageOptions = \[`/,
    );
    assert.throws(
      () => languageOptionCodes("const languageOptions = [\n];\n"),
      /parsed to no rows/,
    );
  });

  it("finds the array with its type annotation, and none without a declaration", () => {
    assert.ok(findArrayLiteral(SOURCE, "languageOptions"));
    assert.equal(findArrayLiteral(SOURCE, "nothingDeclaredHere"), null);
  });
});
