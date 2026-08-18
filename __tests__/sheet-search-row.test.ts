import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocaleBody,
  assertMatchesInEveryNonBaseLocaleBody,
  localeStrings,
} from "./helpers/i18n-locales";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Structural pins for `<SheetSearchRow>` — the "🔎 [input] ✕" row extracted
 * from the three bottom sheets that had each hand-rolled it
 * (`app/create.tsx`, `components/currency-sheet.tsx`,
 * `components/item-filters.tsx`).
 *
 * Two classes of pin live here:
 *   1. the component itself still renders the full shape (markup + a11y),
 *      since it is now the ONLY declaration — a regression here breaks every
 *      sheet at once rather than one;
 *   2. no consumer has re-grown a private copy, which is exactly how the
 *      three originals drifted apart before the extraction.
 */

const COMPONENT = "components/sheet-search-row.tsx";

/** Every file that renders the shared row. */
const CONSUMERS = [
  "app/create.tsx",
  "components/currency-sheet.tsx",
  "components/item-filters.tsx",
];

describe("components/sheet-search-row.tsx — markup", () => {
  const src = read(COMPONENT);

  it("renders magnifier + input + conditional clear chip in that order", () => {
    const magnifier = src.indexOf('name="search"');
    const input = src.indexOf("<MaskedTextInput");
    const clear = src.indexOf('name="close-circle"');
    assert.ok(magnifier > 0 && input > 0 && clear > 0, "one of the three row elements is missing");
    assert.ok(magnifier < input, "the magnifier should lead the row");
    assert.ok(input < clear, "the clear chip should trail the input");
  });

  it("routes typing through the caller's onChange rather than owning the value", () => {
    // A component that held its own `useState` would fork the needle: the
    // consumer's `filtered` memo would keep matching a stale string.
    assert.match(src, /onChangeText=\{\s*onChange\s*\}/);
    assert.match(src, /value=\{\s*value\s*\}/);
    assert.doesNotMatch(src, /useState/);
  });

  it("shows the clear chip only when there is something to clear", () => {
    // A permanently visible ✕ on an empty field is the anti-pattern all
    // three originals already avoided; keep it that way.
    assert.match(src, /\{\s*value\.length\s*>\s*0\s*\?\s*\(\s*<Pressable/);
  });

  it("clears through the same onChange, with the empty string (not undefined)", () => {
    assert.match(src, /onPress=\{\s*\(\)\s*=>\s*onChange\(""\)\s*\}/);
  });

  it("uses the MaskedTextInput wrapper so Clarity session replays stay masked", () => {
    // `lint:clarity-mask` enforces this repo-wide, but pin it locally too:
    // this row is now the single input in four sheets.
    assert.match(src, /import \{ MaskedTextInput \} from "@\/components\/masked-text-input";/);
  });

  it("is memoized, since sheets re-render it on every keystroke", () => {
    assert.match(src, /export const SheetSearchRow = memo\(/);
  });
});

describe("components/sheet-search-row.tsx — accessibility", () => {
  const src = read(COMPONENT);

  it("gives the input the search role", () => {
    assert.match(src, /accessibilityRole="search"/);
  });

  it("takes the spoken label from the caller instead of reusing the placeholder", () => {
    // A placeholder is length-capped by the field width; a spoken label is
    // not. Defaulting the label to the placeholder would quietly re-couple
    // the two constraints for every future consumer.
    assert.match(src, /accessibilityLabel=\{\s*accessibilityLabel\s*\}/);
    assert.doesNotMatch(src, /accessibilityLabel=\{\s*placeholder\s*\}/);
  });

  it("names the clear button from i18n rather than leaving it anonymous", () => {
    // In `app/create.tsx` and `currency-sheet.tsx` this Pressable used to be
    // an unlabeled icon-only tappable — the extraction is what fixes them.
    assert.match(
      src,
      /<Pressable[\s\S]{0,220}accessibilityRole="button"[\s\S]{0,120}accessibilityLabel=\{\s*t\(\s*"filterClearSearch"\s*\)\s*\}/,
    );
  });

  it("hides both decorative Ionicons with BOTH platform props", () => {
    // Android honours importantForAccessibility, iOS accessibilityElementsHidden —
    // shipping only one leaves the other platform announcing an unnamed glyph.
    // Strip block comments first — the component's own doc comment names
    // both props while explaining why they ship as a pair.
    const jsx = src.replace(/\/\*[\s\S]*?\*\//g, "");
    const ios = jsx.match(/accessibilityElementsHidden/g) ?? [];
    const android = jsx.match(/importantForAccessibility="no"/g) ?? [];
    assert.equal(ios.length, 2, `expected the magnifier + clear icons hidden, got ${ios.length}`);
    assert.equal(android.length, ios.length, "each hidden icon needs BOTH platform props");
  });
});

describe("components/sheet-search-row.tsx — styles", () => {
  const src = read(COMPONENT);

  it("declares the row + input styles once, from design tokens", () => {
    assert.match(src, /row:\s*\{[\s\S]*?flexDirection:\s*"row"/);
    assert.match(src, /input:\s*\{[\s\S]*?flex:\s*1/);
  });

  it("uses RADIUS_INPUT rather than a bare 16, which is what the token exists for", () => {
    assert.match(src, /borderRadius:\s*RADIUS_INPUT/);
  });

  it("resolves the pre-extraction font drift toward the majority shape", () => {
    // Two of the three copies were fontSize 15 + FONT_BODY_SEMIBOLD; the
    // filter sheet's was 14 with no family at all. Pin the winner so a
    // future edit has to be deliberate about changing all four sheets.
    assert.match(src, /input:\s*\{[\s\S]*?fontSize:\s*15/);
    assert.match(src, /input:\s*\{[\s\S]*?fontFamily:\s*FONT_BODY_SEMIBOLD/);
  });

  it("tints the magnifier MUTED_13, the darker of the two pre-extraction values", () => {
    // item-filters used MUTED_15 (#b8a08a) for the magnifier, which is the
    // placeholder-weight tint — too light for a persistent affordance.
    assert.match(src, /name="search"[\s\S]{0,80}color=\{MUTED_13\}/);
    assert.match(src, /name="close-circle"[\s\S]{0,80}color=\{MUTED_15\}/);
  });
});

describe("sheet search rows — every consumer uses the shared component", () => {
  for (const rel of CONSUMERS) {
    const src = read(rel);

    it(`${rel} imports and renders <SheetSearchRow>`, () => {
      assert.match(src, /import \{ SheetSearchRow \} from "@\/components\/sheet-search-row";/);
      assert.match(src, /<SheetSearchRow\b/);
    });

    it(`${rel} no longer declares its own sheetSearchRow / sheetSearchInput styles`, () => {
      assert.doesNotMatch(src, /sheetSearchRow:\s*\{/, `${rel} kept a private copy of the row style`);
      assert.doesNotMatch(
        src,
        /sheetSearchInput:\s*\{/,
        `${rel} kept a private copy of the input style`,
      );
    });

    it(`${rel} passes a spoken label, not just a placeholder`, () => {
      assert.match(
        src,
        /<SheetSearchRow[\s\S]{0,400}accessibilityLabel=\{\s*t\(/,
        `${rel} renders the row without an accessibilityLabel`,
      );
    });
  }

  it("leaves exactly one declaration of the row shape in the repo", () => {
    // The magnifier + close-circle icon pair is the fingerprint of this row.
    const declarations = CONSUMERS.map(read).filter((src) => /name="close-circle"[\s\S]{0,200}size=\{18\}/.test(src));
    assert.deepEqual(declarations, [], "a consumer still hand-rolls the clear chip");
  });
});

/**
 * The extraction surfaced the same gap in the two search fields that do NOT
 * use the shared row — found while auditing every search affordance in the
 * app, and fixed in place rather than by forcing them into the component:
 *   - `components/search-overlay.tsx` carries a trailing "close overlay"
 *     button the shared row has no slot for, and sizes its chrome a step up;
 *   - `app/people.tsx` is a page-level field with a visible sibling <Text>
 *     label (which RN does not bind to the input — there is no `htmlFor`).
 * Both were unlabeled with unnamed icon-only Pressables before this change.
 */
describe("search affordances outside <SheetSearchRow> — accessibility parity", () => {
  it("components/search-overlay.tsx labels its input, clear and close controls", () => {
    const src = read("components/search-overlay.tsx");
    assert.match(src, /accessibilityRole="search"/);
    assert.match(src, /accessibilityLabel=\{\s*t\(\s*"searchOverlayA11y"\s*\)\s*\}/);
    assert.match(src, /accessibilityLabel=\{\s*t\(\s*"filterClearSearch"\s*\)\s*\}/);
    assert.match(src, /accessibilityLabel=\{\s*t\(\s*"searchClose"\s*\)\s*\}/);
  });

  it("components/search-overlay.tsx hides all three decorative icons with BOTH platform props", () => {
    const jsx = read("components/search-overlay.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    const ios = jsx.match(/accessibilityElementsHidden/g) ?? [];
    const android = jsx.match(/importantForAccessibility="no"/g) ?? [];
    // magnifier + close-circle + close
    assert.equal(ios.length, 3, `expected 3 hidden icons, got ${ios.length}`);
    assert.equal(android.length, ios.length, "each hidden icon needs BOTH platform props");
  });

  it("app/people.tsx labels its profile-search field", () => {
    const src = read("app/people.tsx");
    assert.match(src, /accessibilityRole="search"/);
    assert.match(src, /accessibilityLabel=\{\s*t\(\s*"searchByProfileId"\s*\)\s*\}/);
  });
});

describe("i18n — the two new per-sheet a11y labels across all 6 languages", () => {
  const src = readI18nSource();

  for (const key of [
    "collectionPickerSearchA11y",
    "currencyPickerSearchA11y",
    "searchOverlayA11y",
  ]) {
    it(`declares ${key} in every locale, as a plain string`, () => {
      assertDeclaredInEveryLocale(src, key);
      assertMatchesInEveryLocaleBody(
        src,
        new RegExp(`\\b${key}:\\s*"[^"]+"`),
        `${key} is a non-empty string`,
      );
    });

    it(`localizes ${key} in ru / be / pl / de / es rather than falling back to en`, () => {
      // Per body. The slice this replaces crossed `};`, so the key had only to
      // exist somewhere at or below the named locale to satisfy it.
      assertMatchesInEveryNonBaseLocaleBody(
        src,
        new RegExp(`\\b${key}:\\s*"[^"]+"`),
        `${key} is overridden`,
      );
    });

    it(`keeps ${key} longer than the shared searchPlaceholder it labels`, () => {
      // Both picker sheets show the generic `searchPlaceholder`; the spoken
      // label exists precisely to say more than the field can fit.
      const labels = localeStrings(src, key);
      for (const [code, label] of labels) {
        assert.ok(
          label.length > 12,
          `${code}: ${key} is too terse to be worth a separate key: "${label}"`,
        );
      }
    });
  }

  it("declares searchClose exactly 6 times, localized in every language", () => {
    assertDeclaredInEveryLocale(src, "searchClose");
    assertMatchesInEveryLocaleBody(
      src,
      /searchClose:\s*"[^"]+"/,
      "searchClose is a non-empty string",
    );
    assertMatchesInEveryNonBaseLocaleBody(
      src,
      /searchClose:\s*"[^"]+"/,
      "searchClose is overridden",
    );
  });

  it("gives the two pickers distinct labels rather than one generic string", () => {
    // "Search" twice tells a screen-reader user nothing about which sheet
    // they are in — the whole reason these are two keys and not one.
    const collection = (src.match(/collectionPickerSearchA11y:\s*"([^"]+)"/g) ?? []).map(
      (m) => m.split('"')[1],
    );
    const currency = (src.match(/currencyPickerSearchA11y:\s*"([^"]+)"/g) ?? []).map(
      (m) => m.split('"')[1],
    );
    assert.equal(collection.length, currency.length);
    for (let i = 0; i < collection.length; i += 1) {
      assert.notEqual(collection[i], currency[i], `identical labels in language #${i}`);
    }
  });
});
