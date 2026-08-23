import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  findOrphanI18nKeys,
  formatOrphanKeyReport,
  indexLocaleDeclarations,
} from "@/lib/check-orphan-i18n-keys";
import { TRANSLATION_LANGUAGES } from "@/lib/i18n-coverage";
import type { ScannedSource } from "@/lib/i18n-key-usage";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The scanner behind `npm run lint:orphan-i18n`.
 *
 * The rule it defends is "a base key nothing reads is dead", and the whole
 * difficulty is the word READS: 43 of this tree's base keys are never written
 * inside a `t(...)` call, because a key can be stored in a table
 * (`labelKey: "sortNameAsc"`), passed to a helper (`pick(t, "crashFallbackTitle")`)
 * or named in the `as` clause of the one dynamic build. So the fixtures below
 * are built around the four forms rather than around the direct call, and the
 * cases that matter most are the ones proving a key reached by an INDIRECT
 * form is not reported.
 *
 * The word READS is now `lib/i18n-key-usage.ts`' to define, and the cases
 * reading it one literal at a time moved to `i18n-key-usage.test.ts` with it.
 * What stays here is the same rule exercised END TO END — through the orphan
 * question, on a translations source — because that is the level the guard
 * fails at, and a lexer case passing while `findOrphanI18nKeys` reports a live
 * key is precisely the disagreement worth catching.
 */

/** A translations source in miniature, with the shape the parser needs. */
const TRANSLATIONS = [
  `const languageOptions: { code: AppLanguage; label: string }[] = [`,
  `  { code: "en", label: "English" },`,
  `  { code: "ru", label: "Русский" },`,
  `];`,
  ``,
  `const en = {`,
  `  greeting: "Hello",`,
  `  sortNameAsc: "Name A-Z",`,
  `  conditionNew: "New",`,
  `  orphan: "Nobody renders me",`,
  `};`,
  ``,
  `const ru: TranslationMap = {`,
  `  ...en,`,
  `  greeting: "Привет",`,
  `  orphan: "Меня никто не рисует",`,
  `};`,
  ``,
].join("\n");

const sources = (...entries: readonly string[]): ScannedSource[] =>
  entries.map((source, index) => ({ file: `app/file-${index}.tsx`, source }));

describe("finding base keys nothing reads", () => {
  it("reports a key no source mentions, and says which locales declare it", () => {
    const findings = findOrphanI18nKeys(
      TRANSLATIONS,
      sources(`t("greeting"); t("sortNameAsc"); t("conditionNew");`),
    );
    assert.deepEqual(findings, [{ key: "orphan", declaredIn: ["ru", "en"] }]);
  });

  it("counts a key stored in a table as read", () => {
    // `lib/item-filters.ts` does exactly this: the key sits in a record and
    // reaches `t()` somewhere else entirely. A `t("…")`-only rule would report
    // it, which is why the rule is about string literals.
    const findings = findOrphanI18nKeys(
      TRANSLATIONS,
      sources(
        `const SORTS = [{ mode: "name-asc", labelKey: "sortNameAsc" }];`,
        `t("greeting"); t("conditionNew"); t("orphan");`,
      ),
    );
    assert.deepEqual(findings, []);
  });

  it("counts a key named in an `as` clause as read", () => {
    // The tree's only dynamic key build spells its union out, which is what
    // makes a hand-maintained allowlist for dynamic keys unnecessary.
    const findings = findOrphanI18nKeys(
      TRANSLATIONS,
      sources(
        "t(`condition${c}` as \"conditionNew\");",
        `t("greeting"); t("sortNameAsc"); t("orphan");`,
      ),
    );
    assert.deepEqual(findings, []);
  });

  it("counts a key passed to a helper as read", () => {
    // `components/crash-fallback.tsx` renders through `pick(t, "key")`.
    const findings = findOrphanI18nKeys(
      TRANSLATIONS,
      sources(`pick(t, "orphan"); t("greeting"); t("sortNameAsc"); t("conditionNew");`),
    );
    assert.deepEqual(findings, []);
  });

  it("still reports a key whose only mention is a plain value", () => {
    // The whole point of the position rule, end to end rather than at the
    // lexer: a source that MENTIONS `orphan` but never in a key position
    // leaves it reported, which is what the first version of this guard got
    // wrong about `you`.
    const findings = findOrphanI18nKeys(
      TRANSLATIONS,
      sources(
        `const fallback = x ?? "orphan";`,
        `t("greeting"); t("sortNameAsc"); t("conditionNew");`,
      ),
    );
    assert.deepEqual(findings.map((f) => f.key), ["orphan"]);
  });

  it("counts a union member on its own line, which is how a wrapped assertion reads", () => {
    // Three of the four `condition*` keys are spelled this way in
    // `components/item-card.tsx`, so a rule that wanted `as "k"` on one line
    // would report them.
    const findings = findOrphanI18nKeys(
      TRANSLATIONS,
      sources(
        `type Condition =\n  | "conditionNew";`,
        `t("greeting"); t("sortNameAsc"); t("orphan");`,
      ),
    );
    assert.deepEqual(findings, []);
  });

  it("reports orphans in base-map order, not alphabetically", () => {
    // A whole dead family reads as a run of adjacent keys, which is how a
    // reader recognises one feature rather than nine unrelated mistakes.
    const findings = findOrphanI18nKeys(TRANSLATIONS, sources(`const nothing = 1;`));
    assert.deepEqual(
      findings.map((f) => f.key),
      ["greeting", "sortNameAsc", "conditionNew", "orphan"],
    );
  });

  it("does not let a comment in a source keep a key alive", () => {
    const findings = findOrphanI18nKeys(
      TRANSLATIONS,
      sources(`// "orphan" was here\nt("greeting"); t("sortNameAsc"); t("conditionNew");`),
    );
    assert.deepEqual(findings.map((f) => f.key), ["orphan"]);
  });

  it("refuses rather than reporting nothing when there is no base map", () => {
    // "No orphans" and "no keys to check" look identical from the outside, and
    // only one of them is a finding about the translations.
    assert.throws(
      () => findOrphanI18nKeys(`const ru: TranslationMap = { a: "1" };`, sources("")),
      /no `const en` map/,
    );
  });

  it("says nothing about keys a locale declares that the base map does not", () => {
    // Out of scope by construction: the denominator is the base map, and a key
    // only `ru` declares is a different finding, made by the coverage suite's
    // "declares no key the base map does not have".
    const extra = TRANSLATIONS.replace(
      `  greeting: "Привет",`,
      `  greeting: "Привет",\n  ruOnly: "только ру",`,
    );
    const findings = findOrphanI18nKeys(
      extra,
      sources(`t("greeting"); t("sortNameAsc"); t("conditionNew"); t("orphan");`),
    );
    assert.deepEqual(findings, []);
  });
});

describe("the locales a finding is attributed to", () => {
  /**
   * The list was six codes written out in a `for` — a fourth copy of a constant
   * the rest of the i18n suites derive. It fails quietly: a seventh language
   * translates the key, the walk never asks that map, and the report says the
   * orphan is a two-line deletion when it is three. So the case adds a locale
   * that is in `TRANSLATION_LANGUAGES` and was not in the old hand-written six.
   */
  it("covers every language the coverage table knows about", () => {
    const withSeventh = [
      TRANSLATIONS,
      `const de: TranslationMap = {`,
      `  ...en,`,
      `  orphan: "Niemand zeichnet mich",`,
      `};`,
      ``,
    ].join("\n");
    const findings = findOrphanI18nKeys(
      withSeventh,
      sources(`t("greeting"); t("sortNameAsc"); t("conditionNew");`),
    );
    assert.deepEqual(findings, [{ key: "orphan", declaredIn: ["ru", "en", "de"] }]);
  });

  it("asks the maps in the order TRANSLATION_LANGUAGES declares", () => {
    // The order is the picker's, and the report prints it verbatim. Pinned
    // because the walk is a `for` over the shared constant now: reordering that
    // constant reorders this, and a reader should find out here rather than in
    // a diff of the guard's output.
    const everyLocale = [
      TRANSLATIONS,
      ...TRANSLATION_LANGUAGES.filter((code) => code !== "en" && code !== "ru").map(
        (code) => `const ${code}: TranslationMap = {\n  ...en,\n  orphan: "x",\n};\n`,
      ),
    ].join("\n");
    const findings = findOrphanI18nKeys(
      everyLocale,
      sources(`t("greeting"); t("sortNameAsc"); t("conditionNew");`),
    );
    assert.deepEqual(findings[0]?.declaredIn, [...TRANSLATION_LANGUAGES]);
  });

  it("is answered from a source parsed once, not once per finding", () => {
    // The old shape took the translations source and called `findLocaleBlock`
    // itself, once per locale per orphan — a 500-key file re-parsed six times a
    // finding, then an array of ~498 keys scanned linearly for each. What
    // replaced it is not a hoisted call that a reader has to keep hoisted: the
    // lookup takes an INDEX and cannot reach a source to re-parse. This case is
    // the sentence that says so, because the guarantee is in a signature nobody
    // reads until they are already changing it.
    const source = stripComments(readRepoFile("lib/check-orphan-i18n-keys.ts"));
    assert.match(
      source,
      /function localesDeclaring\(\s*declarations: LocaleDeclarations,/,
      "localesDeclaring takes the translations source again — it can re-parse per key, which is the shape this replaced",
    );
    // And that the one caller builds it BEFORE the walk rather than inside it.
    // The signature above makes a per-key re-parse impossible; this is the
    // remaining way to pay the cost twice, and it is a statement order, which
    // no type can hold.
    const built = source.indexOf("indexLocaleDeclarations(i18nSource)");
    const walk = source.indexOf("unreadI18nKeys(usage).map");
    assert.ok(built > 0 && walk > built, "the index is built inside the per-key walk rather than before it");
  });

  it("indexes every locale the source declares, and only those", () => {
    const index = indexLocaleDeclarations(TRANSLATIONS);
    // The fixture declares `en` and `ru` and nothing else. A locale that is
    // absent is ABSENT rather than present and empty: "this checkout has no de
    // map" and "de translated nothing" are different facts and would otherwise
    // read the same.
    assert.deepEqual([...index.keys()], ["ru", "en"]);
    assert.equal(index.get("en")?.has("orphan"), true);
    assert.equal(index.get("ru")?.has("sortNameAsc"), false);
    assert.equal(index.get("de"), undefined);
  });

  it("reads the shared constant rather than spelling the codes again", () => {
    // The two cases above are behavioural and NEITHER can catch the regression
    // this exists for, because the hand-written list they replaced held the same
    // six codes in the same order: they pass either way today and diverge only
    // on the run after a seventh language lands, which is the run the guard is
    // supposed to already be right on. The mutation is textual, so the case is.
    const source = stripComments(readRepoFile("lib/check-orphan-i18n-keys.ts"));
    assert.ok(
      source.includes("TRANSLATION_LANGUAGES"),
      "lib/check-orphan-i18n-keys.ts no longer reads TRANSLATION_LANGUAGES — its locale walk is a private list again and will not grow with the picker",
    );
    const spelled = source.match(/\[\s*"(?:ru|en|be|pl|de|es)"\s*,[^\]]*\]/);
    assert.equal(
      spelled,
      null,
      `lib/check-orphan-i18n-keys.ts spells a locale list out again: ${spelled?.[0] ?? ""}`,
    );
  });
});

describe("what the report says", () => {
  it("names every orphan, its locales, and why a green runtime proves nothing", () => {
    const report = formatOrphanKeyReport(
      [{ key: "orphan", declaredIn: ["ru", "en"] }],
      261,
    );
    assert.match(report, /1 base key\(s\)/);
    assert.match(report, /261 scanned file\(s\)/);
    assert.match(report, /orphan — declared in ru, en/);
    // The sentence that stops a reader concluding the guard is wrong because
    // the app renders fine.
    assert.match(report, /still RESOLVES/);
  });

  it("lists every finding rather than the first", () => {
    const report = formatOrphanKeyReport(
      [
        { key: "first", declaredIn: ["en"] },
        { key: "second", declaredIn: ["ru", "en", "de"] },
      ],
      261,
    );
    assert.match(report, /first — declared in en/);
    assert.match(report, /second — declared in ru, en, de/);
  });
});
