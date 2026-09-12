import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sourceCode, tsxFiles } from "./helpers/source-files";

/**
 * Every currency input in the app answers the same two questions the same way.
 *
 * THIS SWEEP EXISTS BECAUSE THE ROUND BEFORE IT GOT THIS WRONG. The wishlist's
 * new cost row was written to read the stored preference and deliberately not
 * write it, on a stated reading that `app/item/[id].tsx`'s edit form did the
 * same. It does not — both of that screen's inputs write it, as does
 * `app/create.tsx` — so the argument was built on a file nobody re-read, and
 * it shipped as a comment and a case asserting something false about another
 * screen. That is the failure mode a list catches and a careful reader does
 * not: four call sites, a rule stated in three of them, and the fourth free to
 * differ because nothing compares them.
 *
 * THE TWO QUESTIONS.
 *
 * 1. Does the form OPEN with the currency the user last picked? Every input
 *    seeds `getDefaultCurrencyForLanguage(language)` and then replaces it from
 *    `getUserPreferredCurrency()` once storage answers. A form that skipped
 *    this would open on the language default for a collector who has been
 *    typing JPY all week.
 *
 * 2. Does picking one REMEMBER it? `setUserPreferredCurrency` is documented as
 *    "so a power user who picked JPY once doesn't have to re-pick on the next
 *    form", which is a promise only kept if every form both reads and writes.
 *    An input that reads without writing takes the convenience and does not
 *    pay for it.
 *
 * The pairing is the claim, not either half: a reader without a writer is the
 * bug this file was written after, and a writer without a reader would persist
 * a preference it then ignores.
 *
 * WHAT THIS DOES NOT ASSERT is that the preference SHOULD be one value. It is
 * one AsyncStorage key doing two jobs — the currency a form opens with, and
 * the currency totals are displayed in, which `app/settings.tsx` also writes
 * through `setDisplayCurrency`. So picking a currency for one item does move
 * the whole app's display currency, which is a real design question and a
 * separate one. This file says the four inputs agree; whether what they agree
 * on is right is recorded in `.tasks/.suggestions.md`.
 */

/**
 * A COST input is a screen where the user types an amount AND says what
 * currency it is in. Both halves are the definition, and the first draft of
 * this sweep had only one of them.
 *
 * Offering a currency choice is not enough: `app/settings.tsx` and
 * `app/collection/[id].tsx` both drive a `<CurrencySheet>` and neither takes
 * an amount — they pick the currency a figure is DISPLAYED in, which is the
 * opposite direction and has no preference to remember. Asking them to write
 * `setUserPreferredCurrency` would make choosing a display currency change
 * what the next cost form opens with, which is the confusion this repository
 * already has once (see the note at the bottom of this file) and does not
 * need twice.
 *
 * So the second half is `parseCurrencyValueDetailed` — the shared parser for
 * a typed amount. A screen that both picks a currency and parses an amount is
 * saying "this number is in this unit", and that is the claim these rules are
 * about.
 *
 * Derived rather than listed because `app/create.tsx` predates
 * `<CurrencyInput>` and keeps a raw sheet, so a list of component call sites
 * would have found two of the three and called it complete.
 */
function costInputScreens(): readonly string[] {
  const found: string[] = [];
  for (const file of tsxFiles("app")) {
    const code = sourceCode(file);
    const picksCurrency = code.includes("<CurrencyInput") || code.includes("<CurrencySheet");
    const parsesAmount = code.includes("parseCurrencyValueDetailed(");
    if (picksCurrency && parsesAmount) found.push(file);
  }
  return found;
}

describe("every screen with a cost input", () => {
  const SCREENS = costInputScreens();

  it("finds the known screens (guards the rules below from passing vacuously)", () => {
    // A sweep that found nothing would pass every rule under it.
    assert.deepEqual([...SCREENS].sort(), [
      "app/create.tsx",
      "app/item/[id].tsx",
      "app/wishlist.tsx",
    ]);
  });

  for (const file of SCREENS) {
    it(`${file} opens with the currency the user last picked`, () => {
      const code = sourceCode(file);
      assert.ok(
        code.includes("getDefaultCurrencyForLanguage("),
        `${file} has no language-derived default to fall back to`,
      );
      assert.ok(
        code.includes("getUserPreferredCurrency("),
        `${file} ignores the stored preference and opens on the language default`,
      );
    });

    it(`${file} remembers a currency the user picks`, () => {
      const code = sourceCode(file);
      assert.ok(
        code.includes("setUserPreferredCurrency("),
        `${file} reads the preference without writing it — the next form asks again`,
      );
    });
  }
});

describe("the screens that pick a currency and take no amount", () => {
  /**
   * The other side of the derivation, asserted rather than assumed — because
   * "they do not parse an amount" is exactly the kind of fact that stops being
   * true when somebody adds a field, and the sweep above would then silently
   * start demanding a preference write on a display picker.
   */
  const DISPLAY_PICKERS: readonly (readonly [string, string])[] = [
    [
      "app/settings.tsx",
      "where a user states the currency their totals are shown in, outright",
    ],
    [
      "app/collection/[id].tsx",
      "the per-collection display override, which re-denominates a total somebody else's items contributed to",
    ],
  ];

  for (const [file, why] of DISPLAY_PICKERS) {
    it(`${file} picks a display currency — ${why}`, () => {
      const code = sourceCode(file);
      assert.ok(code.includes("<CurrencySheet"), `${file} no longer offers a currency choice`);
      assert.ok(
        !code.includes("parseCurrencyValueDetailed("),
        `${file} now takes a typed amount — decide whether it is a cost input`,
      );
      assert.ok(
        !costInputScreens().includes(file),
        `${file} is being held to the cost-input rules`,
      );
    });
  }

  it("writes the display currency through the provider, not the storage helper", () => {
    // Deliberate, and the distinction this sweep's scope rests on: settings is
    // where a user states a DISPLAY preference outright, so it goes through
    // `setDisplayCurrency`, which updates the provider's state and persists.
    // A form remembering what you typed is not the same act, even though the
    // two currently land on the same key.
    const code = sourceCode("app/settings.tsx");
    assert.ok(code.includes("setDisplayCurrency("), "settings no longer sets the display currency");
    assert.ok(
      !code.includes("setUserPreferredCurrency("),
      "settings writes storage behind the provider's back",
    );
  });

  it("the provider's setter is what persists it", () => {
    const provider = sourceCode("lib/collections-context.tsx");
    const setter = provider.slice(
      provider.indexOf("setDisplayCurrency: (currency) => {"),
      provider.indexOf("setDisplayCurrency: (currency) => {") + 400,
    );
    assert.ok(setter.includes("setUserPreferredCurrency("), "the provider stopped persisting it");
  });
});
