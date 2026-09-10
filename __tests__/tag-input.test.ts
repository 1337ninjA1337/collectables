import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TAG_COLORS } from "@/lib/design-tokens";
import { addTagToList, tagColorForLabel } from "@/lib/tag-input";
import type { ItemTag } from "@/lib/types";
import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeStrings } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Adding a tag, which was written twice with the same three rules and
 * different variable names.
 *
 * The two copies could have disagreed about what a duplicate is, or handed the
 * same label two colours, and nothing would have noticed — both screens pull
 * React Native, so the only thing that could ever be asserted about either was
 * the text of its source.
 */
const tag = (label: string, color: string): ItemTag => ({ label, color });

describe("tagColorForLabel", () => {
  it("gives one label the same colour every time", () => {
    // The point of colour-coding: "sealed" is the same hue on every card it
    // appears on, rather than whatever slot that item's rotation had free.
    const first = tagColorForLabel("sealed", []);
    const second = tagColorForLabel("sealed", []);
    assert.equal(first, second);
    assert.ok(TAG_COLORS.includes(first as (typeof TAG_COLORS)[number]));
  });

  it("folds case and surrounding space into the same colour", () => {
    const plain = tagColorForLabel("sealed", []);
    assert.equal(tagColorForLabel("Sealed", []), plain);
    assert.equal(tagColorForLabel("  SEALED  ", []), plain);
  });

  it("does not put two tags on one item in the same colour", () => {
    // Two labels can hash to one slot, and two same-coloured tags side by side
    // is what a user reads as a mistake — so the label's hue is a preference,
    // not a rule.
    const preferred = tagColorForLabel("sealed", []);
    const other = tagColorForLabel("sealed", [preferred]);
    assert.notEqual(other, preferred);
    assert.ok(TAG_COLORS.includes(other as (typeof TAG_COLORS)[number]));
  });

  it("stays total once every slot is taken", () => {
    const all = [...TAG_COLORS];
    const color = tagColorForLabel("eleventh", all);
    assert.ok(TAG_COLORS.includes(color as (typeof TAG_COLORS)[number]));
  });

  it("spreads labels across the palette rather than favouring one hue", () => {
    // A hash that collapsed (say, on length) would be deterministic AND
    // useless: every tag the same colour is the same as no colour-coding.
    const labels = ["sealed", "graded", "mint", "rare", "foil", "signed", "promo", "first print"];
    const hues = new Set(labels.map((label) => tagColorForLabel(label, [])));
    assert.ok(hues.size >= 4, `only ${String(hues.size)} distinct hues across ${String(labels.length)} labels`);
  });
});

describe("addTagToList", () => {
  it("appends a trimmed label with its colour", () => {
    const result = addTagToList([], "  sealed  ");
    assert.equal(result.status, "added");
    if (result.status !== "added") return;
    assert.equal(result.tags.length, 1);
    assert.equal(result.tags[0].label, "sealed");
    assert.equal(result.tags[0].color, tagColorForLabel("sealed", []));
  });

  it("keeps the existing tags, in order, ahead of the new one", () => {
    const existing = [tag("graded", TAG_COLORS[0]), tag("mint", TAG_COLORS[1])];
    const result = addTagToList(existing, "sealed");
    assert.equal(result.status, "added");
    if (result.status !== "added") return;
    assert.deepEqual(result.tags.slice(0, 2), existing);
    assert.equal(result.tags[2].label, "sealed");
  });

  it("reports an empty submit as empty, whitespace included", () => {
    assert.equal(addTagToList([], "").status, "empty");
    assert.equal(addTagToList([], "   ").status, "empty");
  });

  it("reports a duplicate rather than silently doing nothing", () => {
    // The bare `return` this replaces looked exactly like a broken Add button.
    const existing = [tag("Sealed", TAG_COLORS[0])];
    const result = addTagToList(existing, " sealed ");
    assert.equal(result.status, "duplicate");
    if (result.status !== "duplicate") return;
    assert.equal(result.existing.label, "Sealed", "the duplicate should name the tag already there");
  });

  it("leaves the existing casing alone on a duplicate", () => {
    // The user typed that one first; rewriting it under them on a second
    // submit is a silent edit of data they can see.
    const existing = [tag("Sealed", TAG_COLORS[0])];
    assert.deepEqual(existing, [tag("Sealed", TAG_COLORS[0])]);
    addTagToList(existing, "SEALED");
    assert.deepEqual(existing, [tag("Sealed", TAG_COLORS[0])]);
  });

  it("never mutates the list it was given", () => {
    const existing = [tag("graded", TAG_COLORS[0])];
    addTagToList(existing, "sealed");
    assert.equal(existing.length, 1);
  });
});

describe("both tag forms go through the one implementation", () => {
  for (const screen of ["app/create.tsx", "app/item/[id].tsx"]) {
    it(`${screen} adds through addTagToList and says when it refuses`, () => {
      const source = readRepoFile(screen);
      assert.match(source, /const result = addTagToList\(/);
      assert.match(source, /toast\.info\(t\("tagsDuplicate"\)\)/);
      // The hand-written rules are gone, not merely bypassed.
      assert.doesNotMatch(source, /tag\.label\.toLowerCase\(\) === label\.toLowerCase\(\)/);
      assert.doesNotMatch(source, /nextTagColor\(/);
    });
  }

  it("declares the duplicate hint in every locale, translated", () => {
    const src = readI18nSource();
    assertDeclaredInEveryLocale(src, "tagsDuplicate");
    const values = localeStrings(src, "tagsDuplicate");
    assert.equal(new Set(values.values()).size, values.size, "tagsDuplicate repeats a string");
  });
});
