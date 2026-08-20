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
} from "@/lib/i18n-source";
import { REGEXP_FOLLOWS_KEYWORD } from "@/lib/js-tokens";
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
    // A URL-valued row, e.g. `emailPlaceholder: "you@example.com"` — the `//`
    // inside the string must not be read as the start of a comment.
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

  it("reports each key's value as its exact span, not as text up to a guess", () => {
    // The reason the scanner keeps spans at all: a caller saying something
    // about a value ("this one is a formatter", "it routes count through a
    // `?? 0`") otherwise writes `key:[\s\S]*?SHAPE` against the whole map,
    // which is satisfied by the shape appearing under any LATER key. Given the
    // span, the value is all there is to match — so the assertions below are
    // deliberately anchored at both ends.
    const parsed = parseObjectLiteral(`
  plain: "one",
  fn: (params?: TranslationParams) =>
    \`Delete \${params?.count ?? 0} \${Number(params?.count) === 1 ? "item" : "items"}?\`,
  last: "end",
`);
    assert.deepEqual([...parsed.values.keys()], ["plain", "fn", "last"]);
    assert.equal(parsed.values.get("plain"), '"one"');
    assert.match(parsed.values.get("fn")!, /^\(params\?: TranslationParams\) =>/);
    assert.match(parsed.values.get("fn")!, /items"\}\?`$/);
    // The last entry has no comma after it — `parseObjectLiteral` is handed the
    // text between the braces, so end-of-body is the ordinary terminator and
    // not the defensive one.
    assert.equal(parsed.values.get("last"), '"end"');
  });

  it("does not end a value at a comma inside its own call arguments", () => {
    // Brace depth alone was enough while only KEYS were collected: a comma in
    // an argument list set `expectKey` at what the scan called the top level,
    // the identifier after it was not followed by a `:`, and nothing was
    // recorded. Value spans made it cost something — `replace(/}/g, "")` ends
    // at that comma and the value is reported as the text up to it, silently
    // truncated mid-call. Parentheses are counted now, separately from braces.
    const parsed = parseObjectLiteral(`
  tidy: (p) => String(p.name).replace(/}/g, ""),
  joined: (p) => [p.a, p.b].join(", "),
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["tidy", "joined", "after"]);
    assert.equal(parsed.values.get("tidy"), '(p) => String(p.name).replace(/}/g, "")');
    assert.equal(parsed.values.get("joined"), '(p) => [p.a, p.b].join(", ")');
  });

  it("gives a shorthand key no value rather than an empty one", () => {
    // `{ en, ru }` declares keys and writes no colon, so there is no value at
    // this level to report. An empty string would be a claim about one.
    const parsed = parseObjectLiteral(` en, ru, named: "x" `);
    assert.deepEqual(parsed.keys, ["en", "ru", "named"]);
    assert.deepEqual([...parsed.values.keys()], ["named"]);
    assert.equal(parsed.values.has("en"), false);
  });

  it("keeps a value's own braces and parens out of the literal's structure", () => {
    // The span is taken from the same scan that finds the keys, so everything
    // the scanner already refuses to read as structure — strings, templates,
    // regexes, nested objects — stays inside the value it belongs to.
    const parsed = parseObjectLiteral(`
  nested: (p) => ({ a: 1, b: 2 }),
  regexy: (p) => /a,b/.test(p.s) ? "1" : "2",
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["nested", "regexy", "after"]);
    assert.equal(parsed.values.get("nested"), "(p) => ({ a: 1, b: 2 })");
    assert.equal(parsed.values.get("regexy"), '(p) => /a,b/.test(p.s) ? "1" : "2"');
  });

  it("declares a value for every key of every real locale map", () => {
    // Against the file rather than a fixture: a key with no span would be a
    // scan that stopped early, and it would reach callers as "this locale does
    // not declare that key" — a translation finding, not a parser bug.
    for (const language of TRANSLATION_LANGUAGES) {
      const block = findLocaleBlock(SOURCE, language);
      assert.ok(block, `no map for ${language}`);
      const withoutValue = block!.keys.filter((key) => !block!.values.has(key));
      assert.deepEqual(withoutValue, [], `${language}: keys with no value span`);
      assert.equal(block!.values.size, block!.keys.length);
      for (const [key, value] of block!.values) {
        assert.ok(value.length > 0, `${language}.${key} has an empty value`);
      }
    }
  });

  it("does not read a parenthesised annotation's colon as a key", () => {
    // True before the paren counter and true after it, for different reasons,
    // which is why it is worth writing down. It used to hold because
    // `expectKey` is false once a value has begun — an accident of where the
    // arrow sits. It now holds structurally: `atTopLevel()` reads the paren
    // count, so nothing inside a call or a parameter list is at the literal's
    // own level whatever `expectKey` says.
    const parsed = parseObjectLiteral(`
  fn: (params?: TranslationParams) => \`\${params?.count ?? 0}\`,
  after: "still here",
`);
    assert.deepEqual(parsed.keys, ["fn", "after"]);
    assert.ok(!parsed.keys.includes("params"));
  });

  it("gives every `name:` key a value, across the shapes that could truncate one", () => {
    // The agreement between `keys` and `values` is the invariant the span
    // collector has to hold: a key with no value is a scan that stopped early,
    // and it reaches a caller as "this locale does not declare that key" — a
    // translation finding rather than a parser bug. Swept over the shapes that
    // put a terminator inside a value, since those are the ones that truncate.
    const bodies = [
      '  a: "one",\n  b: "two",\n',
      '  trailing: "no comma after me"\n',
      "  call: (p) => [p.a, p.b].join(\", \"),\n  after: \"x\",\n",
      '  regexy: (p) => /a,b/.test(p.s),\n  after: "x",\n',
      '  nested: (p) => ({ a: 1, b: 2 }),\n  after: "x",\n',
      "  tpl: (p) => `a ${p.n ? \"}\" : \"\"} b`,\n  after: \"x\",\n",
      '  ...en,\n  spread: "after a spread",\n',
    ];
    for (const body of bodies) {
      const parsed = parseObjectLiteral(body);
      const withoutValue = parsed.keys.filter((key) => !parsed.values.has(key));
      assert.deepEqual(withoutValue, [], `keys with no value span in: ${body}`);
      assert.equal(parsed.values.size, parsed.keys.length);
    }
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
 * The scanner obeying the table, which is a fact about this parser.
 *
 * The table itself — its row shapes, the ECMA-262 partition, the reserved-word
 * authority the two sides are derived from — is audited in
 * `__tests__/js-tokens.test.ts`, beside the module that holds it. What belongs
 * here is the pair of cases that drive `parseObjectLiteral` over every row: a
 * table nobody consults is documentation, and these are what make it a rule
 * this scanner obeys.
 */
describe("the keyword table, as this scanner reads it", () => {
  const KEYWORDS = Object.keys(REGEXP_FOLLOWS_KEYWORD);

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
