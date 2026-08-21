import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * Every sheet in this tree is inside a `<Modal>`, and that is what makes its
 * screen-reader semantics correct.
 *
 * This suite exists because of a suggestion that was WRONG, and the wrongness
 * is worth recording so it is not filed a fourth time. It read:
 * "`accessibilityViewIsModal` is set on none of the nine — a sheet is drawn
 * over the screen and a screen reader can still walk out of it into the
 * content behind." That was written while sweeping `accessibilityRole` across
 * the tree, from the JSX of the sandwich alone, and it did not account for
 * what the sandwich is nested in.
 *
 * Every one of these sheets is rendered inside React Native's `<Modal>`, and
 * a Modal is not a positioned `<View>` on any of the three platforms:
 *
 *  - iOS presents a separate view controller, which UIKit scopes VoiceOver to;
 *  - Android renders a Dialog, which is its own window for TalkBack;
 *  - `react-native-web` — checked in `node_modules`, not assumed — renders
 *    `ModalContent` with `aria-modal: true` and `role="dialog"`, wraps the
 *    children in `ModalFocusTrap` (which loops Tab inside the modal and pulls
 *    focus back if it escapes), and closes on Escape.
 *
 * So `accessibilityViewIsModal` would be a redundant prop in eleven files, and
 * the honest change is not to add it. What IS worth having is this: the
 * property that makes it unnecessary, asserted, so the day somebody builds a
 * sheet as a bare absolutely-positioned overlay — no focus trap, no Escape
 * key, and genuinely escapable by a screen reader — a named case says so
 * instead of the suggestion being right at last and nobody noticing.
 */

/**
 * The sheet sandwich's fingerprint: a full-screen backdrop whose press
 * dismisses, wrapping a card whose only `onPress` is `e.stopPropagation()`.
 * Both opt out of a role with `accessibilityRole="none"`, and no other shape
 * in this tree uses that prop twice in one file.
 */
const OPT_OUT = /accessibilityRole="none"/g;

/** Byte ranges covered by a `<Modal …>…</Modal>` element, in one source. */
function modalSpans(code: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const opens = [...code.matchAll(/<Modal[\s>]/g)].map((m) => m.index!);
  for (const start of opens) {
    // These do not nest anywhere in this tree, so the next close is this
    // element's close. A nested one would make the span too small, which fails
    // closed rather than open — the assertion below would report a sandwich as
    // outside a Modal, not wave one through.
    const end = code.indexOf("</Modal>", start);
    if (end !== -1) spans.push({ start, end });
  }
  return spans;
}

/** Files carrying the sandwich, with the offsets of each opt-out. */
function sheetFiles(): { file: string; code: string; optOuts: number[] }[] {
  const found: { file: string; code: string; optOuts: number[] }[] = [];
  for (const file of sourceFiles()) {
    const code = sourceCode(file);
    const optOuts = [...code.matchAll(OPT_OUT)].map((m) => m.index!);
    if (optOuts.length > 0) found.push({ file, code, optOuts });
  }
  return found;
}

describe("every sheet sandwich is inside a Modal", () => {
  const files = sheetFiles();

  it("finds the sandwich in the files that are supposed to have it", () => {
    // A walk that matched nothing would make every case below vacuously true,
    // which is the failure mode this whole repository's floors exist for.
    assert.ok(
      files.length >= 10,
      `only ${files.length} files carry the sheet sandwich — the sweep that placed them found eleven, so this walk is reading less than it should`,
    );
  });

  for (const { file, code, optOuts } of files) {
    it(`${file} nests every role opt-out inside a Modal`, () => {
      const spans = modalSpans(code);
      const outside = optOuts.filter(
        (at) => !spans.some((span) => at > span.start && at < span.end),
      );
      assert.deepEqual(
        outside.map((at) => code.slice(0, at).split("\n").length),
        [],
        `${file} draws a sheet outside a <Modal>. A positioned <View> overlay has no focus trap, no Escape-to-close and no aria-modal, so a screen reader can walk out of it into the screen behind — which is exactly what <Modal> is doing for the other sheets here. Wrap it, or give this one accessibilityViewIsModal plus the Android hiding of everything behind it.`,
      );
    });
  }

  it("pairs the opt-outs, since a sheet has exactly a backdrop and a card", () => {
    // The sandwich is two: the backdrop that dismisses and the card that stops
    // the press reaching it. An odd count means one of the pair has quietly
    // become a control again, or a third opt-out was added without a reason.
    const odd = files.filter(({ optOuts }) => optOuts.length % 2 !== 0);
    assert.deepEqual(
      odd.map((f) => `${f.file} (${f.optOuts.length})`),
      [],
      "a sheet's backdrop and card opt out of a role together; an odd number means one of them changed",
    );
  });

  it("adds no redundant accessibilityViewIsModal, which Modal already provides", () => {
    // The other half of the finding, and the reason it is asserted rather than
    // left as a comment: the suggestion that asked for this prop was filed
    // three times. A future sweep adding it to eleven files would be adding
    // dead weight, and this is where that gets said.
    const redundant = files.filter(({ code }) =>
      code.includes("accessibilityViewIsModal"),
    );
    assert.deepEqual(
      redundant.map((f) => f.file),
      [],
      "accessibilityViewIsModal on a sheet already inside <Modal> is redundant — iOS presents a separate view controller, Android a Dialog, and react-native-web sets aria-modal with a focus trap",
    );
  });
});
