import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CURRENCY_ERROR_I18N_KEY,
  parseCurrencyValueDetailed,
  sanitizeCurrencyInput,
} from "@/lib/format-currency-input";

import { sourceCode } from "./helpers/source-files";

/**
 * The wishlist was the last cost input in the app that could not say what its
 * number meant.
 *
 * `app/create.tsx` opens a currency sheet beside its amount and writes
 * `costCurrency`; `app/item/[id].tsx` renders `<CurrencyInput>` in both its
 * edit form and its listing sheet. The wishlist add sheet had a bare numeric
 * field and wrote `cost` alone — so EVERY want ever added is stored
 * currency-less, and only reads correctly because `convertItemCost` treats a
 * null as already-in-the-display-currency. A want noted while shopping abroad
 * read as that many of the wrong unit, permanently, once the collector forgot
 * which it was.
 *
 * IT WAS INVISIBLE UNTIL THE ROUND BEFORE THIS ONE, which is why it shipped
 * this way for so long: the card rendered `{item.cost}`, a bare number with
 * no unit after it, so a missing currency looked exactly like a present one.
 * Adopting `<CostBadge>` made the row print a currency and made the absence of
 * a stored one a thing you could see.
 *
 * THE SAVE HAD TWO MORE FAILURES THE OTHER FORMS HAD ALREADY CLOSED.
 * `cost ? Number(cost) : null` reads `"12,50"` as NaN — and a comma decimal
 * is what four of this app's six locales type — so the price vanished on
 * save, silently, since `hasFiniteCost` reads NaN as no price at all.
 * `"abc"` did the same. Both are the sanitizer's and the shared parser's job,
 * and both arrive with `<CurrencyInput>`.
 */

const BODY = sourceCode("app/wishlist.tsx");
const PROVIDER = sourceCode("lib/collections-context.tsx");

describe("the add sheet's cost row", () => {
  it("is the shared <CurrencyInput> and not a second hand-rolled row", () => {
    assert.match(BODY, /import \{\s*CurrencyInput,/);
    assert.match(BODY, /<CurrencyInput\b/);
  });

  it("no longer renders a bare numeric field for the price", () => {
    // The shape it replaced: a MaskedTextInput whose only hint was a "0"
    // placeholder. The sheet still has four of them — title, description,
    // source — so this asserts the cost row specifically.
    const label = BODY.indexOf('{t("costLabel")}');
    const next = BODY.indexOf('{t("photosLabel")}');
    assert.ok(label > 0 && next > label, "could not parse the cost row");
    const row = BODY.slice(label, next);
    assert.ok(row.includes("<CurrencyInput"), "wrong slice — no currency input in it");
    assert.ok(!row.includes("<MaskedTextInput"), "the bare field is back");
    assert.ok(!row.includes('placeholder="0"'), "the untranslated placeholder is back");
  });

  it("clears the error as the user types, not only on save", () => {
    assert.match(BODY, /onChangeValue=\{\(v\) => \{\s*setCost\(v\);\s*setCostError\(null\);\s*\}\}/);
  });

  it("renders the shared error vocabulary rather than its own words", () => {
    // Three reasons, three keys, one mapping — so the inline message a user
    // reads and the analytics reason recorded for the same input cannot
    // disagree about what went wrong.
    assert.match(BODY, /error=\{costError \? t\(CURRENCY_ERROR_I18N_KEY\[costError\]\) : null\}/);
    assert.deepEqual(Object.keys(CURRENCY_ERROR_I18N_KEY).sort(), [
      "empty",
      "non_positive",
      "unparseable",
    ]);
  });
});

describe("what the save writes", () => {
  const SAVE = BODY.slice(
    BODY.indexOf("async function handleSave()"),
    BODY.indexOf("const confirmDelete"),
  );

  it("parsed the handler (guards the assertions below from passing vacuously)", () => {
    assert.ok(SAVE.length > 0 && SAVE.includes("addWishlistItem"), "could not parse handleSave");
  });

  it("goes through the shared parser instead of Number()", () => {
    assert.ok(SAVE.includes("parseCurrencyValueDetailed(cost)"), "the shared gate is not used");
    assert.ok(!SAVE.includes("Number(cost)"), "the raw coercion is back");
    assert.ok(!SAVE.includes("cost ? "), "the truthiness check is back");
  });

  it("blocks on a price it cannot read, and not on an absent one", () => {
    // A want with no price is the common case and the field is optional, so
    // "empty" is not an error here. The other two are a number the user MEANT
    // and the app could not read — worth stopping for rather than storing as
    // nothing.
    assert.match(SAVE, /parsedCost\.error && parsedCost\.error !== "empty"/);
    assert.match(SAVE, /setCostError\(parsedCost\.error\);\s*return;/);
  });

  it("pairs the currency with the amount, or writes neither", () => {
    // A currency with no amount claims a quote nobody gave. The same pairing
    // app/create.tsx writes.
    assert.match(SAVE, /cost: parsedCost\.value,/);
    assert.match(SAVE, /costCurrency: parsedCost\.value !== null \? currency : null,/);
  });

  it("remembers the picked currency the way every other input does", () => {
    // The first draft of this screen read the preference without writing it,
    // on a reading of the other two forms that was simply wrong: BOTH of
    // `app/item/[id].tsx`'s inputs write it, as does `app/create.tsx`. An
    // input that seeds itself from the preference and never writes takes the
    // convenience without paying for it — the collector who switches to JPY
    // here is asked again on the next screen. `currency-input-consistency`
    // is the sweep that would have caught it.
    //
    // The helper it names changed the round after: one slot held both "what a
    // form opens with" and "what totals are displayed in", so all three forms
    // write `setEntryCurrency` now. See `entry-currency-key.test.ts`.
    assert.ok(BODY.includes("getEntryCurrency"), "the entry currency is not read");
    assert.ok(BODY.includes("setEntryCurrency"), "the entry currency is not written");
    assert.match(BODY, /function setCurrency\(next: string\) \{\s*setCurrencyState\(next\);\s*void setEntryCurrency\(next\);\s*\}/);
  });

  it("hydrates through the raw setter, not the writing one", () => {
    // Writing back what was just read is a round-trip that can only ever
    // re-persist the value it came from.
    const effect = BODY.slice(
      BODY.indexOf("void getEntryCurrency()"),
      BODY.indexOf("const [promoteFor"),
    );
    assert.ok(effect.length > 0, "could not parse the hydration effect");
    assert.ok(effect.includes("setCurrencyState(stored)"), "hydration re-persists what it read");
  });

  it("keeps the currency across a reset and clears everything else", () => {
    const reset = BODY.slice(BODY.indexOf("function resetForm()"), BODY.indexOf("async function handleSave()"));
    assert.ok(reset.length > 0, "could not parse resetForm");
    assert.ok(reset.includes("setCost(\"\")"), "the amount survives a reset");
    assert.ok(reset.includes("setCostError(null)"), "a stale error survives a reset");
    assert.ok(!reset.includes("setCurrency("), "re-picking the code per row is the friction the MRU strip removes");
  });
});

describe("the provider accepts what the form now sends", () => {
  it("DraftWishlistInput carries an optional, nullable costCurrency", () => {
    const shape = PROVIDER.slice(
      PROVIDER.indexOf("type DraftWishlistInput = {"),
      PROVIDER.indexOf("type DraftCollectionInput = {"),
    );
    assert.ok(shape.length > 0, "could not parse DraftWishlistInput");
    assert.match(shape, /costCurrency\?: string \| null;/);
  });

  it("addWishlistItem writes it, defaulting to null and not undefined", () => {
    // `updateRemoteItem` writes a field only when the key is PRESENT, and the
    // stored shape is `string | null`. An `undefined` here would be a row
    // that reconciles differently from every other item.
    const creator = PROVIDER.slice(
      PROVIDER.indexOf("addWishlistItem: async (input)"),
      PROVIDER.indexOf("promoteWishlistItem: async (itemId"),
    );
    assert.ok(creator.length > 0, "could not parse addWishlistItem");
    assert.match(creator, /costCurrency: input\.costCurrency \?\? null,/);
  });

  it("writes the same pair addItem does", () => {
    const adder = PROVIDER.slice(
      PROVIDER.indexOf("addItem: async (input)"),
      PROVIDER.indexOf("addCollection: async (input)"),
    );
    assert.match(adder, /cost: input\.cost \?\? null,/);
    assert.match(adder, /costCurrency: input\.costCurrency \?\? null,/);
  });
});

describe("the inputs that used to vanish", () => {
  it("a comma decimal survives the sanitizer and then the parser", () => {
    // The failure this round is really about: four of six locales type a
    // comma, `Number("12,50")` is NaN, and `hasFiniteCost` reads NaN as no
    // price at all — so the number disappeared between the field and the card
    // with nothing said.
    assert.equal(sanitizeCurrencyInput("12,50"), "12.50");
    assert.deepEqual(parseCurrencyValueDetailed("12.50"), { value: 12.5, error: null });
    assert.ok(Number.isNaN(Number("12,50")), "the old coercion no longer fails this way");
  });

  it("a price the app cannot read is reported rather than stored as nothing", () => {
    assert.deepEqual(parseCurrencyValueDetailed("abc"), { value: null, error: "unparseable" });
    assert.deepEqual(parseCurrencyValueDetailed("-5"), { value: null, error: "non_positive" });
  });

  it("an absent price is not an error", () => {
    assert.deepEqual(parseCurrencyValueDetailed(""), { value: null, error: "empty" });
    assert.deepEqual(parseCurrencyValueDetailed("   "), { value: null, error: "empty" });
  });
});
