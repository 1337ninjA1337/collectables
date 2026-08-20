import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  describeIconLabelFinding,
  findUnlabeledIconButtons,
  formatIconLabelReport,
  HIDE_PLATFORMS,
  type HidePlatform,
  type IconLabelCode,
} from "@/lib/check-a11y-jsx";

/**
 * The scanner behind `npm run lint:a11y-jsx`.
 *
 * Most of these cases are the false positives the FIRST version produced. A
 * plain `/<Pressable([\s\S]*?)>/` reported ten unlabeled icon buttons on this
 * tree and seven of them carried a label: the open tag it captured ended at
 * the `>` inside `onPress={() => x}`, so the attribute text it tested was a
 * fragment that stopped before the label. Every one of those seven is a case
 * here, because a guard that cries wolf seven times out of ten is a guard
 * somebody turns off.
 */

/**
 * The three props that hide an icon everywhere, as this tree now writes them.
 *
 * Spelled once because every fixture below whose SUBJECT is a label needs its
 * icon to be decided about — an undecided one is its own finding, and a case
 * asserting two rules at once stops saying which one it is for.
 */
const HIDDEN = 'accessibilityElementsHidden importantForAccessibility="no" aria-hidden';

const findings = (source: string) => findUnlabeledIconButtons("app/x.tsx", source);
const codes = (source: string) => findings(source).map((f) => f.code);

describe("findUnlabeledIconButtons", () => {
  it("flags an icon-only Pressable with no label", () => {
    const found = findings(`
      <Pressable style={styles.chip} onPress={close} accessibilityRole="button">
        <Ionicons name="close" size={14} ${HIDDEN} />
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
        <Pressable onPress={() => setOpen(true)} accessibilityLabel={t("search")} accessibilityRole="button">
          <Ionicons name="search" size={18} ${HIDDEN} />
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
          accessibilityRole="button"
        >
          <Ionicons name="chevron-forward" ${HIDDEN} />
        </Pressable>
      `),
      [],
    );
  });

  it("does not let a quoted angle bracket end the tag", () => {
    assert.deepEqual(
      codes(`
        <Pressable title=">" accessibilityLabel={t("x")}>
          <Ionicons name="close" ${HIDDEN} />
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
        <Pressable onPress={save} accessibilityRole="button">
          <Ionicons name="save" ${HIDDEN} />
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
        <Pressable onPress={openCard} accessibilityRole="button">
          <Text>{title}</Text>
          <Pressable onPress={remove} accessibilityRole="button">
            <Ionicons name="trash" ${HIDDEN} />
          </Pressable>
        </Pressable>
      `),
      ["unlabeled"],
    );
  });

  it("ignores a self-closing Pressable, which has no children to be icon-only", () => {
    assert.deepEqual(codes(`<Pressable style={styles.backdrop} onPress={close} accessibilityRole="none" />`), []);
  });

  it("ignores a component whose name merely starts with Pressable", () => {
    assert.deepEqual(
      codes(`
        <PressableRow onPress={go}>
          <Ionicons name="chevron-forward" ${HIDDEN} />
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
        <Pressable onPress={open} accessibilityLabel="More currencies" accessibilityRole="button">
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
        <Pressable onPress={open} accessibilityLabel="Close" accessibilityRole="button">
          <Ionicons name="close" ${HIDDEN} />
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
        // <Pressable onPress={x}><Ionicons name="close" ${HIDDEN} /></Pressable>
        /* <Pressable><Ionicons name="close" ${HIDDEN} /></Pressable> */
        <Pressable onPress={x} accessibilityLabel={t("close")} accessibilityRole="button">
          <Ionicons name="close" ${HIDDEN} />
        </Pressable>
      `),
      [],
    );
  });

  it("reports every finding in a file, in source order", () => {
    const found = findings(`
      <Pressable onPress={a} accessibilityRole="button"><Ionicons name="a" ${HIDDEN} /></Pressable>
      <Pressable onPress={b} accessibilityLabel="B" accessibilityRole="button"><Text>b</Text></Pressable>
      <Pressable onPress={c} accessibilityRole="button"><Ionicons name="c" ${HIDDEN} /></Pressable>
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
    assert.doesNotThrow(() => findings(`<Pressable onPress={x}><Ionicons ${HIDDEN} />`));
  });
});

describe("the three platform props", () => {
  const missingOf = (source: string): (readonly HidePlatform[] | undefined)[] =>
    findings(source).map((f) => f.missing);

  it("flags an element hidden on iOS only", () => {
    assert.deepEqual(
      codes(`<View accessibilityElementsHidden><Text>a</Text></View>`),
      ["half_hidden"],
    );
    assert.deepEqual(missingOf(`<View accessibilityElementsHidden><Text>a</Text></View>`), [
      ["android", "web"],
    ]);
  });

  it("flags an element hidden on Android only", () => {
    assert.deepEqual(codes(`<Text importantForAccessibility="no">1</Text>`), ["half_hidden"]);
    assert.deepEqual(missingOf(`<Text importantForAccessibility="no">1</Text>`), [["ios", "web"]]);
  });

  it("flags an element hidden on web only", () => {
    // The mirror image of the native-pair mistake, and the one this repository
    // would make next: `aria-hidden` alone reads as done to anyone testing in
    // a browser, and `<Ionicons>` renders a `<Text>`, which does not derive
    // the native props from it the way `<View>` does.
    assert.deepEqual(codes(`<Text aria-hidden>a</Text>`), ["half_hidden"]);
    assert.deepEqual(missingOf(`<Text aria-hidden>a</Text>`), [["ios", "android"]]);
  });

  it("flags the native pair that forgot the web, which is what every site here was", () => {
    // Before 2026-08-20 all seven decorative icons in this tree looked exactly
    // like this, and the rule that only paired iOS with Android said nothing.
    assert.deepEqual(
      missingOf(`<Text accessibilityElementsHidden importantForAccessibility="no">a</Text>`),
      [["web"]],
    );
  });

  it("says nothing when all three travel together", () => {
    assert.deepEqual(
      codes(`
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          aria-hidden
        >
          <Text>a</Text>
        </View>
      `),
      [],
    );
    assert.deepEqual(
      codes(
        `<Ionicons accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />`,
      ),
      [],
    );
  });

  it("does not read importantForAccessibility=\"yes\" as part of a hide", () => {
    // The opposite instruction: this node should be announced, and it wants no
    // partners. A rule that matched on the prop NAME would demand two.
    assert.deepEqual(codes(`<View importantForAccessibility="yes"><Text>a</Text></View>`), []);
  });

  it("does not read an explicitly disabled hide as part of one", () => {
    assert.deepEqual(codes(`<View accessibilityElementsHidden={false}><Text>a</Text></View>`), []);
    assert.deepEqual(codes(`<View aria-hidden={false}><Text>a</Text></View>`), []);
    // Spaces inside the braces are the same instruction.
    assert.deepEqual(codes(`<View aria-hidden={ false }><Text>a</Text></View>`), []);
  });

  it("does not let a longer attribute ending in aria-hidden stand in for it", () => {
    // `-` is a word boundary, so a `\\b` in front of the pattern would pass
    // this. The rule needs the attribute to BE aria-hidden, not end in it.
    assert.deepEqual(
      missingOf(`<Text accessibilityElementsHidden importantForAccessibility="no" data-aria-hidden>a</Text>`),
      [["web"]],
    );
  });

  it("never reports a node as missing every platform or none", () => {
    // Both ends are non-findings by construction: hidden everywhere is done,
    // hidden nowhere never asked to be. This pins the two boundaries so a
    // future fourth platform cannot turn every plain <View> into a finding.
    assert.deepEqual(codes(`<View><Text>a</Text></View>`), []);
    for (const found of findings(`
      <View accessibilityElementsHidden>
        <Text aria-hidden>a</Text>
      </View>
    `)) {
      const missing = found.missing ?? [];
      assert.ok(missing.length > 0 && missing.length < HIDE_PLATFORMS.length);
    }
  });

  it("checks every element, not only Pressables", () => {
    // The sites in this tree are icons, views and text. Scoping the rule to
    // buttons would have covered none of them.
    const found = findings(`
      <View accessibilityElementsHidden>
        <Text importantForAccessibility="no">a</Text>
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
      <Pressable onPress={a} accessibilityRole="button"><Ionicons name="a" ${HIDDEN} /></Pressable>
    `));
    assert.match(report, /Found 1 accessibility problem\(s\)/);
    assert.match(report, /app\/x\.tsx:2/);
    assert.match(report, /announces it as "button" and nothing else/);
  });

  it("gives every code a sentence", () => {
    const all: IconLabelCode[] = [
      "unlabeled",
      "untranslated",
      "half_hidden",
      "undecided_icon",
      "silent_disabled",
      "no_role",
    ];
    for (const code of all) {
      const said = describeIconLabelFinding(code);
      assert.ok(said.length > 40, `${code} is described in fewer words than a reason`);
    }
  });

  it("names the platforms a half-hidden node is still announced on", () => {
    // The generic sentence says the three props travel together; this is the
    // half that says which one THIS line is short of, so a reader does not
    // have to diff the rule against the snippet to find out.
    const report = formatIconLabelReport(
      findings(`
        <Ionicons accessibilityElementsHidden importantForAccessibility="no" />
      `),
    );
    assert.match(report, /still announced on web/);
    assert.match(report, /add aria-hidden \(web\)/);
    assert.doesNotMatch(report, /still announced on ios/);
  });

  it("leaves the label codes' sentences platform-free", () => {
    // `missing` is a half_hidden field; passing platforms alongside another
    // code must not graft a hiding clause onto a labelling problem.
    const said = describeIconLabelFinding("unlabeled", ["web"]);
    assert.equal(said, describeIconLabelFinding("unlabeled"));
  });

  it("names every platform in the hide set somewhere in its sentence", () => {
    // Exhaustive over HIDE_PLATFORMS: a fourth platform added to the set with
    // no prop named for it would produce findings nobody can act on.
    const said = describeIconLabelFinding("half_hidden", HIDE_PLATFORMS);
    for (const platform of HIDE_PLATFORMS) {
      assert.match(said, new RegExp(`\\(${platform}\\)`), `${platform} has no prop in the sentence`);
    }
  });
});

describe("the icon nobody decided about", () => {
  it("flags a bare icon", () => {
    // Announced as whatever the glyph font resolves to, on every platform.
    assert.deepEqual(codes(`<View><Ionicons name="a" /></View>`), ["undecided_icon"]);
  });

  it("says nothing about an icon that is hidden, or one that is named", () => {
    assert.deepEqual(codes(`<View><Ionicons name="a" ${HIDDEN} /></View>`), []);
    assert.deepEqual(codes(`<View><Ionicons name="a" accessibilityLabel={t("x")} /></View>`), []);
  });

  it("counts an ancestor that hides the whole subtree", () => {
    // `item-card.tsx`'s photo-count badge is a glyph AND a bare number, hidden
    // together so the "5" does not survive on its own. Demanding props on the
    // icon inside it would be demanding the redundant.
    assert.deepEqual(
      codes(`
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          <Ionicons name="a" />
          <Text>5</Text>
        </View>
      `),
      [],
    );
  });

  it('does not count importantForAccessibility="no" on an ancestor', () => {
    // The distinction that makes this a stack rather than a flag: on Android
    // "no" hides the node and leaves its children announced. Only
    // "no-hide-descendants" takes the subtree.
    assert.deepEqual(
      codes(`
        <View accessibilityElementsHidden importantForAccessibility="no" aria-hidden>
          <Ionicons name="a" />
        </View>
      `),
      ["undecided_icon"],
    );
  });

  it("stops covering at the ancestor's closing tag", () => {
    // The failure a stack that never popped would produce: everything after
    // the first hidden container looks hidden forever.
    const found = findings(`
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <Ionicons name="inside" />
      </View>
      <Ionicons name="after" />
    `);
    assert.deepEqual(found.map((f) => f.code), ["undecided_icon"]);
    assert.match(found[0].snippet, /name="after"/);
  });

  it("does not accept a label on an ancestor Pressable as the icon's decision", () => {
    // On iOS that label REPLACES the subtree, so the icon is silent there and
    // announced on the web — the exact split this guard exists to catch.
    // Hiding it says the same thing on all three platforms.
    assert.deepEqual(
      codes(`
        <Pressable accessibilityLabel={t("x")}>
          <Ionicons name="a" />
          <Text>hi</Text>
        </Pressable>
      `),
      ["undecided_icon"],
    );
  });

  it("reports a bare icon in an icon-only button as both problems", () => {
    // They are two different fixes: the BUTTON needs a name, and the ICON
    // needs hiding. Reporting one would leave the other in place.
    assert.deepEqual(
      codes(`<Pressable onPress={x} accessibilityRole="button"><Ionicons name="a" /></Pressable>`),
      ["unlabeled", "undecided_icon"],
    );
  });
});

describe("the button that is greyed out and says nothing", () => {
  it("flags a disabled Pressable with no accessibilityState", () => {
    // Greyed-out is a colour, and a colour reaches nobody: the button is
    // offered as though pressing it would do something.
    assert.deepEqual(
      codes(`<Pressable onPress={go} disabled={n === 0} accessibilityRole="button"><Text>go</Text></Pressable>`),
      ["silent_disabled"],
    );
  });

  it("says nothing when the state names disabled", () => {
    assert.deepEqual(
      codes(`
        <Pressable onPress={go} disabled={n === 0} accessibilityState={{ disabled: n === 0 }} accessibilityRole="button">
          <Text>go</Text>
        </Pressable>
      `),
      [],
    );
  });

  it("does not accept an accessibilityState that names something else", () => {
    // A tab carrying {{ selected }} beside a disabled prop is exactly as
    // silent as one carrying nothing — which is why this checks the KEY and
    // not the presence of the prop.
    assert.deepEqual(
      codes(`
        <Pressable onPress={go} disabled={off} accessibilityState={{ selected: on }} accessibilityRole="button">
          <Text>go</Text>
        </Pressable>
      `),
      ["silent_disabled"],
    );
  });

  it("says nothing about a Pressable that never takes disabled", () => {
    assert.deepEqual(codes(`<Pressable onPress={go} accessibilityRole="button"><Text>go</Text></Pressable>`), []);
  });

  it("does not confuse a longer prop name for disabled", () => {
    assert.deepEqual(codes(`<Pressable onPress={go} isDisabled={x} accessibilityRole="button"><Text>go</Text></Pressable>`), []);
  });

  it("leaves a custom component alone, which may forward disabled correctly", () => {
    // `<DangerSection disabled>` passes it to a Pressable that DOES announce
    // it. A rule that could not see inside the component would be wrong about
    // both of this tree's call sites.
    assert.deepEqual(codes(`<DangerSection onAction={go} disabled={n === 0} />`), []);
  });

  it("reports a disabled icon-only button as every problem it has", () => {
    // Three separate fixes: the button needs a name, the icon needs deciding,
    // and the disabled state needs saying. Reporting one hides the others.
    // Sorted, because these three sit on one line and findings are ordered by
    // line — within a line the order is which rule ran first, which is an
    // implementation detail no reader of the report depends on.
    assert.deepEqual(
      codes(`<Pressable onPress={x} disabled={y} accessibilityRole="button"><Ionicons name="a" /></Pressable>`).sort(),
      ["silent_disabled", "undecided_icon", "unlabeled"],
    );
  });
});

describe("the tappable that never says it is a button", () => {
  it("flags an interactive Pressable with no role", () => {
    // Neither React Native nor react-native-web defaults a role, so it
    // announces as generic text rather than as something that can be pressed.
    assert.deepEqual(codes(`<Pressable onPress={go}><Text>go</Text></Pressable>`), ["no_role"]);
  });

  it('counts accessibilityRole="none" as a role — it is a deliberate opt-out', () => {
    // A modal backdrop dismisses on press and is not a control; `none` is that
    // decision written down, not the absence of one.
    assert.deepEqual(
      codes(`<Pressable onPress={close} accessibilityRole="none"><View /></Pressable>`),
      [],
    );
    assert.deepEqual(
      codes(`<Pressable onPress={go} accessibilityRole="button"><Text>go</Text></Pressable>`),
      [],
    );
  });

  it("says nothing about a Pressable with no onPress — it is a layout wrapper", () => {
    assert.deepEqual(codes(`<Pressable style={styles.card}><Text>hi</Text></Pressable>`), []);
  });

  it("reports a naked interactive icon button as all three of its problems", () => {
    // No name, an undecided icon, and no role — three separate fixes, and the
    // one-line order is which rule ran first, which no report reader depends on.
    assert.deepEqual(
      codes(`<Pressable onPress={x}><Ionicons name="a" /></Pressable>`).sort(),
      ["no_role", "undecided_icon", "unlabeled"],
    );
  });
});
