import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocale,
  assertMatchesInEveryNonBaseLocale,
  assertValueInEveryLocale,
  localeBodies,
  localeValuesOf,
  localeStrings,
  locales,
} from "./helpers/i18n-locales";
import { localeKeys } from "@/lib/i18n-source";

/** A locale's own declared keys, as an array — `localeKeys` returns a Set. */
const localeKeysOf = (source: string, code: string): readonly string[] => [
  ...localeKeys(source, code),
];

/**
 * The helpers that replaced "count the hits, assert six".
 *
 * Twenty-two cases in eleven suites asked "is this key translated everywhere?"
 * by matching `key:` against the whole of `lib/i18n-context.tsx` and asserting
 * the count was 6. It reads as a parity check and it is a SUM: any arrangement
 * adding to six satisfies it, so a key declared twice in one locale and
 * missing from another passed — which is exactly the state the check existed
 * to find. The fixtures below are built to be green under the old rule and red
 * under the new one, because "stronger" is a claim that has to be shown rather
 * than asserted.
 */

/**
 * A translations file in miniature: two locales in the picker, and a base map
 * the second spreads. Real enough for the parser, small enough to state the
 * whole disagreement in one screen.
 */
const TWO_LOCALES = `
const languageOptions: { code: AppLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
];

const en = {
  greeting: "Hello",
  farewell: "Bye",
};

const ru: TranslationMap = {
  ...en,
  greeting: "Привет",
  farewell: "Пока",
};
`;

/**
 * The arrangement the count could not see: `en` declares `greeting` twice, `ru`
 * declares it not at all. Two hits, two locales — the old rule's sum is
 * satisfied and `ru` silently serves the English string.
 */
const SUMS_BUT_DOES_NOT_COVER = `
const languageOptions: { code: AppLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
];

const en = {
  greeting: "Hello",
  greeting: "Hello again",
};

const ru: TranslationMap = {
  ...en,
  farewell: "Пока",
};
`;

describe("asking each locale instead of counting the file", () => {
  it("reads the locale list from the picker rather than from a literal six", () => {
    // The `6` in twenty-two assertions was a literal, so a seventh language
    // turned every one of them red at once with "expected 6, got 7" — which
    // reads as the new locale being wrong rather than as the assertions needing
    // their number bumped. Derived from `languageOptions`, a seventh is checked.
    assert.deepEqual(locales(readI18nSource()), [
      "ru",
      "en",
      "be",
      "pl",
      "de",
      "es",
    ]);
    assert.deepEqual(locales(TWO_LOCALES), ["en", "ru"]);
  });

  it("passes when every locale declares the key for itself", () => {
    assertDeclaredInEveryLocale(TWO_LOCALES, "greeting");
    assertDeclaredInEveryLocale(TWO_LOCALES, "farewell");
  });

  it("catches the arrangement that summed correctly and covered nothing", () => {
    // The whole point, shown both ways round. The old rule first, so the
    // fixture is not just asserted to fool it:
    const hits = SUMS_BUT_DOES_NOT_COVER.match(/greeting:/g) ?? [];
    assert.equal(hits.length, locales(SUMS_BUT_DOES_NOT_COVER).length);

    // …and the new rule on the same text, naming the locale that is missing.
    assert.throws(
      () => assertDeclaredInEveryLocale(SUMS_BUT_DOES_NOT_COVER, "greeting"),
      /ru/,
    );
  });

  it("reports an inherited key as undeclared, which is the distinction at issue", () => {
    // `ru` spreads `...en`, so `farewell` RESOLVES for Russian — it renders,
    // it fits, `t()` returns a non-empty string. Nothing at runtime tells an
    // inherited key from a translated one, which is why the suites ask the
    // source in the first place.
    assert.throws(
      () => assertDeclaredInEveryLocale(SUMS_BUT_DOES_NOT_COVER, "farewell"),
      /en/,
    );
  });

  it("does not count a key mentioned inside a value as a declaration", () => {
    // Several of the migrated cases matched a bare `key:` anywhere in the file,
    // so a key named in a template counted toward the six.
    const mentioned = TWO_LOCALES.replace(
      'farewell: "Bye",',
      'farewell: "Bye",\n  note: `see farewell: below`,',
    );
    assert.deepEqual([...localeBodies(mentioned).keys()], ["en", "ru"]);
    assert.throws(() => assertDeclaredInEveryLocale(mentioned, "note"), /ru/);
  });
});

describe("the value-shape half", () => {
  it("matches each locale's own map and names the ones that miss", () => {
    assertMatchesInEveryLocale(
      TWO_LOCALES,
      /greeting: "[^"]+"/,
      "greeting is a non-empty string",
    );
    assert.throws(
      () =>
        assertMatchesInEveryLocale(
          TWO_LOCALES,
          /greeting: \(params\?: TranslationParams\)/,
          "greeting is a formatter",
        ),
      /en.*ru|ru.*en/s,
    );
  });

  it("refuses a global pattern, which would carry lastIndex between locales", () => {
    // A /g regex is stateful across `.test()` calls, so the same pattern would
    // pass for one locale and fail for the next depending on walk order —
    // a flake that reads as a translation finding.
    assert.throws(
      () => assertMatchesInEveryLocale(TWO_LOCALES, /greeting/g, "greeting"),
      /non-global/,
    );
  });

  it("returns one value per locale, keyed by code rather than by position", () => {
    // The habit this replaces zipped two whole-file sweeps by index, so one
    // locale missing either key shifted every later pair by one and compared a
    // Polish label against a German placeholder.
    assert.deepEqual([...localeStrings(TWO_LOCALES, "greeting")], [
      ["en", "Hello"],
      ["ru", "Привет"],
    ]);
    // The raw spans keep their quotes; `localeStrings` is the unwrapped view,
    // and refuses a value that is not a plain string literal at all.
    assert.deepEqual([...localeValuesOf(TWO_LOCALES, "greeting")], [
      ["en", '"Hello"'],
      ["ru", '"Привет"'],
    ]);
  });

  it("throws rather than returning a short list, so distinctness is never vacuous", () => {
    // Five values from six locales are trivially distinct. A missing locale has
    // to be an error here, not a smaller `Set`.
    assert.throws(
      () => localeValuesOf(SUMS_BUT_DOES_NOT_COVER, "greeting"),
      /not declared in ru/,
    );
  });
});

/**
 * `ru` is declared BEFORE `es` and does not override `greeting`; `es` does.
 * The per-locale slice the suites used runs from `const ru … = {` lazily to
 * the first `greeting:` it can find — which is in `es`, two maps down — and
 * then out to the next `};`. It matches, so `ru` was reported as overriding a
 * key it does not declare. Declaration ORDER decided the answer: the first map
 * in the file was checked against the whole rest of it.
 */
const RU_MISSING_ES_HAS = `
const languageOptions: { code: AppLanguage; label: string }[] = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

const en = {
  greeting: "Hello",
  farewell: "Bye",
};

const ru: TranslationMap = {
  ...en,
  farewell: "Пока",
};

const es: TranslationMap = {
  ...en,
  greeting: "Hola",
  farewell: "Adiós",
};
`;

describe("overrides, asked of the map that is supposed to have them", () => {
  it("catches the locale the slice skipped over", () => {
    // The old rule first, so the fixture is shown to fool it rather than
    // asserted to: `ru` declares no `greeting` and the slice says it does.
    const slice = new RegExp(
      `const\\s+ru:\\s*TranslationMap\\s*=\\s*\\{[\\s\\S]*?greeting:\\s*"[^"]+"[\\s\\S]*?\\};`,
    );
    assert.match(RU_MISSING_ES_HAS, slice);
    assert.ok(!localeKeysOf(RU_MISSING_ES_HAS, "ru").includes("greeting"));

    // …and the new rule on the same text.
    assert.throws(
      () =>
        assertMatchesInEveryNonBaseLocale(
          RU_MISSING_ES_HAS,
          /greeting: "[^"]+"/,
          "greeting is overridden",
        ),
      /not overridden in ru/,
    );
  });

  it("skips the base map, which cannot fall back to itself", () => {
    // `en` writes `greeting` as a formatter here and the others as strings, so
    // the string pattern is false of the base map and true of every inheriting
    // one — which is exactly the difference between the two helpers.
    const baseDiffers = RU_MISSING_ES_HAS.replace(
      'greeting: "Hello",',
      "greeting: (params?: TranslationParams) => `Hello ${params?.name ?? \"\"}`,",
    ).replace("const ru: TranslationMap = {\n  ...en,", 'const ru: TranslationMap = {\n  ...en,\n  greeting: "Привет",');
    assertMatchesInEveryNonBaseLocale(
      baseDiffers,
      /greeting: "[^"]+"/,
      "greeting is overridden",
    );
    assert.throws(
      () =>
        assertMatchesInEveryLocale(
          baseDiffers,
          /greeting: "[^"]+"/,
          "greeting is a string",
        ),
      /not matched in en/,
    );
  });

  it("refuses a global pattern here too", () => {
    assert.throws(
      () =>
        assertMatchesInEveryNonBaseLocale(TWO_LOCALES, /greeting/g, "greeting"),
      /non-global/,
    );
  });
});

/**
 * `greeting` is a plain string in both maps and a LATER key carries the shape a
 * body-wide pattern would be looking for. The `key:[\s\S]*?SHAPE` idiom starts
 * at `greeting:` and strides to `count` two entries down — inside the same map,
 * so scoping to a locale did not close it.
 */
const SHAPE_UNDER_A_LATER_KEY = `
const languageOptions: { code: AppLanguage; label: string }[] = [
  { code: "en", label: "English" },
];

const en = {
  greeting: "Hello",
  middle: "in between",
  counted: (params?: TranslationParams) => \`\${params?.count ?? 0} left\`,
};
`;

describe("matching a value rather than the map it sits in", () => {
  it("catches the shape that belonged to a later key", () => {
    // The body-wide rule first, so the fixture is shown to fool it: `greeting`
    // is the string "Hello" and the pattern says it routes a count.
    assert.match(
      SHAPE_UNDER_A_LATER_KEY,
      /greeting:[\s\S]*?params\?\.count \?\? 0/,
    );
    assert.doesNotThrow(() =>
      assertMatchesInEveryLocale(
        SHAPE_UNDER_A_LATER_KEY,
        /greeting:[\s\S]*?params\?\.count \?\? 0/,
        "greeting routes a count",
      ),
    );

    // …and the exact-span rule on the same text.
    assert.throws(
      () =>
        assertValueInEveryLocale(
          SHAPE_UNDER_A_LATER_KEY,
          "greeting",
          /params\?\.count \?\? 0/,
          "greeting routes a count",
        ),
      /wrong in en \("Hello"\)/,
    );
  });

  it("names the locale AND shows the value it rejected", () => {
    // "not matched in de" sends a reader to the file; "de (\"Suchen\")" ends the
    // question where it is asked.
    assertValueInEveryLocale(
      TWO_LOCALES,
      "greeting",
      /^"[^"]+"$/,
      "greeting is a non-empty string",
    );
    assert.throws(
      () =>
        assertValueInEveryLocale(
          TWO_LOCALES,
          "greeting",
          /^\(params/,
          "greeting is a formatter",
        ),
      /en \("Hello"\).*ru \("Привет"\)/s,
    );
  });

  it("throws on a locale that does not declare the key at all", () => {
    assert.throws(
      () =>
        assertValueInEveryLocale(
          SUMS_BUT_DOES_NOT_COVER,
          "greeting",
          /./,
          "greeting",
        ),
      /not declared in ru/,
    );
  });

  it("refuses a value that is not a plain string where one is asked for", () => {
    // `localeStrings` is for the "six distinct words" comparisons. A key that
    // became a formatter in one language has to be a named failure there, not
    // a silently skipped comparison that leaves the set smaller and still
    // distinct.
    assert.throws(
      () => localeStrings(SHAPE_UNDER_A_LATER_KEY, "counted"),
      /is not a plain string literal/,
    );
  });

  it("refuses a global pattern here too", () => {
    assert.throws(
      () => assertValueInEveryLocale(TWO_LOCALES, "greeting", /Hello/g, "greeting"),
      /non-global/,
    );
  });
});

describe("the habit stays retired", () => {
  /**
   * `bundle-smoke.test.ts` counts `PRIVACY_PAGE_TARGETS`, a local table of the
   * six privacy pages `build-spa-fallback.ts` emits. It is a six about build
   * outputs that happens to sit in a file that also reads the translations —
   * not a locale count, and not something the helpers above can answer.
   */
  const EXEMPT = ["bundle-smoke.test.ts"];

  it("leaves no suite counting locale hits across the whole translations file", () => {
    const dir = path.join(process.cwd(), "__tests__");
    const suites = readdirSync(dir).filter(
      (entry) =>
        entry.endsWith(".test.ts") &&
        statSync(path.join(dir, entry)).isFile() &&
        !EXEMPT.includes(entry),
    );
    const offenders = suites.filter((entry) => {
      const text = readFileSync(path.join(dir, entry), "utf8");
      // `\\s*` rather than a single space: the habit survives prettier
      // wrapping `assert.equal(\n  matches.length,\n  6,\n)`, and the first
      // draft of this guard matched only the one-line form — which left three
      // suites reported clean while still counting.
      return text.includes("readI18nSource") && /\.(length|size),\s*6\b/.test(text);
    });
    assert.deepEqual(
      offenders,
      [],
      `these suites count locale declarations instead of asking each map: ${offenders.join(", ")}`,
    );
    assert.ok(suites.length > 200, `only ${suites.length} suites walked`);
  });
});
