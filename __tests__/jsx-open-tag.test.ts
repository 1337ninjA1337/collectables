import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attributeValue,
  closeTagIndex,
  openTagAt,
  openTagEnd,
  skipStringLiteral,
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
