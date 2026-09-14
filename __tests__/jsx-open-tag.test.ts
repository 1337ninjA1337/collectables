import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attributeValue,
  closeTagIndex,
  jsxTags,
  openTagAt,
  openTagEnd,
  openTagsNamed,
  tagsNamed,
  skipStringLiteral,
  walkJsx,
} from "@/lib/jsx-open-tag";

/**
 * The four ways a naive JSX text scan goes wrong, each as a named case.
 *
 * These primitives were `lib/check-a11y-jsx.ts`'s private functions until a
 * suite reimplemented two of them and left out the string-literal half. Their
 * behaviour was covered only through that guard's findings — which meant a
 * case here was really a case about `<Pressable>` and `accessibilityLabel`,
 * and the underlying rule ("a `>` inside an attribute does not end the tag")
 * was never stated on its own.
 *
 * Every case below is one of the mistakes the module exists to prevent, with
 * the shape that produces it. The a11y sweep is where the cost is documented:
 * the regex version reported ten offenders where the careful version reports
 * three, and all seven extras were buttons whose label sat in attribute text
 * the regex never reached.
 */

describe("finding where an opening tag ends", () => {
  it("does not stop at a `>` inside an arrow function", () => {
    // The mistake that produced seven false positives on the a11y sweep.
    const src = `<Pressable onPress={() => go()} accessibilityLabel={t("x")} />`;
    assert.equal(openTagEnd(src, "<Pressable".length), src.length - 1);
  });

  it("does not stop at a `>` inside a string literal", () => {
    // The half the copy left out. A quoted `>` is rare and completely silent:
    // the tag ends early, the attributes after it are invisible, and the scan
    // reports a finding about props the element actually has.
    const src = `<Text accessibilityLabel=">" nativeID="after">hi</Text>`;
    const end = openTagEnd(src, "<Text".length);
    assert.equal(src[end], ">");
    assert.ok(src.slice(0, end).includes("nativeID"), src.slice(0, end + 1));
  });

  it("does not stop at a `>` inside a template literal", () => {
    const src = "<Text accessibilityLabel={`a > b`} nativeID=\"after\">hi</Text>";
    assert.ok(src.slice(0, openTagEnd(src, "<Text".length)).includes("nativeID"));
  });

  it("returns -1 for a tag that never closes", () => {
    // Mid-edit files reach these scanners. -1 is the honest answer; a scanner
    // that guessed an end would report findings about half a tag.
    assert.equal(openTagEnd("<Pressable onPress={() => go()}", 10), -1);
  });
});

describe("skipping a string literal", () => {
  it("honours a backslash escape rather than ending on it", () => {
    const src = `"a \\" b" rest`;
    assert.equal(src.slice(skipStringLiteral(src, 0)), " rest");
  });

  it("consumes the rest of the source when the literal never closes", () => {
    const src = `"unterminated`;
    assert.equal(skipStringLiteral(src, 0), src.length);
  });
});

describe("matching a close tag", () => {
  it("counts depth so a nested same-name tag does not end its parent", () => {
    // The card-of-buttons shape, which is ordinary in this tree. A scanner
    // that took the first `</Pressable>` would hand the parent's body to the
    // child and report the card as icon-only.
    const src = `<Pressable><Pressable>a</Pressable>b</Pressable>tail`;
    const outerBody = src.slice(
      src.indexOf(">") + 1,
      closeTagIndex(src, src.indexOf(">") + 1, "Pressable"),
    );
    assert.equal(outerBody, "<Pressable>a</Pressable>b");
  });

  it("returns -1 when the element never closes", () => {
    assert.equal(closeTagIndex("<Pressable>a", 11, "Pressable"), -1);
  });
});

describe("reading the tag that carries an offset", () => {
  const src = `
    <View>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="none">
        <Text>hi</Text>
      </Pressable>
    </View>`;

  it("reads back from an attribute to its whole opening tag", () => {
    const tag = openTagAt(src, src.indexOf('accessibilityRole="none"'));
    assert.ok(tag.startsWith("<Pressable"), tag);
    assert.ok(tag.endsWith(">"), tag);
    assert.ok(tag.includes("onPress={close}"), tag);
  });

  it("returns empty when the offset is not inside a tag", () => {
    assert.equal(openTagAt("no tags here", 5), "");
  });
});

describe("the walk that inherits nothing", () => {
  it("yields every tag, in document order, without an inherited field", () => {
    const tags = [...jsxTags("<View><Text>hi</Text></View><Image />")];
    assert.deepEqual(
      tags.map((tag) => tag.name),
      ["View", "Text", "Image"],
    );
    // A null every caller would have to ignore is not part of the answer.
    assert.deepEqual(Object.keys(tags[0]).includes("inherited"), false);
  });

  it("keeps the offsets, which is the whole reason to take tags over text", () => {
    const code = `  <Pressable onPress={() => go(">")}><Text>x</Text></Pressable>`;
    const [first] = [...jsxTags(code)];
    assert.equal(code[first.tagEnd], ">");
    assert.match(first.attrs, /onPress=\{\(\) => go\(">"\)\}/);
  });

  it("narrows to one element by name", () => {
    const found = tagsNamed("<View><Text>a</Text><Text>b</Text></View>", "Text");
    assert.equal(found.length, 2);
    assert.ok(found[0].start < found[1].start);
  });

  it("returns an empty list rather than nothing findable", () => {
    // `const [first] = tagsNamed(…)` is how both callers read it, so the empty
    // case has to be an array a destructure can miss on, not a throw.
    const [missing] = tagsNamed("<View />", "Profiler");
    assert.equal(missing, undefined);
  });
});

describe("every opening tag of one element", () => {
  it("returns each tag whole, including the props after the first `>` in it", () => {
    // The question three suites asked with `/<HeroBanner[\s\S]*?>/`, and the
    // reason the answer cannot be that: the arrow function ends the naive
    // match at `onPress={() ` and every assertion made afterwards is about a
    // fragment.
    const src = `
      <HeroBanner tone="solid" onPress={() => open()} title={t("x")} />
      <HeroBanner tone="amber" />`;
    const tags = openTagsNamed(src, "HeroBanner");
    assert.equal(tags.length, 2);
    assert.ok(tags[0].includes('title={t("x")}'), tags[0]);
    assert.ok(tags[0].endsWith("/>"), tags[0]);
    assert.equal(tags[1].trim(), '<HeroBanner tone="amber" />');
  });

  it("names nothing when the element is not rendered", () => {
    assert.deepEqual(openTagsNamed("<View><Text>hi</Text></View>", "HeroBanner"), []);
  });

  it("does not match a longer name that starts with the one asked for", () => {
    // `<DashboardBanner tone="amber">` is a different component's tone, and
    // the suite that motivated this helper renders both in one file.
    assert.deepEqual(openTagsNamed('<DashboardBanner tone="amber" />', "Dashboard"), []);
  });

  it("finds one rendered through a render prop", () => {
    // A render prop's JSX lives inside the PARENT'S open tag, which is the
    // hole `walkJsx` was extracted to close; going through it rather than a
    // forward scan is what makes this inherit the fix.
    const tags = openTagsNamed("<Host render={() => (<HeroBanner tone=\"solid\" />)} />", "HeroBanner");
    assert.deepEqual(tags, ['<HeroBanner tone="solid" />']);
  });
});

describe("reading a braced attribute value", () => {
  it("reads a whole inline arrow rather than stopping at its first brace", () => {
    // `onPress={() => setOpen(false)}` truncated at `setOpen(false` is the
    // shape that makes a handler compare unequal to itself written inline.
    const tag = `<Pressable onPress={() => setOpen(false)} />`;
    assert.equal(attributeValue(tag, "onPress"), "() => setOpen(false)");
  });

  it("reads through a nested object literal", () => {
    const tag = `<Pressable accessibilityState={{ disabled: true }} />`;
    assert.equal(attributeValue(tag, "accessibilityState"), "{ disabled: true }");
  });

  it("flattens whitespace, so a wrapped prop matches an inline one", () => {
    // There is no prettier in this repo, so the same expression genuinely
    // appears both ways across the tree.
    const wrapped = `<Modal\n      onRequestClose={() =>\n        setOpen(false)\n      }\n    >`;
    assert.equal(attributeValue(wrapped, "onRequestClose"), "() => setOpen(false)");
  });

  it("is not closed early by a brace inside a string", () => {
    const tag = `<Text accessibilityLabel={"}"} nativeID="x" />`;
    assert.equal(attributeValue(tag, "accessibilityLabel"), `"}"`);
  });

  it("matches the attribute name only where a name can start", () => {
    // Asking for `label` must not match `accessibilityLabel` — the near-miss
    // that turns a rule about one prop into a rule about several.
    const tag = `<Pressable accessibilityLabel={x} />`;
    assert.equal(attributeValue(tag, "label"), null);
    assert.equal(attributeValue(tag, "accessibilityLabel"), "x");
  });

  it("reads a prop that comes first, right after the tag name", () => {
    // The other end of the same rule: there is no whitespace before this one,
    // so a lookbehind for a space alone would miss it.
    assert.equal(attributeValue(`<Modal onPress={x} />`, "onPress"), "x");
  });

  it("returns null for an absent prop and for the string form", () => {
    // `accessibilityRole="none"` is a value, not an expression. A reader that
    // returned `none` for it would let a caller compare a string against the
    // handler that produces one.
    const tag = `<Pressable accessibilityRole="none" />`;
    assert.equal(attributeValue(tag, "onPress"), null);
    assert.equal(attributeValue(tag, "accessibilityRole"), null);
  });

  it("returns null when the value's brace never closes", () => {
    assert.equal(attributeValue(`<Pressable onPress={() => go(`, "onPress"), null);
  });
});

describe("walkJsx", () => {
  /**
   * The tag-stack walk this module took over from its two callers.
   *
   * Both of them wrote it themselves, months apart, and both had the same hole
   * in it — see the module header. The cases here are the walk's own
   * behaviour; what each caller inherits is theirs to test.
   */
  const names = (code: string): string[] =>
    [...walkJsx(code, { seed: false, inherit: () => false })].map((tag) => tag.name);

  it("reports every tag, outermost first", () => {
    assert.deepEqual(
      names(`<View style={s.a}><Text>hi</Text><Ionicons name="x" /></View>`),
      ["View", "Text", "Ionicons"],
    );
  });

  it("reads the JSX inside a render prop, and the carrier before it", () => {
    // The bug both copies shipped: `openTagEnd` correctly reports the carrier
    // as ending after the closing brace, so a flat walk resumes past
    // everything the prop renders.
    assert.deepEqual(
      names(`<Tabs renderTab={(k) => (<View><Text>hi</Text></View>)} />`),
      ["Tabs", "View", "Text"],
    );
  });

  it("passes what an ancestor hands down into a render prop's children", () => {
    const marked = [
      ...walkJsx<boolean>(`<Modal><Tabs renderTab={() => (<Text>hi</Text>)} /></Modal>`, {
        seed: false,
        inherit: (tag, inside) => inside || tag.name === "Modal",
      }),
    ];
    assert.deepEqual(
      marked.map((tag) => [tag.name, tag.inherited]),
      [
        ["Modal", false],
        ["Tabs", true],
        ["Text", true],
      ],
    );
  });

  it("inherits down a subtree and stops at its close tag", () => {
    const marked = [
      ...walkJsx<boolean>(`<Modal><Text>a</Text></Modal><Text>b</Text>`, {
        seed: false,
        inherit: (tag, inside) => inside || tag.name === "Modal",
      }),
    ];
    assert.deepEqual(
      marked.map((tag) => [tag.name, tag.inherited]),
      [
        ["Modal", false],
        ["Text", true],
        ["Text", false],
      ],
    );
  });

  it("does not let a self-closing tag become an ancestor", () => {
    const marked = [
      ...walkJsx<boolean>(`<Modal /><Text>b</Text>`, {
        seed: false,
        inherit: (tag, inside) => inside || tag.name === "Modal",
      }),
    ];
    assert.deepEqual(marked.map((tag) => tag.inherited), [false, false]);
  });

  it("is not fooled by a comparison, and does not choke on an unmatched close", () => {
    // `a < b` has a space after the `<`; an unmatched close tag is ignored
    // rather than thrown on, because these scanners read files mid-edit.
    assert.deepEqual(names(`<View>{count < max ? <Text>a</Text> : null}</Ionicons></View>`), [
      "View",
      "Text",
    ]);
  });

  it("hands back offsets into the string it was given", () => {
    const code = `  <Pressable onPress={() => go(">")}><Text>x</Text></Pressable>`;
    const [first] = [...walkJsx(code, { seed: null, inherit: () => null })];
    assert.equal(code.slice(first.start, first.tagEnd + 1).startsWith("<Pressable"), true);
    assert.equal(code[first.tagEnd], ">");
    assert.match(first.attrs, /onPress=\{\(\) => go\(">"\)\}/);
    assert.equal(first.selfClosing, false);
  });
});
