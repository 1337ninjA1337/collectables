import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  describeIconLabelFinding,
  findUnlabeledIconButtons,
  formatIconLabelReport,
  type IconLabelCode,
} from "@/lib/check-a11y-icon-labels";

/**
 * The scanner behind `npm run lint:a11y-icon-labels`.
 *
 * Most of these cases are the false positives the FIRST version produced. A
 * plain `/<Pressable([\s\S]*?)>/` reported ten unlabeled icon buttons on this
 * tree and seven of them carried a label: the open tag it captured ended at
 * the `>` inside `onPress={() => x}`, so the attribute text it tested was a
 * fragment that stopped before the label. Every one of those seven is a case
 * here, because a guard that cries wolf seven times out of ten is a guard
 * somebody turns off.
 */

const findings = (source: string) => findUnlabeledIconButtons("app/x.tsx", source);
const codes = (source: string) => findings(source).map((f) => f.code);

describe("findUnlabeledIconButtons", () => {
  it("flags an icon-only Pressable with no label", () => {
    const found = findings(`
      <Pressable style={styles.chip} onPress={close}>
        <Ionicons name="close" size={14} />
      </Pressable>
    `);
    assert.deepEqual(
      found.map((f) => ({ code: f.code, line: f.line })),
      [{ code: "unlabeled", line: 2 }],
    );
    assert.match(found[0].snippet, /<Pressable style=\{styles\.chip\}/);
  });

  it("reads past an arrow function in an attribute, which is what broke the regex", () => {
    // The seven false positives in one line: `() =>` ends the open tag for any
    // scanner that stops at the first `>`, so `accessibilityLabel` sat in text
    // it never looked at.
    assert.deepEqual(
      codes(`
        <Pressable onPress={() => setOpen(true)} accessibilityLabel={t("search")}>
          <Ionicons name="search" size={18} />
        </Pressable>
      `),
      [],
    );
  });

  it("reads past a comparison, a generic and a nested object in an attribute", () => {
    assert.deepEqual(
      codes(`
        <Pressable
          style={{ ...styles.a, ...(n > 3 ? styles.b : {}) }}
          onPress={() => move(i, i + 1)}
          accessibilityLabel={t("next")}
        >
          <Ionicons name="chevron-forward" />
        </Pressable>
      `),
      [],
    );
  });

  it("does not let a quoted angle bracket end the tag", () => {
    assert.deepEqual(
      codes(`
        <Pressable title=">" accessibilityLabel={t("x")}>
          <Ionicons name="close" />
        </Pressable>
      `),
      [],
    );
  });

  it("leaves a button that has readable text alone", () => {
    // An icon beside a label is named by the label; demanding a second one
    // makes screen-reader output worse, not better.
    assert.deepEqual(
      codes(`
        <Pressable onPress={save}>
          <Ionicons name="save" />
          <Text>{t("save")}</Text>
        </Pressable>
      `),
      [],
    );
  });

  it("gives a nested Pressable its own body rather than its parent's", () => {
    // A row of buttons inside a pressable card is the ordinary shape here. A
    // scanner taking the first `</Pressable>` hands the card the child's body
    // and reports the card as an icon button.
    assert.deepEqual(
      codes(`
        <Pressable onPress={openCard}>
          <Text>{title}</Text>
          <Pressable onPress={remove}>
            <Ionicons name="trash" />
          </Pressable>
        </Pressable>
      `),
      ["unlabeled"],
    );
  });

  it("ignores a self-closing Pressable, which has no children to be icon-only", () => {
    assert.deepEqual(codes(`<Pressable style={styles.backdrop} onPress={close} />`), []);
  });

  it("ignores a component whose name merely starts with Pressable", () => {
    assert.deepEqual(
      codes(`
        <PressableRow onPress={go}>
          <Ionicons name="chevron-forward" />
        </PressableRow>
      `),
      [],
    );
  });

  it("flags a label written as a bare string, however icon-free the button is", () => {
    // The bug next door: <CurrencyInput> HAD a label, in English, for all six
    // languages. A rule that only asks whether one is present passes that.
    assert.deepEqual(
      codes(`
        <Pressable onPress={open} accessibilityLabel="More currencies">
          <Text>+</Text>
        </Pressable>
      `),
      ["untranslated"],
    );
  });

  it("does not report one button twice", () => {
    // An unlabeled button cannot also be an untranslated one, and a literal
    // label already answers the "can a screen reader name this" question.
    assert.equal(
      findings(`
        <Pressable onPress={open} accessibilityLabel="Close">
          <Ionicons name="close" />
        </Pressable>
      `).length,
      1,
    );
  });

  it("reads the forbidden shapes out of a comment as prose", () => {
    // This module's own doc block shows an unlabeled icon button. Stripping
    // comments first is what lets the rule stay "not at all" rather than grow
    // an exemption for every file that explains it.
    assert.deepEqual(
      codes(`
        // <Pressable onPress={x}><Ionicons name="close" /></Pressable>
        /* <Pressable><Ionicons name="close" /></Pressable> */
        <Pressable onPress={x} accessibilityLabel={t("close")}>
          <Ionicons name="close" />
        </Pressable>
      `),
      [],
    );
  });

  it("reports every finding in a file, in source order", () => {
    const found = findings(`
      <Pressable onPress={a}><Ionicons name="a" /></Pressable>
      <Pressable onPress={b} accessibilityLabel="B"><Text>b</Text></Pressable>
      <Pressable onPress={c}><Ionicons name="c" /></Pressable>
    `);
    assert.deepEqual(
      found.map((f) => f.code),
      ["unlabeled", "untranslated", "unlabeled"],
    );
    assert.deepEqual(
      found.map((f) => f.line),
      [2, 3, 4],
    );
  });

  it("survives an unclosed tag instead of hanging or throwing", () => {
    // A file mid-edit, or one this scanner simply does not understand. The
    // honest answer is "nothing to report here", not a crash in a lint run.
    assert.doesNotThrow(() => findings(`<Pressable onPress={x}`));
    assert.doesNotThrow(() => findings(`<Pressable onPress={x}><Ionicons />`));
  });
});

describe("the paired platform props", () => {
  it("flags an element hidden on iOS only", () => {
    assert.deepEqual(
      codes(`<View accessibilityElementsHidden><Ionicons name="a" /></View>`),
      ["half_hidden"],
    );
  });

  it("flags an element hidden on Android only", () => {
    assert.deepEqual(codes(`<Text importantForAccessibility="no">1</Text>`), ["half_hidden"]);
  });

  it("says nothing when both halves travel together", () => {
    assert.deepEqual(
      codes(`
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Ionicons name="a" />
        </View>
      `),
      [],
    );
    assert.deepEqual(
      codes(`<Ionicons accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />`),
      [],
    );
  });

  it("does not read importantForAccessibility=\"yes\" as half a pair", () => {
    // The opposite instruction: this node should be announced, and it wants no
    // iOS partner. A rule that paired on the prop NAME would demand one.
    assert.deepEqual(codes(`<View importantForAccessibility="yes"><Text>a</Text></View>`), []);
  });

  it("does not read an explicitly disabled iOS hide as half a pair", () => {
    assert.deepEqual(codes(`<View accessibilityElementsHidden={false}><Text>a</Text></View>`), []);
  });

  it("checks every element, not only Pressables", () => {
    // The eight sites in this tree are icons, views and text. Scoping the rule
    // to buttons would have covered none of them.
    const found = findings(`
      <View accessibilityElementsHidden>
        <Ionicons name="a" importantForAccessibility="no" />
      </View>
    `);
    assert.deepEqual(
      found.map((f) => f.line),
      [2, 3],
    );
    assert.deepEqual(
      found.map((f) => f.code),
      ["half_hidden", "half_hidden"],
    );
  });
});

describe("the report", () => {
  it("is empty when there is nothing to report", () => {
    assert.equal(formatIconLabelReport([]), "");
  });

  it("names the file, the line and what is wrong with it", () => {
    const report = formatIconLabelReport(findings(`
      <Pressable onPress={a}><Ionicons name="a" /></Pressable>
    `));
    assert.match(report, /Found 1 accessibility problem\(s\)/);
    assert.match(report, /app\/x\.tsx:2/);
    assert.match(report, /announces it as "button" and nothing else/);
  });

  it("gives every code a sentence", () => {
    const all: IconLabelCode[] = ["unlabeled", "untranslated", "half_hidden"];
    for (const code of all) {
      const said = describeIconLabelFinding(code);
      assert.ok(said.length > 40, `${code} is described in fewer words than a reason`);
    }
  });
});
