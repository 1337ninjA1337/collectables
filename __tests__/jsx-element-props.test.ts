import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertNoElementHas,
  assertSomeElementHas,
  elementTagWith,
  elementTags,
  elementWith,
} from "./helpers/jsx-element-props";

/**
 * The helper that replaced thirty-one `/<FlatList[\s\S]*?prop[\s\S]*?\/>/`
 * assertions.
 *
 * Every case below is one of the three ways that shape lied, plus the vacuity
 * floor each function carries. The shape read as "the FlatList sets this prop"
 * and meant "somewhere after some `<FlatList` there is this text before some
 * `>`", which on a screen with three of them is a different question.
 */

/** Three FlatLists, as `app/collection/[id].tsx` renders them. */
const THREE_LISTS = `
  <FlatList
    data={visibleItems}
    numColumns={masonryColumnCount}
    windowSize={5}
    refreshControl={<RefreshControl refreshing={showRefreshing} />}
  />
  <View>
    <FlatList data={selected} windowSize={7} onEndReached={loadMore} />
  </View>
  <FlatList data={dragRows} scrollEnabled={false} />
`;

describe("elementTags", () => {
  it("returns every tag of that element", () => {
    assert.equal(elementTags(THREE_LISTS, "FlatList").length, 3);
  });

  it("refuses a source that renders none, rather than answering vacuously", () => {
    // `some(…)` is false and `every(…)` true over an empty list, so a rule
    // built on either would pass over a tree it never read.
    assert.throws(
      () => elementTags("<View />", "FlatList", "app/x.tsx"),
      /app\/x\.tsx renders no <FlatList>/,
    );
  });

  it("does not count an element named only in prose", () => {
    // Comments are blanked first. A screen that NAMES `<CollectionShareSheet>`
    // in its doc block has a tag there as far as a text walk is concerned, and
    // it has no props — which is how the first migrated suite failed.
    assert.deepEqual(elementTags("// see <FlatList>\n<FlatList data={x} />", "FlatList").length, 1);
  });

  it("reads a tag whose open tag carries a commented apostrophe", () => {
    // The walk used to return NOTHING for a file like this, silently. Stripping
    // comments is what this helper does about it; `skipStringLiteral` is what
    // the module does about it.
    const src = `<FlatList\n  // the list's own scroll\n  data={rows}\n/>`;
    assert.match(elementTags(src, "FlatList")[0], /data=\{rows\}/);
  });
});

describe("assertSomeElementHas / assertNoElementHas", () => {
  it("finds a prop on any one of the elements", () => {
    assertSomeElementHas(THREE_LISTS, "FlatList", /windowSize=\{7\}/);
  });

  it("does NOT find a prop that no single element carries", () => {
    // The lie the old shape told: `windowSize={5}` is on the first list and
    // `scrollEnabled={false}` on the third, and a wildcard from the first
    // `<FlatList` to a later `>` spans both. Asked of one element, it fails.
    assert.throws(
      () => assertSomeElementHas(THREE_LISTS, "FlatList", /windowSize=\{5\}[\s\S]*scrollEnabled/),
      /no <FlatList>/,
    );
  });

  it("does not read a nested element's props as the parent's", () => {
    // `refreshControl={<RefreshControl … />}` is a render prop: it lives
    // inside the FlatList's own opening tag, so `refreshing` IS the list's to
    // find — and `onEndReached`, which belongs to the SECOND list, is not.
    assertSomeElementHas(THREE_LISTS, "FlatList", /refreshing=\{showRefreshing\}/);
    const first = elementTagWith(THREE_LISTS, "FlatList", /numColumns/, "the viewer list");
    assert.doesNotMatch(first, /onEndReached/);
  });

  it("reports every offender when the negative fails", () => {
    assert.throws(
      () => assertNoElementHas(THREE_LISTS, "FlatList", /data=/),
      /FlatList/,
    );
  });

  it("both refuse a source with none of the element", () => {
    assert.throws(() => assertSomeElementHas("<View />", "FlatList", /x/), /renders no <FlatList>/);
    assert.throws(() => assertNoElementHas("<View />", "FlatList", /x/), /renders no <FlatList>/);
  });
});

describe("elementTagWith", () => {
  it("picks the one element the marker identifies", () => {
    const viewer = elementTagWith(THREE_LISTS, "FlatList", /numColumns/, "the viewer list");
    assert.match(viewer, /windowSize=\{5\}/);
    assert.doesNotMatch(viewer, /windowSize=\{7\}/);
  });

  it("refuses two matches rather than taking the first", () => {
    // A marker that stopped identifying anything would otherwise keep the
    // suite green while it tested a list nobody meant.
    assert.throws(
      () => elementTagWith(THREE_LISTS, "FlatList", /data=/, "the list"),
      /expected exactly one <FlatList> carrying .*found 3/,
    );
  });

  it("refuses none, for the same reason", () => {
    assert.throws(
      () => elementTagWith(THREE_LISTS, "FlatList", /horizontal/, "the list"),
      /found 0/,
    );
  });
});

describe("elementWith", () => {
  const CHIPS = `
    <Pressable onPress={outer}>
      <Pressable key={v} accessibilityRole="button">
        <Text>inner</Text>
      </Pressable>
      <Text>after</Text>
    </Pressable>
  `;

  it("ends at the element's OWN close, not its first child's", () => {
    // `/<Pressable[\s\S]*?key=\{v\}[\s\S]*?<\/Pressable>/` was written six
    // times; here it would start at the outer Pressable and end at the inner
    // one's close, so the "chip" being asserted about is two elements.
    const chip = elementWith(CHIPS, "Pressable", /key=\{v\}/, "the chip");
    assert.match(chip.tag, /key=\{v\}/);
    assert.match(chip.body, /inner/);
    assert.doesNotMatch(chip.body, /after/);
    assert.ok(chip.text.startsWith("<Pressable key={v}"));
    assert.ok(chip.text.endsWith("</Pressable>"));
  });

  it("says the tag and the body separately, since they answer different questions", () => {
    // Props live in the tag; what an element WRAPS lives in the body. The old
    // one string conflated them, so `doesNotMatch` on "the chip" could fail on
    // a child's prop.
    const chip = elementWith(CHIPS, "Pressable", /key=\{v\}/, "the chip");
    assert.doesNotMatch(chip.tag, /Text/);
    assert.doesNotMatch(chip.body, /accessibilityRole/);
  });

  it("refuses an element that never closes", () => {
    assert.throws(
      () => elementWith(`<Modal open><Text>x</Text>`, "Modal", /open/, "the sheet"),
      /never closes/,
    );
  });
});
