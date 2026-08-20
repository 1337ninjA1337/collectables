import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { translationCoverage } from "@/lib/i18n-coverage";
import {
  REQUIRED_IN_EVERY_LOCALE,
  describeRequiredKeyGap,
  findRequiredKeyGaps,
  translationKeysUsed,
  unknownRequiredKeys,
} from "@/lib/i18n-required-keys";
import { findLocaleBlock, TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The four keys the coverage numbers cannot speak for.
 *
 * `i18n-translation-coverage.test.ts` floors how MUCH each language declares
 * and deliberately gates nothing about which keys — a new English string ships
 * ahead of its five translations, and a rule against that would go red on
 * every feature PR. This suite is the exception that shape leaves open: a
 * short list of keys whose English fallback defeats the key's own purpose, so
 * "it will be translated later" is not an answer for them.
 *
 * All six locales declare all four today, and they did before this suite
 * existed — by hand, and by nobody checking. What is new is that a seventh
 * language, or a hand-edit that drops one, now has to argue with something.
 */

const SOURCE = readI18nSource();
const SETTINGS_SCREEN = readRepoFile("app", "settings.tsx");

describe("REQUIRED_IN_EVERY_LOCALE", () => {
  it("names keys the base map actually has", () => {
    // The failure this closes is the quiet one: `findRequiredKeyGaps` can
    // never report a key no locale inherits, so a typo'd entry reads as every
    // language being in perfect order.
    const base = findLocaleBlock(SOURCE, TRANSLATION_BASE_LANGUAGE);
    assert.ok(base, `no \`const ${TRANSLATION_BASE_LANGUAGE}\` map to check the required keys against`);
    assert.deepEqual(
      unknownRequiredKeys(base.keys),
      [],
      "these keys are required of every locale and the base map does not declare them — a rule about a key that does not exist",
    );
  });

  it("gives every key a reason, not a place on a list", () => {
    for (const [key, reason] of Object.entries(REQUIRED_IN_EVERY_LOCALE)) {
      assert.ok(reason.length >= 40, `${key} is required for a reason shorter than a reason`);
      // The bar for the list, stated as a check rather than left in the
      // header: the argument has to be about the FALLBACK, not about the key
      // being important. Every key in the app is important.
      assert.match(
        reason,
        /fallback|inherit|English/i,
        `${key}'s reason does not say what its English fallback costs, which is the only argument that puts a key on this list`,
      );
    }
  });

  it("keeps the partial-language badge on the list", () => {
    // The irreducible core. These two are the only strings in the app whose
    // whole purpose is to be read by speakers of the four partially translated
    // languages — a badge saying "this language is incomplete", rendered in
    // English, is the fallback demonstrating itself.
    for (const key of ["languagePartial", "languagePartialHint"]) {
      assert.ok(
        key in REQUIRED_IN_EVERY_LOCALE,
        `${key} is the partial-language warning and no longer required of every locale`,
      );
    }
  });

  it("names nothing the app has stopped rendering", () => {
    // The other half of the list being a partition rather than a wish: an
    // entry for a key no screen reads is a rule kept for a surface that left,
    // and it quietly makes the list look longer than it is.
    const rendered = new Set(translationKeysUsed(SETTINGS_SCREEN));
    for (const key of Object.keys(REQUIRED_IN_EVERY_LOCALE)) {
      assert.ok(
        rendered.has(key),
        `${key} is required of every locale and app/settings.tsx no longer renders it — drop the entry, or move it to the screen that does`,
      );
    }
  });
});

describe("findRequiredKeyGaps", () => {
  it("finds nothing when every locale declares every required key", () => {
    assert.deepEqual(
      findRequiredKeyGaps([
        { language: "en", inherited: [] },
        { language: "de", inherited: ["deleteItem", "collectionEmpty"] },
      ]),
      [],
    );
  });

  it("names the language and the key, and carries the reason into the sentence", () => {
    const gaps = findRequiredKeyGaps([
      { language: "en", inherited: [] },
      { language: "de", inherited: ["languagePartial", "deleteItem"] },
    ]);
    assert.deepEqual(gaps, [{ language: "de", key: "languagePartial" }]);
    const said = describeRequiredKeyGap(gaps[0]);
    assert.match(said, /^de inherits `languagePartial` from the base map — /);
    assert.match(said, /written in English/);
  });

  it("groups by key rather than by language, which is the order a fix is made in", () => {
    // One key missing from three locales is one translation task; three keys
    // missing from one locale is three. The report should read the way the
    // work does.
    const gaps = findRequiredKeyGaps([
      { language: "pl", inherited: ["languageSubtitle", "languagePartial"] },
      { language: "de", inherited: ["languagePartial"] },
    ]);
    assert.deepEqual(gaps, [
      { language: "pl", key: "languagePartial" },
      { language: "de", key: "languagePartial" },
      { language: "pl", key: "languageSubtitle" },
    ]);
  });

  it("reports every gap rather than the first", () => {
    const gaps = findRequiredKeyGaps([
      { language: "de", inherited: Object.keys(REQUIRED_IN_EVERY_LOCALE) },
    ]);
    assert.equal(gaps.length, Object.keys(REQUIRED_IN_EVERY_LOCALE).length);
  });

  it("says so when a gap's key carries no reason", () => {
    // Reachable only by a caller building a gap by hand, which the suite above
    // does — the alternative is a sentence with `undefined` in the middle of
    // it, at the exact moment somebody is reading it for an explanation.
    assert.match(
      describeRequiredKeyGap({ language: "de", key: "notOnTheList" }),
      /no reason recorded/,
    );
  });
});

describe("translationKeysUsed", () => {
  it("takes the literal keys and leaves the computed ones", () => {
    const source = `
      <Text>{t("languagePartial")}</Text>
      <Text>{t( "languageSubtitle" )}</Text>
      <Text>{t(option.labelKey)}</Text>
      <Text>{t("languagePartial")}</Text>
    `;
    assert.deepEqual(translationKeysUsed(source), ["languagePartial", "languageSubtitle"]);
  });

  it("does not read a longer identifier ending in t as the helper", () => {
    // `format("x")` and `t("x")` are one character apart in a regex written
    // without a word boundary, and the first is common enough that the audit
    // above would start passing for the wrong reason.
    assert.deepEqual(translationKeysUsed('format("languagePartial")'), []);
  });
});

describe("the committed locale maps", () => {
  it("declare every required key in every language", () => {
    const gaps = findRequiredKeyGaps(translationCoverage(SOURCE));
    assert.deepEqual(
      gaps.map(describeRequiredKeyGap),
      [],
      "a locale is serving one of these from the base map — see lib/i18n-required-keys.ts for why these four cannot wait for the next translation pass",
    );
  });
});
