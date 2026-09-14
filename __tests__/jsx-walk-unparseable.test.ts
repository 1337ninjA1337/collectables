import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findUnlabeledIconButtons } from "@/lib/check-a11y-jsx";
import { findUnmaskedInputTags } from "@/lib/check-clarity-input-mask";
import { findEmptyStateWrapperOverrides } from "@/lib/check-empty-state-wrappers";
import { jsxTags, openTagEnd } from "@/lib/jsx-open-tag";

/**
 * What each JSX-walking rule does with a tag it cannot parse.
 *
 * `lib/jsx-open-tag.ts` is forgiving by design — these scanners read files
 * mid-edit, and one that threw would turn a lint run into a crash — so an
 * unclosed tag comes back as -1 and `walkJsx` stops there. That is the
 * PRIMITIVE's decision. What each RULE should then do is a separate question,
 * and until `check-clarity-input-mask` was found failing open on 2026-09-14
 * nobody had asked it of the other three: each one inherited "skip it" from
 * whoever wrote the walk, and the answer was never written down.
 *
 * IT DEPENDS ON WHAT THE RULE IS ABOUT, and the split is clean:
 *
 *  - A rule about a SHAPE ("is this icon button unlabeled", "does this
 *    wrapper set a card background") is looking for an offence. A tag it
 *    cannot read is not evidence of one, and reporting it would mean a
 *    half-typed file fails a lint run that is otherwise about design tokens.
 *    Skipping is right, and these three skip.
 *
 *  - A rule about a REQUIRED ATTRIBUTE ("does this input carry the privacy
 *    mask") is looking for an absence. A tag it cannot read is exactly the
 *    case where the attribute might be missing and nobody can tell, so
 *    skipping it is an unearned pass. `check-clarity-input-mask` reports it,
 *    and did not until it was caught treating the rest of the file as one
 *    enormous tag.
 *
 * Every case here is that decision, pinned per rule, so the next scanner has
 * a precedent to read rather than a habit to copy.
 */

/** An opening tag whose brace depth never returns to 0. */
const UNCLOSED = "style={{ flex: 1";

describe("the primitive is forgiving and says so", () => {
  it("reports -1 rather than guessing an end", () => {
    assert.equal(openTagEnd(`<View ${UNCLOSED}`, "<View".length), -1);
  });

  it("stops the walk at the tag it cannot read", () => {
    // Not "skips it and carries on": the cursor has nowhere to resume from,
    // so everything after an unparseable tag is outside the walk too. That is
    // the fact every rule below is deciding what to do about.
    const src = `<View />\n<Pressable ${UNCLOSED}\n<Ionicons name="x" />`;
    assert.deepEqual(
      [...jsxTags(src)].map((tag) => tag.name),
      ["View"],
    );
  });
});

describe("a rule about a shape skips what it cannot read", () => {
  it("check-a11y-jsx reports nothing about an unparseable Pressable", () => {
    // A half-typed button is not an unlabeled button. Reporting it would mean
    // a file being edited fails a run about accessibility labels, with a
    // message about a label that may well be on the next keystroke.
    const src = `<Pressable ${UNCLOSED}\n  <Ionicons name="close" />\n</Pressable>`;
    assert.deepEqual(findUnlabeledIconButtons("app/x.tsx", src), []);
  });

  it("and still reports the one it CAN read, before the tag it cannot", () => {
    // The floor under the case above: a scanner that returned [] for every
    // source would satisfy it. This says the walk was working up to the point
    // it stopped.
    const src = [
      `<Pressable onPress={go}>`,
      `  <Ionicons name="close" accessibilityElementsHidden importantForAccessibility="no" aria-hidden />`,
      `</Pressable>`,
      `<Pressable ${UNCLOSED}`,
    ].join("\n");
    assert.deepEqual(
      findUnlabeledIconButtons("app/x.tsx", src).map((f) => f.code),
      ["no_role", "unlabeled"],
    );
  });

  it("check-empty-state-wrappers reports nothing about an unparseable View", () => {
    // Same reasoning: the rule is "is this wrapper's background card-ish",
    // and a wrapper whose style cannot be read is not a wrapper with a bad
    // background. It is also the case where the EmptyState below is outside
    // the walk entirely, so there is nothing to attribute a finding to.
    const src = `<View ${UNCLOSED}\n  <EmptyState />`;
    assert.deepEqual(findEmptyStateWrapperOverrides("app/x.tsx", src), []);
  });

  it("and still reports the wrapper it CAN read", () => {
    const src = `<View style={{ backgroundColor: "#f0e6d8" }}>\n  <EmptyState />\n</View>`;
    assert.deepEqual(
      findEmptyStateWrapperOverrides("app/x.tsx", src).map((f) => f.background),
      ['"#f0e6d8"'],
    );
  });
});

describe("a rule about a required attribute reports what it cannot read", () => {
  it("check-clarity-input-mask names the tag instead of trusting it", () => {
    // The asymmetry this suite exists to record. An input whose tag cannot be
    // read is precisely the case where the privacy mask might be missing, so
    // a skip is an unearned pass — and the version before 2026-09-14 did
    // worse than skip: it treated the rest of the file as the tag, so one
    // `data-clarity-mask` anywhere below marked every input compliant.
    const found = findUnmaskedInputTags("app/x.tsx", `<TextInput ${UNCLOSED}`);
    assert.equal(found.length, 1);
    assert.match(found[0].hint, /never closes/);
  });

  it("and says something different about a tag it read and found bare", () => {
    // Two failures, two sentences: "fix the tag" and "add the mask" are not
    // the same instruction, and a reader who gets the wrong one looks in the
    // wrong place.
    const found = findUnmaskedInputTags("app/x.tsx", `<TextInput value={v} />`);
    assert.equal(found.length, 1);
    assert.match(found[0].hint, /MaskedTextInput/);
    assert.doesNotMatch(found[0].hint, /never closes/);
  });
});
