import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CURRENCY_KEY, ENTRY_CURRENCY_KEY } from "@/lib/storage-keys";

import { readRepoFile as read } from "./helpers/repo-file";
import { sourceCode } from "./helpers/source-files";

/**
 * One storage slot was two facts, and the collision was not theoretical.
 *
 * `collectables-currency-v1` answered both "what unit do I show your totals
 * in" and "what unit did you last type an amount in". The settings screen
 * wrote it as a display choice; three cost forms wrote it as a memory of what
 * you typed. So noting a single want priced in yen re-denominated every
 * collection total on the home screen — a global moved as a side effect of
 * filling in one optional field, with nothing on either screen connecting the
 * two acts.
 *
 * THEY AGREE MOST OF THE TIME, WHICH IS WHY IT LASTED. A collector who buys
 * and thinks in one currency never sees a difference, and the app's own
 * consistency sweep — written the round before this one — asserted all three
 * forms wrote the shared key and was right to: the forms agreeing with each
 * other was the thing being checked, and they did. What no case asked was
 * whether the thing they agreed on was one fact.
 *
 * THE FALLBACK IS THE MIGRATION. Every existing installation has a display
 * currency and no entry currency, so `getEntryCurrency` reads through to the
 * old slot when the new one is empty: a returning user's forms open exactly
 * where they did before, and the two diverge only once one is deliberately
 * changed. Done on READ rather than by copying the value across at startup,
 * because a startup copy writes a key nobody has chosen a value for — which
 * makes "never picked one" indistinguishable from "picked the same one"
 * forever after.
 */

describe("the two keys", () => {
  it("are different slots", () => {
    assert.equal(CURRENCY_KEY, "collectables-currency-v1");
    assert.equal(ENTRY_CURRENCY_KEY, "collectables-entry-currency-v1");
    assert.notEqual(CURRENCY_KEY, ENTRY_CURRENCY_KEY);
  });

  it("neither is a prefix of the other", () => {
    // Not pedantry: several stores in this app are swept by prefix, and
    // "collectables-currency-v1" is a prefix of a plausible next name for the
    // second slot ("collectables-currency-v1-entry"), which would make a
    // prefix sweep of one take both.
    assert.ok(!ENTRY_CURRENCY_KEY.startsWith(CURRENCY_KEY));
    assert.ok(!CURRENCY_KEY.startsWith(ENTRY_CURRENCY_KEY));
  });

  it("both are wiped when a user signs out", () => {
    // A currency is a fact about the person who picked it. Leaving one behind
    // means the next account on this device opens its first cost form on a
    // stranger's unit — which is the reason the display half was already in
    // this list.
    const src = read("lib/storage-keys.ts");
    const clearBlock = src.match(/clearAllUserData[\s\S]*?\n\}/);
    assert.ok(clearBlock, "expected clearAllUserData function block");
    assert.match(clearBlock![0], /\bCURRENCY_KEY\b/);
    assert.match(clearBlock![0], /\bENTRY_CURRENCY_KEY\b/);
  });
});

describe("getEntryCurrency", () => {
  const SRC = sourceCode("lib/locale-helpers.ts");
  const BODY = SRC.slice(
    SRC.indexOf("export async function getEntryCurrency("),
    SRC.indexOf("export async function setEntryCurrency("),
  );

  it("parsed the function (guards the assertions below from passing vacuously)", () => {
    assert.ok(BODY.length > 0 && BODY.includes("ENTRY_CURRENCY_KEY"), "could not parse it");
  });

  it("reads the entry slot first", () => {
    const entry = BODY.indexOf("ENTRY_CURRENCY_KEY");
    const fallback = BODY.indexOf("getUserPreferredCurrency()");
    assert.ok(entry > 0 && fallback > entry, "the display slot is consulted first");
  });

  it("falls back to the display slot, which is the whole migration", () => {
    assert.ok(BODY.includes("return getUserPreferredCurrency();"), "no read-through fallback");
  });

  it("validates through the same parser rather than trusting the slot", () => {
    // A corrupted payload in the new key must fall through to the old one,
    // not return junk — so the gate is the parsed value and not the raw read.
    assert.match(BODY, /const parsed = parseStoredCurrency\(raw\);\s*if \(parsed\) return parsed;/);
  });

  it("falls through on a storage throw instead of returning early", () => {
    // The display slot is a different key and may well be readable. A store
    // failing wholesale answers null from the fallback call too, so there is
    // no case where the early return would have been better.
    const conclusion = BODY.slice(BODY.indexOf("catch"));
    assert.ok(!conclusion.includes("return null"), "a read failure skips the fallback");
    assert.ok(conclusion.includes("reportStorageFailure("), "a read failure is swallowed silently");
  });
});

describe("setEntryCurrency", () => {
  const SRC = sourceCode("lib/locale-helpers.ts");
  const BODY = SRC.slice(SRC.indexOf("export async function setEntryCurrency("));

  it("writes only the entry slot", () => {
    const fn = BODY.slice(0, BODY.indexOf("\n}\n") + 3);
    assert.ok(fn.includes("ENTRY_CURRENCY_KEY"), "could not parse it");
    // `\b` and not `includes`: "ENTRY_CURRENCY_KEY" contains "CURRENCY_KEY"
    // as a substring, and `_` is a word character, so the boundary is what
    // separates the two names. The first draft of this case asserted the
    // substring and failed on the correct code.
    assert.ok(
      !/\bCURRENCY_KEY\b/.test(fn),
      "picking an entry currency still moves the display currency",
    );
  });

  it("drops a malformed code rather than storing it", () => {
    const fn = BODY.slice(0, BODY.indexOf("\n}\n") + 3);
    assert.match(fn, /const validated = parseStoredCurrency\(currency\);\s*if \(!validated\) return;/);
  });

  it("reports a failed write instead of throwing through a form submit", () => {
    const fn = BODY.slice(0, BODY.indexOf("\n}\n") + 3);
    assert.ok(fn.includes("reportStorageFailure("), "a failed write can kill a save");
  });
});

describe("who writes which", () => {
  it("no screen writes the display currency directly any more", () => {
    // It goes through the provider's `setDisplayCurrency`, which is the only
    // caller that also updates the state every total renders from.
    for (const file of ["app/create.tsx", "app/item/[id].tsx", "app/wishlist.tsx", "app/settings.tsx"]) {
      const code = sourceCode(file);
      assert.ok(
        !code.includes("setUserPreferredCurrency("),
        `${file} writes the display currency behind the provider's back`,
      );
    }
  });

  it("the provider still persists the display currency", () => {
    const provider = sourceCode("lib/collections-context.tsx");
    assert.ok(provider.includes("setUserPreferredCurrency("), "nothing persists it now");
  });

  it("the provider seeds its display state from the display slot, not the entry one", () => {
    // The direction that would be easy to get backwards, and it would be
    // invisible: totals would quietly re-denominate to whatever was last
    // typed into a form, which is exactly the bug the split removed.
    const provider = sourceCode("lib/collections-context.tsx");
    assert.ok(provider.includes("getUserPreferredCurrency("), "the provider stopped reading it");
    assert.ok(!provider.includes("getEntryCurrency("), "totals now follow what a form last typed");
  });
});
