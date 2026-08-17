import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

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
import { TRANSLATION_LANGUAGES } from "@/lib/i18n-coverage";

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

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

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
