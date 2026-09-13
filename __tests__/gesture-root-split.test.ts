import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * 964.2 KiB of the web bundle, carried by a provider that renders a `<div>`.
 *
 * `app/_layout.tsx` imported `react-native-gesture-handler` for its side
 * effects and wrapped the app in `GestureHandlerRootView`. Nothing on web
 * needs either — `components/DraggableList.web.tsx` exists precisely because
 * `react-native-draggable-flatlist` wants gesture-handler and reanimated
 * worklets "that the web build does not carry", and the app's two other
 * gestures are React Native's own `PanResponder`. The import was the cost
 * regardless of what the component did with it.
 *
 * `npm run bundle:composition` is what turned that from a suspicion into a
 * number, and its drift report is what confirmed the fix: reanimated 632.9
 * KiB, gesture-handler 202.3, worklets 57.8, hammerjs 25.6 and semver 16.7 all
 * left the bundle, 4696.3 KiB → 3732.1. A fifth of everything the deployed
 * site downloads, for a root view.
 *
 * ## Why a file pair and not a `Platform.OS` branch
 *
 * A conditional still imports the module and the import is the cost. Metro
 * picks the file, so the split has to be at file level — the same reason
 * `DraggableList.web.tsx` is a file — and `check-platform-pairs` keeps the two
 * halves' exports in step.
 *
 * ## What this suite is for
 *
 * The saving is one import away from coming back, in a file nobody would
 * think to check. The sweep below is the thing that notices.
 */

const WEB = sourceCode("components/gesture-root.web.tsx");
const NATIVE = sourceCode("components/gesture-root.tsx");
const LAYOUT = sourceCode("app/_layout.tsx");

/** The packages the split keeps out of the web bundle, heaviest first. */
const WEB_EXCLUDED_PACKAGES = [
  "react-native-gesture-handler",
  "react-native-reanimated",
  "react-native-draggable-flatlist",
] as const;

/**
 * The files allowed to import them — the native halves of the two splits.
 *
 * Both are `.tsx` with a `.web.tsx` sibling, so Metro never resolves either on
 * web. Any other file importing one of these packages puts it back in the web
 * bundle, which is why this list is named rather than pattern-matched.
 */
const NATIVE_ONLY_FILES = [
  "components/DraggableList.tsx",
  "components/gesture-root.tsx",
] as const;

describe("the web half", () => {
  it("imports none of the gesture stack", () => {
    for (const pkg of WEB_EXCLUDED_PACKAGES) {
      assert.ok(!WEB.includes(pkg), `the web root imports ${pkg} — that is the whole 964 KiB`);
    }
  });

  it("is a plain View with the same shape as the native one", () => {
    assert.match(WEB, /import \{ View, type StyleProp, type ViewStyle \} from "react-native"/);
    assert.match(WEB, /<View style=\{style\}>\{children\}<\/View>/);
  });
});

describe("the native half", () => {
  it("keeps the root view AND the side-effect import", () => {
    // `react-native-draggable-flatlist` IS the reorder list on iOS and
    // Android, and it needs both. The side-effect import has to be first in
    // the module, which is why it is not merged into the named import below
    // it.
    assert.match(NATIVE, /^import "react-native-gesture-handler";/);
    assert.match(NATIVE, /import \{ GestureHandlerRootView \} from "react-native-gesture-handler"/);
    assert.match(NATIVE, /<GestureHandlerRootView style=\{style\}>/);
  });

  it("exports the same name as the web half", () => {
    // `check-platform-pairs` is the guard; this is the case that says what it
    // is guarding here, since a mismatch would be invisible to the typecheck
    // (node resolves the native half) and fatal on the deployed site.
    for (const half of [WEB, NATIVE]) {
      assert.match(half, /export function GestureRoot\(/);
    }
  });
});

describe("the root layout", () => {
  it("imports the split root before anything else", () => {
    // `react-native-gesture-handler` asks to be imported at the top of the
    // entry file, before any other import, and it WAS the first line here
    // until the split moved it one module down. The native half still runs
    // that side effect, so the import that pulls it has to keep the position
    // the side effect had — a detail the web half cannot notice and the
    // typecheck cannot either.
    const firstImport = LAYOUT.slice(LAYOUT.indexOf("import "));
    assert.match(
      firstImport,
      /^import \{ GestureRoot \} from "@\/components\/gesture-root";/,
    );
  });

  it("mounts the split root and imports neither package itself", () => {
    assert.match(LAYOUT, /import \{ GestureRoot \} from "@\/components\/gesture-root"/);
    assert.match(LAYOUT, /<GestureRoot style=\{styles\.shell\}>/);
    assert.ok(
      !LAYOUT.includes("react-native-gesture-handler"),
      "the layout imports gesture-handler again, which puts it back on web",
    );
  });
});

describe("the sweep that keeps it out", () => {
  it("leaves exactly two files importing the gesture stack", () => {
    // The saving is one import away from coming back. A screen that reaches
    // for `Gesture`/`GestureDetector`, or a component that imports reanimated
    // for an animation, re-adds 964 KiB to every page load — and nothing about
    // that diff would look expensive.
    const offenders = sourceFiles("app", "components", "lib")
      .filter((file) => !file.endsWith(".web.tsx") && !file.endsWith(".web.ts"))
      .filter((file) => {
        const code = sourceCode(file);
        return WEB_EXCLUDED_PACKAGES.some((pkg) => code.includes(`from "${pkg}`));
      })
      .sort();
    assert.deepEqual(
      offenders,
      [...NATIVE_ONLY_FILES],
      "a file outside the native halves imports the gesture stack — on web that is 964 KiB back in the bundle",
    );
  });

  it("names only files that have a web sibling", () => {
    // What makes the exemption safe: Metro resolves the `.web.tsx` on web, so
    // these two are never reached there. An exempt file with no sibling would
    // be an exemption that does nothing.
    const files = sourceFiles("components");
    for (const file of NATIVE_ONLY_FILES) {
      const sibling = file.replace(/\.tsx$/, ".web.tsx");
      assert.ok(files.includes(sibling), `${file} has no ${sibling} — it ships to web`);
    }
  });
});
