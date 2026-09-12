import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CURRENCY_IMPLEMENTATION_FILES,
  costInputFiles,
  displayPickerFiles,
} from "./helpers/currency-surfaces";
import { sourceCode } from "./helpers/source-files";

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
 *    `getEntryCurrency()` once storage answers. A form that skipped this would
 *    open on the language default for a collector who has been typing JPY all
 *    week.
 *
 * 2. Does picking one REMEMBER it? The entry currency exists so a power user
 *    who picked JPY once doesn't have to re-pick on the next form, which is a
 *    promise only kept if every form both reads and writes. An input that
 *    reads without writing takes the convenience and does not pay for it.
 *
 * The pairing is the claim, not either half: a reader without a writer is the
 * bug this file was written after, and a writer without a reader would persist
 * a preference it then ignores.
 *
 * THE HELPER THESE RULES NAME CHANGED THE ROUND AFTER THIS FILE SHIPPED, and
 * that is the sweep working rather than the sweep being wrong. It first asked
 * about `getUserPreferredCurrency` / `setUserPreferredCurrency`, because one
 * AsyncStorage key was doing two jobs: what a cost form opens with, and what
 * totals are DISPLAYED in — which `app/settings.tsx` writes through
 * `setDisplayCurrency`. So noting a want priced in yen re-denominated every
 * collection total on the home screen. The keys are split now and these rules
 * ask about the entry one; the display half is asserted at the bottom of this
 * file, where the two must NOT be confused again.
 */

/**
 * The derivation moved to `helpers/currency-surfaces.ts` on 2026-09-12, and
 * the move is the finding rather than a tidy-up.
 *
 * It lived here and a near-copy lived in
 * `create-currency-input-adoption.test.ts`, and both walked `app/` only —
 * because every currency surface anybody had thought about was a route. The
 * one control in `components/` was outside both rules by the WALK rather than
 * by either rule, and it took a THIRD signal to see at all: the
 * collection-edit modal renders the button and asks its parent to open the
 * sheet, so neither `<CurrencyInput>` nor `<CurrencySheet>` appears in it.
 *
 * It belongs on the excluded side, which is precisely why nobody noticed — a
 * gap that is currently harmless is still a gap, and it is the kind these
 * sweeps exist to close.
 */

describe("every screen with a cost input", () => {
  const SCREENS = costInputFiles();

  it("finds the known screens (guards the rules below from passing vacuously)", () => {
    // A sweep that found nothing would pass every rule under it.
    assert.deepEqual([...SCREENS].sort(), [
      "app/create.tsx",
      "app/item/[id].tsx",
      "app/wishlist.tsx",
    ]);
  });

  it("every currency surface is on exactly one of the two lists", () => {
    // The two lists are complements over one walk, so a file cannot fall out
    // of both — which is how the collection-edit modal spent its life
    // unruled. Adding a typed amount to a display picker moves it across and
    // turns a case red rather than leaving it silently exempt.
    const overlap = costInputFiles().filter((f) => displayPickerFiles().includes(f));
    assert.deepEqual(overlap, [], "a file is both a cost input and a display picker");
    const all = [...costInputFiles(), ...displayPickerFiles()].sort();
    assert.deepEqual(all, [
      "app/collection/[id].tsx",
      "app/create.tsx",
      "app/item/[id].tsx",
      "app/settings.tsx",
      "app/wishlist.tsx",
      "components/edit-collection-modal.tsx",
    ]);
  });

  it("exempts the two files that IMPLEMENT the controls, and only those", () => {
    // Named rather than pattern-matched: "anything under components/ with
    // `currency` in the name" would also exempt the next screen-level
    // component somebody puts there.
    assert.deepEqual([...CURRENCY_IMPLEMENTATION_FILES], [
      "components/currency-input.tsx",
      "components/currency-sheet.tsx",
    ]);
    for (const file of CURRENCY_IMPLEMENTATION_FILES) {
      assert.ok(!costInputFiles().includes(file), `${file} is held to the cost-input rules`);
      assert.ok(!displayPickerFiles().includes(file), `${file} is held to the display rules`);
    }
  });

  for (const file of SCREENS) {
    it(`${file} opens with the currency the user last picked`, () => {
      const code = sourceCode(file);
      assert.ok(
        code.includes("getDefaultCurrencyForLanguage("),
        `${file} has no language-derived default to fall back to`,
      );
      assert.ok(
        code.includes("getEntryCurrency("),
        `${file} ignores the stored preference and opens on the language default`,
      );
    });

    it(`${file} remembers a currency the user picks`, () => {
      const code = sourceCode(file);
      assert.ok(
        code.includes("setEntryCurrency("),
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
    [
      "components/edit-collection-modal.tsx",
      "the button that opens that override's picker — the surface neither sweep could see until the walk reached components/, because it mounts no sheet of its own and names one through a prop",
    ],
  ];

  it("is the whole of the other list", () => {
    // Written out above AND derived, so a new display picker is a red case
    // rather than a silent omission — the failure mode the modal was in.
    assert.deepEqual(
      DISPLAY_PICKERS.map(([file]) => file).sort(),
      [...displayPickerFiles()].sort(),
    );
  });

  for (const [file, why] of DISPLAY_PICKERS) {
    it(`${file} picks a display currency — ${why}`, () => {
      const code = sourceCode(file);
      assert.ok(
        code.includes("<CurrencySheet") || code.includes("onOpenCurrencySheet"),
        `${file} no longer offers a currency choice`,
      );
      assert.ok(
        !code.includes("parseCurrencyValueDetailed("),
        `${file} now takes a typed amount — decide whether it is a cost input`,
      );
      assert.ok(
        !costInputFiles().includes(file),
        `${file} is being held to the cost-input rules`,
      );
    });
  }

  it("writes the display currency through the provider, not the storage helper", () => {
    // Deliberate, and the distinction this sweep's scope rests on: settings is
    // where a user states a DISPLAY preference outright, so it goes through
    // `setDisplayCurrency`, which updates the provider's state and persists to
    // CURRENCY_KEY. A form remembering what you typed is a different act on a
    // different key, which is what the split made true.
    const code = sourceCode("app/settings.tsx");
    assert.ok(code.includes("setDisplayCurrency("), "settings no longer sets the display currency");
    assert.ok(
      !code.includes("setEntryCurrency("),
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
