/**
 * No suite writes the language list down.
 *
 * WHAT THIS IS ABOUT. `__tests__/helpers/i18n-locales.ts` exists because
 * twenty-odd cases in eleven suites asked "is this key translated everywhere?"
 * by counting matches and asserting six. Its own doc comment gives the reason
 * the count was wrong, and the second half of that reason is the one this file
 * enforces: "the six was a literal. A seventh language turns every one of
 * these cases red at once with 'expected 6, got 7', which reads as the new
 * locale being wrong rather than as twenty assertions needing their number
 * bumped."
 *
 * The helper fixed the call sites it replaced. It did not stop new ones
 * appearing, and by 2026-09-02 there were NINETEEN files carrying the list
 * again — seventeen iterating it against the very source the picker is read
 * from, plus the App Store guide and the translations suite. Every one of them
 * would have gone quiet on a seventh language: not red, not skipped, just
 * silently asking about six of seven.
 *
 * A helper is a thing people can use. This is the thing that makes not using
 * it visible, which is the difference between a cleanup and a rule.
 *
 * WHERE THE LIST IS WRITTEN DOWN: two pins, both against the real file.
 * `i18n-source-file.test.ts` asserts `findLanguageOptions(readI18nSource())`
 * yields exactly those codes, and `i18n-locales-helper.test.ts` asserts the
 * same of `locales()` — the function every migrated suite now calls. They are
 * what every derived list rests on: without them, deriving from the picker
 * would make the whole fleet agree perfectly with a picker that had silently
 * lost a language. A case below re-reads both and fails if either stops
 * pinning, because an exemption for a file that no longer does the job it was
 * exempted for is a hole standing open.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readRepoFile } from "./helpers/repo-file";
import {
  assertExemptionsHonest,
  SUITES_REL,
  suiteCode,
  suiteFiles,
} from "./helpers/suite-files";

/**
 * A locale list written out, in any order.
 *
 * Matched on the CODES rather than on a fixed sequence: the picker's order
 * (`ru` first) and the alphabetical-ish order most of these used (`en` first)
 * are both the same mistake, and a third ordering would be too. Two or more
 * quoted two-letter codes from the set, adjacent, is the shape — short enough
 * to be unambiguous and long enough that an ordinary pair of strings does not
 * trip it.
 */
const LOCALE_CODES = ["en", "ru", "be", "pl", "de", "es"] as const;
const RESTATED = new RegExp(
  `(?:"(?:${LOCALE_CODES.join("|")})",\\s*){3,}"(?:${LOCALE_CODES.join("|")})"`,
);

/**
 * The suites allowed to write the codes out, each because writing them out IS
 * what it does.
 *
 * TWO PINS, and they are the reason the rest may derive. `i18n-source-file.test.ts`
 * asserts `findLanguageOptions(readI18nSource())` yields exactly these codes,
 * and `i18n-locales-helper.test.ts` asserts the same of `locales()` — the
 * function every migrated suite now calls. Without them, deriving from the
 * picker would make the whole fleet agree perfectly with a picker that had
 * silently lost a language.
 *
 * ONE FIXTURE. `i18n-source.test.ts` feeds literal strings to the parser and
 * asserts what comes back, so its codes are a fixture's contents rather than a
 * claim about this app.
 *
 * ONE DIFFERENT POPULATION. `privacy-languages.test.ts` writes out
 * `PrivacyPageLanguageCode` to check the union is exhaustive — the /privacy
 * pages are their own set (`lib/privacy-languages.ts`), and forcing it onto
 * the app picker would assert something neither list claims. It happens to
 * hold the same six today, which is exactly why it needs saying.
 */
const ALLOWED_TO_RESTATE: readonly string[] = [
  "i18n-source-file.test.ts",
  "i18n-locales-helper.test.ts",
  "i18n-source.test.ts",
  "privacy-languages.test.ts",
  "i18n-locale-list-restated.test.ts",
];

describe("the language list is derived, not restated", () => {
  it("no suite writes the locale codes out", () => {
    const offenders = suiteFiles().filter((relative) => {
      if (ALLOWED_TO_RESTATE.includes(relative)) return false;
      return RESTATED.test(suiteCode(relative));
    });
    assert.deepEqual(
      offenders,
      [],
      `these suites restate the language list instead of reading it from the picker via helpers/i18n-locales — a seventh language would leave every one of them silently asking about six: ${offenders.join(", ")}`,
    );
  });

  it("keeps the exemption list to the files that have to say the codes", () => {
    assertExemptionsHonest({
      exemptions: ALLOWED_TO_RESTATE,
      expected: [
        "i18n-source-file.test.ts",
        "i18n-locales-helper.test.ts",
        "i18n-source.test.ts",
        "privacy-languages.test.ts",
        "i18n-locale-list-restated.test.ts",
      ],
      rule: "the restated-locale-list rule",
      stillNeeded: (relative) => RESTATED.test(suiteCode(relative)),
    });
  });

  it("still finds both pins it sends every derived list back to", () => {
    // The exemptions above are only defensible while those files really do pin
    // the codes against the real picker. A rename or a rewrite that dropped
    // either assertion would leave the whole fleet deriving from a picker
    // nothing checks — agreeing perfectly with a list that had lost a language.
    const pins: readonly [string, RegExp][] = [
      ["i18n-source-file.test.ts", /findLanguageOptions\(source\)/],
      ["i18n-locales-helper.test.ts", /locales\(readI18nSource\(\)\)/],
    ];
    for (const [file, shape] of pins) {
      const pin = readRepoFile(SUITES_REL, file);
      assert.match(pin, shape, `${file} no longer reads the real picker`);
      for (const code of LOCALE_CODES) {
        assert.ok(pin.includes(`"${code}"`), `${file} no longer names '${code}'`);
      }
    }
  });

  it("would catch the shape it was written for", () => {
    // A positive control, because the sweep's value is entirely in what it
    // rejects and an over-narrow regex would pass this file happily.
    assert.ok(RESTATED.test('for (const lang of ["en", "ru", "be", "pl", "de", "es"]) {'));
    assert.ok(RESTATED.test('const L = ["ru", "en", "be", "pl", "de", "es"] as const;'));
    assert.ok(RESTATED.test('["en","ru","be","pl"]'.replace(/,/g, ", ")));
  });

  it("leaves an ordinary pair of short strings alone", () => {
    // The rule has to survive next to real code. Two codes is a tuple someone
    // wrote on purpose (a base and a fallback, a pair under test); three or
    // more adjacent is the list.
    assert.ok(!RESTATED.test('const pair = ["en", "ru"];'));
    assert.ok(!RESTATED.test('assert.deepEqual(sorted, ["be", "de"]);'));
  });
});
