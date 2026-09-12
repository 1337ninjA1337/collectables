import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeOutcome, OUTCOME_SEPARATOR } from "@/lib/outcome-message";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertNoLocaleDeclares, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Three toasts report an outcome that is really two, and the punctuation
 * between the halves used to be split across two files and six translations:
 * `bulkListingsRemoved` began with a literal `· ` in every locale, and the
 * space in front of it was a leading space inside the string the screen
 * conditionally returned.
 *
 * Both halves fail silently. A translator who drops the glyph — it is not a
 * word, and nothing in the value says it is load-bearing — runs two sentences
 * together; a caller who forgets the leading space joins them with the glyph
 * alone. Neither is visible to a coverage count, because the key is DECLARED
 * either way.
 */
describe("composeOutcome", () => {
  it("joins two clauses with the separator", () => {
    assert.equal(
      composeOutcome("Archived 30 items", "4 listings taken down"),
      "Archived 30 items · 4 listings taken down",
    );
  });

  it("returns the leading clause alone when nothing else happened", () => {
    // The property the hand-written join did not have: a screen passes the
    // conditional clause straight through rather than encoding "nothing
    // happened" as a string that starts with a space.
    assert.equal(composeOutcome("Archived 30 items"), "Archived 30 items");
    assert.equal(composeOutcome("Archived 30 items", null), "Archived 30 items");
    assert.equal(composeOutcome("Archived 30 items", undefined), "Archived 30 items");
  });

  it("leaves no trailing separator and no trailing space", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const out = composeOutcome("Item archived", empty);
      assert.equal(out, "Item archived");
      assert.equal(out, out.trimEnd(), "a dropped clause must not leave whitespace behind");
    }
  });

  it("drops a whitespace-only clause rather than punctuating it", () => {
    // A locale whose value collapsed to a space is a clause that says nothing,
    // and a separator in front of nothing reads as a rendering bug.
    assert.equal(composeOutcome("Item archived", " "), "Item archived");
  });

  it("takes more than two clauses, which is the shape it exists for", () => {
    // The argument for composing instead of writing a sentence per outcome: a
    // third thing the act also did is another clause here and a fourth
    // hand-written string otherwise.
    assert.equal(
      composeOutcome("Archived 30 items", "4 listings taken down", "2 reminders cancelled"),
      "Archived 30 items · 4 listings taken down · 2 reminders cancelled",
    );
  });

  it("drops the absent clauses out of the middle, keeping the rest joined once", () => {
    assert.equal(
      composeOutcome("Archived 30 items", null, "2 reminders cancelled"),
      "Archived 30 items · 2 reminders cancelled",
    );
  });

  it("does not second-guess the leading clause, even an empty one", () => {
    // The caller's own sentence is its business; this module punctuates. No
    // call site passes an empty lead, and a composer that silently swallowed
    // one would hide the bug rather than print it.
    assert.equal(composeOutcome("", "4 listings taken down"), " · 4 listings taken down");
  });

  it("the separator has a space on each side and is a middle dot", () => {
    assert.equal(OUTCOME_SEPARATOR, " · ");
  });
});

describe("the separator left the translations", () => {
  const I18N = readI18nSource();

  it("no locale's listing clause carries the glyph any more", () => {
    for (const [code, value] of localeValuesOf(I18N, "bulkListingsRemoved")) {
      assert.ok(
        !value.includes("·"),
        `${code} still punctuates inside the translation — the glyph is layout, not a word`,
      );
      assert.equal(value, value.trim(), `${code} still carries the join's whitespace`);
    }
  });

  it("every locale's clause still starts with the count", () => {
    // Stripping the prefix must not have taken the number with it: the clause
    // is "N listings taken down" in all six, and the agreed word sits beside
    // the number in the three Slavic ones.
    for (const [code, value] of localeValuesOf(I18N, "bulkListingsRemoved")) {
      assert.match(value, /`\$\{params\?\.count \?\? 0\} /, `${code} no longer leads with the count`);
    }
  });

  it("no locale declares a key that only existed to carry punctuation", () => {
    assertNoLocaleDeclares(
      I18N,
      (key) => key === "archiveActionDoneListingRemoved",
      "the dedicated archive-outcome toast is composed now",
    );
  });
});

describe("the three call sites", () => {
  const COLLECTION = readRepoFile("app/collection/[id].tsx");
  const ITEM = readRepoFile("app/item/[id].tsx");

  it("the bulk delete and the bulk archive both compose", () => {
    assert.match(COLLECTION, /toast\.success\(composeOutcome\(t\("itemsDeleted", \{ count: ids\.length \}\), outcome\)\)/);
    assert.match(COLLECTION, /toast\.success\(composeOutcome\(t\("itemsArchived", \{ count: ids\.length \}\), outcome\)\)/);
  });

  it("the single-item archive composes the same two clauses", () => {
    assert.match(
      ITEM,
      /composeOutcome\(t\("archiveActionDone"\), t\("bulkListingsRemoved", \{ count: 1 \}\)\)/,
    );
  });

  it("listedOutcome returns null rather than a string with a leading space", () => {
    // The old shape encoded "nothing happened" as `""` and "something did" as
    // a value that began with a space, so the join lived half here and half in
    // the template. A `null` says only whether it happened.
    const block = COLLECTION.slice(
      COLLECTION.indexOf("const listedOutcome"),
      COLLECTION.indexOf("const performBulkDelete"),
    );
    assert.ok(block.length > 0, "could not parse listedOutcome");
    assert.match(block, /:\s*null,/);
    assert.doesNotMatch(block, /` \$\{t\("bulkListingsRemoved"/, "the leading space is back");
  });

  it("no screen writes the separator itself", () => {
    for (const [name, src] of [
      ["app/collection/[id].tsx", COLLECTION],
      ["app/item/[id].tsx", ITEM],
    ] as const) {
      assert.ok(!src.includes(" · "), `${name} punctuates an outcome by hand`);
    }
  });

  it("both screens reach the shared module rather than re-deriving the join", () => {
    for (const [name, src] of [
      ["app/collection/[id].tsx", COLLECTION],
      ["app/item/[id].tsx", ITEM],
    ] as const) {
      assert.match(
        src,
        /import \{ composeOutcome \} from "@\/lib\/outcome-message";/,
        `${name} does not import the composer`,
      );
    }
  });
});

describe("lib/outcome-message.ts", () => {
  const SRC = readRepoFile("lib/outcome-message.ts");

  it("knows about punctuation and not about translation", () => {
    // It takes strings because every clause is already counted, agreed and
    // declined by the time it arrives — `bulkListingsRemoved` runs through
    // `slavicPlural` in three locales. A composer that took keys would have to
    // take their params too and would be a second module that knows how
    // translation works.
    assert.ok(!SRC.includes("i18n-context"), "the composer must not import the translation map");
    // Prose about `slavicPlural` is the doc block earning its keep; a CALL to
    // it would be this module agreeing a word with a number.
    assert.doesNotMatch(SRC, /\bplural\(/, "the composer must not agree anything");
    assert.doesNotMatch(SRC, /\bslavicPlural\(/, "the composer must not agree anything");
    assert.doesNotMatch(SRC, /\bTranslationKey\b/, "the composer takes strings, not keys");
  });

  it("imports nothing at all", () => {
    assert.doesNotMatch(SRC, /^import /m, "a punctuation module with a dependency is a different module");
  });
});
