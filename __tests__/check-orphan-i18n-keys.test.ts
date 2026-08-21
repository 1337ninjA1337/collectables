import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  collectStringLiterals,
  findOrphanI18nKeys,
  formatOrphanKeyReport,
  type ScannedSource,
} from "@/lib/check-orphan-i18n-keys";

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

describe("collecting the string literals a key could hide in", () => {
  it("finds identifier-shaped literals in either quote", () => {
    const found = collectStringLiterals(`const a = "greeting"; const b = 'farewell';`);
    assert.ok(found.has("greeting"));
    assert.ok(found.has("farewell"));
  });

  it("ignores anything that is not identifier-shaped", () => {
    // Restricted on purpose: matching arbitrary string bodies would pull in
    // every sentence in the tree for hits that can never be keys.
    const found = collectStringLiterals(`const a = "hello there"; const b = "with-dash";`);
    assert.equal(found.size, 0);
  });

  it("strips comments first, so prose naming a key does not keep it alive", () => {
    // Without this the guard's own doc comment would resurrect nine of the
    // keys it exists to have removed.
    const found = collectStringLiterals(`// we removed "orphan" last week\nconst a = 1;`);
    assert.ok(!found.has("orphan"));
  });

  it("does not treat an identifier as a literal", () => {
    // The distinction that found the 36th orphan: `(profileId: string)` is a
    // parameter, not a mention of the key `profileId`.
    const found = collectStringLiterals(`function f(profileId: string) { return profileId; }`);
    assert.ok(!found.has("profileId"));
  });
});

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
