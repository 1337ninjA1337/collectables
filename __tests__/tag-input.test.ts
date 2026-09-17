import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TAG_COLORS } from "@/lib/design-tokens";
import {
  addTagToList,
  normalizeItemTags,
  normalizeTagList,
  rebalanceTagColors,
  removeTagAt,
  tagColorForLabel,
} from "@/lib/tag-input";
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

/**
 * Two labels that hash to the SAME palette slot, found by running the hash
 * rather than by guessing.
 *
 * Every case below about a freed hue needs a real collision: on a list of
 * labels that never collide, a rebalance and a plain delete produce identical
 * output and the whole suite would pass on the bug. If the hash or the palette
 * size changes, this assertion fails first and says so, instead of the cases
 * quietly going vacuous.
 */
const COLLIDING: readonly [string, string] = ["sealed", "holo"];

/** `addTagToList`, for the cases that only ever add labels it accepts. */
function added(tags: readonly ItemTag[], label: string): ItemTag[] {
  const result = addTagToList(tags, label);
  assert.equal(result.status, "added", `expected ${label} to be added`);
  return result.status === "added" ? result.tags : [];
}

describe("rebalanceTagColors", () => {
  it("has a genuine collision to work with", () => {
    const [first, second] = COLLIDING;
    assert.equal(
      tagColorForLabel(first, []),
      tagColorForLabel(second, []),
      "the labels no longer collide — pick a new pair from the hash",
    );
  });

  it("gives a tag its own hue back once the tag that took it has gone", () => {
    // The decay this exists for: `tagColorForLabel` looks at the visible set at
    // ADD time and never again, so a borrowed colour was borrowed for good.
    const [first, second] = COLLIDING;
    const preferred = tagColorForLabel(second, []);

    const both = added(added([], first), second);
    assert.equal(both.length, 2);
    assert.notEqual(both[1].color, preferred, "the second tag should have taken a rotation colour");

    const left = rebalanceTagColors([both[1]]);
    assert.equal(left[0].color, preferred);
    assert.equal(left[0].label, both[1].label, "the label is not what changes");
  });

  it("leaves the tag the user did not touch where it was", () => {
    // Left to right, because an earlier tag changing colour when a later one
    // is deleted is the more surprising of the two directions.
    const [first, second] = COLLIDING;
    const preferred = tagColorForLabel(first, []);
    const rebalanced = rebalanceTagColors([tag(first, preferred), tag(second, TAG_COLORS[7])]);
    assert.equal(rebalanced[0].color, preferred);
    assert.notEqual(rebalanced[1].color, preferred, "and the collision is still resolved");
  });

  it("keeps every colour on the item distinct", () => {
    const labels = ["sealed", "holo", "error", "open", "graded", "psa10"];
    const rebalanced = rebalanceTagColors(labels.map((label) => tag(label, TAG_COLORS[0])));
    assert.equal(new Set(rebalanced.map((t) => t.color)).size, labels.length);
  });

  it("returns the list by identity when nothing moved", () => {
    // The callers write this straight back into state; a fresh array every
    // time would re-render the row on every delete that changed no colour.
    const settled = rebalanceTagColors([tag("sealed", tagColorForLabel("sealed", []))]);
    assert.equal(rebalanceTagColors(settled), settled);
  });

  it("keeps each unchanged tag's own object", () => {
    const stable = tag("sealed", tagColorForLabel("sealed", []));
    const rebalanced = rebalanceTagColors([stable, tag("holo", TAG_COLORS[0])]);
    assert.equal(rebalanced[0], stable);
  });

  it("never mutates the list it was given", () => {
    const given = [tag("holo", TAG_COLORS[0])];
    rebalanceTagColors(given);
    assert.equal(given[0].color, TAG_COLORS[0]);
  });

  it("says nothing about an empty list", () => {
    assert.deepEqual(rebalanceTagColors([]), []);
  });
});

describe("removeTagAt", () => {
  it("removes the entry at that index and nothing else", () => {
    const tags = [tag("a", TAG_COLORS[0]), tag("b", TAG_COLORS[1]), tag("c", TAG_COLORS[2])];
    assert.deepEqual(
      removeTagAt(tags, 1).map((t) => t.label),
      ["a", "c"],
    );
  });

  it("removes by index rather than by label, so two casings do not both go", () => {
    // `addTagToList` refuses a duplicate, but a list arriving from storage or
    // a peer's edit can carry both — and a delete that took two rows would be
    // a silent extra edit.
    const tags = [tag("Sealed", TAG_COLORS[0]), tag("sealed", TAG_COLORS[1])];
    assert.equal(removeTagAt(tags, 0).length, 1);
    assert.equal(removeTagAt(tags, 0)[0].label, "sealed");
  });

  it("rebalances what is left, which is the whole reason it is not a filter", () => {
    const [first, second] = COLLIDING;
    const preferred = tagColorForLabel(second, []);
    const tags = [tag(first, preferred), tag(second, TAG_COLORS[7])];
    const left = removeTagAt(tags, 0);
    assert.equal(left.length, 1);
    assert.equal(left[0].color, preferred);
  });

  it("returns the list unchanged, by identity, for an index nothing is at", () => {
    // A stale press on a row that has already gone is a real sequence on a
    // slow render.
    const tags = [tag("a", TAG_COLORS[0])];
    assert.equal(removeTagAt(tags, 1), tags);
    assert.equal(removeTagAt(tags, -1), tags);
    assert.equal(removeTagAt([], 0).length, 0);
  });

  it("never mutates the list it was given", () => {
    const tags = [tag("a", TAG_COLORS[0]), tag("b", TAG_COLORS[1])];
    removeTagAt(tags, 0);
    assert.equal(tags.length, 2);
  });
});

describe("normalizeTagList", () => {
  it("drops a case-folded duplicate and keeps the FIRST casing", () => {
    // The add rule, applied to a list that never went through the add: the
    // casing that arrived first is the one the user typed.
    const normalized = normalizeTagList([tag("Sealed", TAG_COLORS[0]), tag("sealed", TAG_COLORS[1])]);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].label, "Sealed");
  });

  it("drops a label that is empty or only space", () => {
    // A chip with nothing in it is unreadable and removable only by guessing
    // which gap in the row it is.
    const normalized = normalizeTagList([tag("", TAG_COLORS[0]), tag("   ", TAG_COLORS[1]), tag("mint", TAG_COLORS[2])]);
    assert.deepEqual(normalized.map((t) => t.label), ["mint"]);
  });

  it("trims rather than treating the space as part of the label", () => {
    const normalized = normalizeTagList([tag(" sealed ", TAG_COLORS[0])]);
    assert.equal(normalized[0].label, "sealed");
  });

  it("folds two labels that differ only by surrounding space into one", () => {
    const normalized = normalizeTagList([tag("sealed", TAG_COLORS[0]), tag(" SEALED ", TAG_COLORS[1])]);
    assert.equal(normalized.length, 1);
  });

  it("re-derives the colours, so an old row means the same hue as a new one", () => {
    // The vector: a device on an older build, writing hues from the rotation
    // that predates the label hash.
    const normalized = normalizeTagList([tag("sealed", TAG_COLORS[9])]);
    assert.equal(normalized[0].color, tagColorForLabel("sealed", []));
  });

  it("is idempotent, which is what makes it safe on a read path", () => {
    // The cloud merge compares a normalized row against a normalized local
    // one. A pass that changed something on its second run would mark every
    // pull as a change and rewrite both storage blobs on each one.
    const messy = [tag("Sealed", TAG_COLORS[0]), tag(" sealed", TAG_COLORS[1]), tag("holo", TAG_COLORS[2])];
    const once = normalizeTagList(messy);
    assert.equal(normalizeTagList(once), once, "the second pass should be a no-op, by identity");
  });

  it("returns a settled list by identity", () => {
    const settled = normalizeTagList([tag("sealed", TAG_COLORS[0]), tag("graded", TAG_COLORS[1])]);
    assert.equal(normalizeTagList(settled), settled);
  });

  it("never mutates the list it was given", () => {
    const given = [tag(" Sealed ", TAG_COLORS[0]), tag("sealed", TAG_COLORS[1])];
    normalizeTagList(given);
    assert.equal(given.length, 2);
    assert.equal(given[0].label, " Sealed ");
  });

  it("says nothing about an empty list", () => {
    assert.deepEqual(normalizeTagList([]), []);
  });
});

describe("normalizeItemTags", () => {
  const item = (id: string, tags?: ItemTag[]) => ({ id, tags });

  it("normalizes each item's tags", () => {
    const [normalized] = normalizeItemTags([item("a", [tag("Sealed", TAG_COLORS[0]), tag("sealed", TAG_COLORS[1])])]);
    assert.equal(normalized.tags?.length, 1);
  });

  it("leaves an item with no tags alone, by identity", () => {
    const untagged = item("a");
    assert.equal(normalizeItemTags([untagged])[0], untagged);
  });

  it("keeps the items it did not change, by identity", () => {
    // The hydrate writes this straight into state and then into both storage
    // blobs; an item rebuilt for nothing is a re-render and two writes.
    const settled = item("a", normalizeTagList([tag("sealed", TAG_COLORS[0])]));
    const messy = item("b", [tag("Holo", TAG_COLORS[0]), tag("holo", TAG_COLORS[1])]);
    const normalized = normalizeItemTags([settled, messy]);
    assert.equal(normalized[0], settled);
    assert.notEqual(normalized[1], messy);
  });

  it("returns the whole list by identity when no item moved", () => {
    const items = [item("a"), item("b", normalizeTagList([tag("sealed", TAG_COLORS[0])]))];
    assert.equal(normalizeItemTags(items), items);
  });

  it("never mutates the list it was given", () => {
    const items = [item("a", [tag("Sealed", TAG_COLORS[0]), tag("sealed", TAG_COLORS[1])])];
    normalizeItemTags(items);
    assert.equal(items[0].tags?.length, 2);
  });
});

describe("the read paths put an outside list under the same rules", () => {
  it("normalizes the hydrated item list, beside the three passes already there", () => {
    const source = readRepoFile("lib/collections-context.tsx");
    assert.match(source, /dedupeItems\(normalizeItemTags\(normalizedItems\)\)/);
  });

  it("normalizes a cloud row at the seam it crosses, not in the validator", () => {
    // `coerceItemRow` is defensive and says only that the shape is a
    // `{label, color}[]` — which is true of every list this rule rejects. A
    // product rule inside a validator would also rewrite hues on a path with
    // no comparison to decide whether anything changed.
    assert.match(readRepoFile("lib/collections-cloud-merge.ts"), /const item = normalizedTags\(row\);/);
    assert.doesNotMatch(readRepoFile("lib/supabase-row-coerce.ts"), /normalizeTagList/);
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

    it(`${screen} removes through removeTagAt, so the hues are rebalanced`, () => {
      // The inline `filter` both screens wrote is the delete that leaves a
      // borrowed colour borrowed for good — invisible on the screen that did
      // it, and wrong on every card the tag appears on afterwards.
      const source = readRepoFile(screen);
      assert.match(source, /removeTagAt\(/);
      assert.doesNotMatch(source, /\.filter\(\(_, j\) => j !== i\)/, "the inline delete came back");
    });
  }

  it("declares the duplicate hint in every locale, translated", () => {
    const src = readI18nSource();
    assertDeclaredInEveryLocale(src, "tagsDuplicate");
    const values = localeStrings(src, "tagsDuplicate");
    assert.equal(new Set(values.values()).size, values.size, "tagsDuplicate repeats a string");
  });
});
