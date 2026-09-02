import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { installedPackagePath } from "./helpers/installed-packages";

/**
 * The dependency behaviour that `sheet-modal-semantics` argues FROM.
 *
 * That suite's whole case is that eleven sheets need no `accessibilityViewIsModal`
 * because they are inside a `<Modal>`, and on the platform most of this app's
 * users are on — the web build deployed to GitHub Pages — "inside a Modal"
 * means whatever `react-native-web` decides it means. Today that is three
 * separate things: `aria-modal` with `role="dialog"` on the content, a focus
 * trap wrapping it, and Escape calling `onRequestClose`. All three were read
 * out of `node_modules` by a person once and then written into a doc comment,
 * which is where a fact about a dependency goes to stop being checked.
 *
 * So this is the cheap version of what `lint:sentry-version` does for the
 * Sentry SDK: pin the behaviour where an upgrade has to walk past it. If a
 * future `react-native-web` drops the focus trap or the Escape handler, the
 * eleven sheets do not change and nothing about them looks wrong — they simply
 * stop being modal for a screen reader, and the suggestion this all came from
 * ("a screen reader can walk out of a sheet into the content behind") becomes
 * correct at last. A failure here is not "the test is stale"; it is the signal
 * to re-read the module and decide what the sheets now need.
 *
 * Reads the SHIPPED files rather than importing the module, for the same
 * reason every other structural suite here reads text: `react-native-web` is a
 * React Native peer and `tsx --test` cannot transform its entry points.
 */

const MODAL_DIR = ["dist", "exports", "Modal"] as const;

/** The installed version, for a failure message that says WHICH version broke. */
function installedVersion(): string {
  const pkg = installedPackagePath("react-native-web", "package.json");
  if (!existsSync(pkg)) return "not installed";
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version?: string }).version ?? "unknown";
}

/**
 * One file out of the installed Modal implementation.
 *
 * Fails CLOSED on a missing file: an upgrade that renames or bundles these
 * away must fail loudly, because "the file this suite reads is gone" is the
 * single most likely way for the premise to change, and a `try`/`catch`
 * returning `""` would turn every case below into a silent pass.
 */
function modalSource(file: string): string {
  const at = installedPackagePath("react-native-web", ...MODAL_DIR, file);
  assert.ok(
    existsSync(at),
    `react-native-web ${installedVersion()} no longer ships exports/Modal/${file}. The sheet suite's premise — that <Modal> provides aria-modal, a focus trap and Escape-to-close on web — was read out of this file. Re-read the new implementation and update sheet-modal-semantics.test.ts before deleting this case.`,
  );
  return readFileSync(at, "utf8");
}

describe("react-native-web's Modal still provides what the sheets rely on", () => {
  it("is installed, and this suite says which version it checked", () => {
    // Not a version pin: the point is not to freeze the dependency, it is that
    // a failure below names the version somebody has to go and read.
    assert.notEqual(installedVersion(), "not installed");
  });

  it("marks the content aria-modal, so assistive tech scopes to it", () => {
    const content = modalSource("ModalContent.js");
    assert.match(
      content,
      /"aria-modal":\s*true/,
      `react-native-web ${installedVersion()} no longer sets aria-modal on modal content — a screen reader can now walk out of every sheet in this tree into the screen behind it`,
    );
  });

  it("gives the content a dialog role while it is open", () => {
    const content = modalSource("ModalContent.js");
    assert.match(
      content,
      /role:\s*active\s*\?\s*'dialog'/,
      `react-native-web ${installedVersion()} no longer gives an open modal role="dialog"`,
    );
  });

  it("closes on Escape by calling onRequestClose", () => {
    const content = modalSource("ModalContent.js");
    // Both halves, because either one alone is not the behaviour: a listener
    // that no longer reads Escape, and an Escape branch that no longer calls
    // the prop, are different regressions with the same symptom.
    assert.match(
      content,
      /e\.key === 'Escape'/,
      `react-native-web ${installedVersion()} no longer listens for Escape — every sheet here loses its keyboard dismissal`,
    );
    assert.match(
      content,
      /onRequestClose\(\)/,
      `react-native-web ${installedVersion()} no longer calls onRequestClose from its key handler`,
    );
  });

  it("wraps the content in a focus trap", () => {
    // The half that `accessibilityViewIsModal` would have been asked to
    // provide. Asserted at the wiring rather than only at the module's
    // existence: a ModalFocusTrap that ships but is no longer rendered is the
    // regression that leaves the file in place and the behaviour gone.
    const index = modalSource("index.js");
    assert.match(index, /import ModalFocusTrap from '\.\/ModalFocusTrap'/);
    assert.match(
      index,
      /createElement\(ModalFocusTrap/,
      `react-native-web ${installedVersion()} no longer renders ModalFocusTrap around modal content — Tab can now leave an open sheet`,
    );
    assert.match(
      modalSource("ModalFocusTrap.js"),
      /focusFirstDescendant|focusLastDescendant/,
      `react-native-web ${installedVersion()}'s ModalFocusTrap no longer moves focus back into the modal`,
    );
  });

  it("passes onRequestClose down to the content that acts on it", () => {
    const index = modalSource("index.js");
    assert.match(index, /onRequestClose/);
    assert.match(index, /createElement\(ModalContent/);
  });
});
