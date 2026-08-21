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

describe("collecting the literals that sit where a key is written", () => {
  it("finds a literal in each of the five key positions, in either quote", () => {
    // The alternation IS the rule, so every branch of it gets a reading.
    assert.ok(collectStringLiterals(`t("greeting");`).has("greeting"));
    assert.ok(collectStringLiterals(`pick(t, 'greeting');`).has("greeting"));
    assert.ok(collectStringLiterals(`const m = { labelKey: "greeting" };`).has("greeting"));
    assert.ok(collectStringLiterals('t(`x` as "greeting");').has("greeting"));
    assert.ok(collectStringLiterals(`type K =\n  | "greeting";`).has("greeting"));
    assert.ok(collectStringLiterals(`const all = ["other", "greeting"];`).has("greeting"));
  });

  it("does NOT count a literal used as a plain value", () => {
    // The distinction that found the 37th orphan. `you` is declared in all six
    // locales, rendered by nothing, and its only mention in the tree is a
    // default display name — a fallback VALUE, not a key.
    const found = collectStringLiterals(
      `const baseName = user.email?.split("@")[0] ?? "you";`,
    );
    assert.ok(!found.has("you"));
  });

  it("does not count an assignment or a comparison either", () => {
    assert.ok(!collectStringLiterals(`const a = "greeting";`).has("greeting"));
    assert.ok(!collectStringLiterals(`if (x === "greeting") {}`).has("greeting"));
    assert.ok(!collectStringLiterals(`return "greeting";`).has("greeting"));
  });

  it("ignores anything that is not identifier-shaped", () => {
    // Restricted on purpose: matching arbitrary string bodies would pull in
    // every sentence in the tree for hits that can never be keys.
    const found = collectStringLiterals(`t("hello there"); t("with-dash");`);
    assert.equal(found.size, 0);
  });

  it("strips comments first, so prose naming a key does not keep it alive", () => {
    // Without this the guard's own doc comment would resurrect nine of the
    // keys it exists to have removed — and the comment defining the rule names
    // four more.
    const found = collectStringLiterals(`// we removed t("orphan") last week\nconst a = 1;`);
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
