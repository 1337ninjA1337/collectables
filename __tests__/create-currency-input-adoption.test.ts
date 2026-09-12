import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sourceCode, tsxFiles } from "./helpers/source-files";

/**
 * The last cost input driving a raw `<CurrencySheet>`.
 *
 * `app/create.tsx` predates `<CurrencyInput>`, so it re-implemented three
 * things the component already had — the sheet's open/query state, the MRU pin
 * write, and the error pill — and got a fourth wrong by omission.
 *
 * THE OMISSION IS THE USER-FACING HALF. The other two forms show a strip of
 * currency chips: the codes you used most recently, one tap each, with a "…"
 * chip opening the full picker. This screen showed the active CODE behind a
 * chevron, so switching currency was two taps and a search field every time —
 * on the form a new account meets first, and the one place a collector adds
 * items in bulk. It also passed `keyboardType="numeric"` where the component
 * passes `"decimal-pad"`, which is the one with a separator key on iOS: the
 * screen that most needed a decimal point was the screen without one.
 *
 * IT SHRINKS THE BUNDLE, which is the rare direction. Four styles, an import
 * of `<ErrorPill>`, an import of `sanitizeCurrencyInput`, two pieces of state,
 * a sheet mount and a `pinCurrency` call all leave, and nothing arrives:
 * `<CurrencyInput>` was already in the bundle for the other two forms.
 *
 * The cases here are about what the SCREEN stopped knowing. What the component
 * does with it is pinned where it lives — `pinned-currencies.test.ts` for the
 * chips and the pin, `currency-error-inline.test.ts` for the pill.
 */

const SRC = sourceCode("app/create.tsx");
const COMPONENT = sourceCode("components/currency-input.tsx");

describe("the cost row", () => {
  it("is <CurrencyInput>", () => {
    assert.match(SRC, /import \{ CurrencyInput \} from "@\/components\/currency-input";/);
    assert.match(SRC, /<CurrencyInput\s+value=\{cost\}/);
    assert.match(SRC, /currency=\{currency\}/);
    assert.match(SRC, /onChangeCurrency=\{setCurrency\}/);
  });

  it("keeps the label above it, which is the screen's own", () => {
    // The component renders the field, the chips and the pill; the section
    // label is this form's layout and every other field group has one.
    const group = SRC.indexOf('{t("costLabel")}');
    const input = SRC.indexOf("<CurrencyInput", group);
    assert.ok(group > 0 && input > group, "the cost label no longer sits above the row");
  });

  it("passes the error already translated", () => {
    // The component takes a message, not a reason: translation stays at the
    // caller, which is what lets three forms share one error vocabulary
    // without the component knowing how `t` works.
    assert.match(SRC, /error=\{costError \? t\(CURRENCY_ERROR_I18N_KEY\[costError\]\) : null\}/);
    assert.match(COMPONENT, /error\?: string \| null/);
  });
});

describe("what the screen stopped holding", () => {
  const GONE: readonly (readonly [string, string])[] = [
    ["currencySheetOpen", "the sheet's open state — the component owns the sheet"],
    ["currencyQuery", "the sheet's search query"],
    ["<CurrencySheet", "the sheet mount itself"],
    ["sanitizeCurrencyInput", "keystroke sanitising, which the component does before it calls back"],
    ["ErrorPill", "the inline error pill"],
    ["styles.costRow", "the two-column layout the chevron selector needed"],
    ["styles.currencySelector", "the code-behind-a-chevron control the chip strip replaces"],
  ];

  for (const [fragment, why] of GONE) {
    it(`no longer holds ${fragment} — ${why}`, () => {
      assert.ok(!SRC.includes(fragment), `${fragment} is still in app/create.tsx`);
    });
  }

  it("the styles it dropped are really gone, not merely unreferenced", () => {
    // A StyleSheet entry nothing reads is dead weight the bundler keeps: the
    // object is constructed at module scope either way.
    for (const style of ["costRow:", "costInput:", "currencySelector:", "currencySelectorText:"]) {
      assert.ok(!SRC.includes(style), `${style} is still declared`);
    }
  });
});

describe("what the adoption gives this screen", () => {
  it("the MRU chip strip the other two forms already had", () => {
    // The user-facing half: one tap on a code you used yesterday, instead of
    // opening a sheet and searching for it.
    assert.match(COMPONENT, /const baseCodes = \[\.\.\.new Set\(\[\.\.\.pinned, \.\.\.CURRENCY_CHIPS\]\)\]/);
    assert.match(COMPONENT, /onPress=\{\(\) => selectCurrency\(c\)\}/);
  });

  it("a decimal keypad, where the screen used to ask for a numeric one", () => {
    // "numeric" has no separator key on iOS, so the form most likely to take
    // a fractional price was the one that could not type a decimal point.
    assert.match(COMPONENT, /keyboardType="decimal-pad"/);
    assert.ok(!SRC.includes('keyboardType="numeric"'), "the numeric keypad is back on this screen");
  });

  it("the currency symbol beside the field, announced as the code", () => {
    assert.match(COMPONENT, /accessibilityLabel=\{currency\}/);
    assert.match(COMPONENT, /getCurrencySymbol\(currency\)/);
  });
});

describe("the sweep — nothing drives a currency sheet by hand for a cost", () => {
  /**
   * The rule the adoption makes true, so the next cost form cannot start the
   * same way. A screen that takes a typed amount reaches `<CurrencyInput>`;
   * mounting `<CurrencySheet>` directly is for the DISPLAY pickers, which take
   * no amount and want a plain list rather than a strip of recently-typed
   * codes.
   */
  it("every screen that parses an amount renders the component, not the sheet", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles("app")) {
      const code = sourceCode(file);
      if (!code.includes("parseCurrencyValueDetailed(")) continue;
      if (!code.includes("<CurrencyInput")) offenders.push(`${file} (no <CurrencyInput>)`);
      if (code.includes("<CurrencySheet")) offenders.push(`${file} (mounts <CurrencySheet>)`);
    }
    assert.deepEqual(offenders, [], `adopt <CurrencyInput>:\n${offenders.join("\n")}`);
  });

  it("finds the cost screens (guards the rule from passing vacuously)", () => {
    const costScreens = tsxFiles("app").filter((f) =>
      sourceCode(f).includes("parseCurrencyValueDetailed("),
    );
    assert.deepEqual([...costScreens].sort(), [
      "app/create.tsx",
      "app/item/[id].tsx",
      "app/wishlist.tsx",
    ]);
  });

  it("the display pickers still mount the sheet directly, which is correct", () => {
    // The other side of the rule. They take no amount, so they have no entry
    // currency to remember and no use for a strip of recently-typed codes.
    for (const file of ["app/settings.tsx", "app/collection/[id].tsx"]) {
      const code = sourceCode(file);
      assert.ok(code.includes("<CurrencySheet"), `${file} stopped offering a currency choice`);
      assert.ok(!code.includes("<CurrencyInput"), `${file} took the cost-input control`);
    }
  });
});
