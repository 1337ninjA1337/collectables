import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readRepoFile as read } from "./helpers/repo-file";
import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * Two classes of avoidable console noise on the deployed web build, both
 * captured from a production DevTools session:
 *
 *  1. `[expo-image-picker] ImagePicker.MediaTypeOptions have been deprecated.
 *     Use ImagePicker.MediaType or an array of ImagePicker.MediaType instead.`
 *     — logged once per picker launch. `MediaTypeOptions` is still accepted by
 *     expo-image-picker 17 but is on its way out; the replacement is the plain
 *     string union (`["images"]`).
 *
 *  2. `Animated: useNativeDriver is not supported because the native animated
 *     module is missing.` — react-native-web has no native animation module,
 *     so every `useNativeDriver: true` warns and then runs on the JS thread
 *     anyway. `USE_NATIVE_DRIVER` gates it on the platform for identical
 *     behaviour without the log line.
 *
 * Both are noise rather than breakage, which is exactly why they need a guard:
 * nothing fails when they come back, they just bury real errors in the console.
 *
 * BOTH SWEEPS READ `sourceCode`, NOT THE RAW FILE (2026-08-29). They read the
 * raw text until then, so a module that merely NAMED the shape in prose was an
 * offender — and `lib/animation-driver.ts` names it twice, in the doc block
 * explaining why the constant exists. It was excluded by hand for that reason,
 * with the path spelled inside the filter, and the exclusion was the only
 * thing standing between a guard and a false report about its own subject.
 * Stripping comments is the fix for both halves at once: the guard stops
 * reading prose, the hole has nothing left to excuse, and a real
 * `useNativeDriver: true` inside the driver module — the one file that was
 * exempt from the rule it declares — is now an offender like any other.
 */

const SOURCE_FILES = sourceFiles("app", "components", "lib");

describe("expo-image-picker — no deprecated MediaTypeOptions", () => {
  it("no source file reaches for the deprecated enum", () => {
    const offenders = SOURCE_FILES.filter((f) => sourceCode(f).includes("MediaTypeOptions"));
    assert.deepEqual(
      offenders,
      [],
      `use the MediaType string union (mediaTypes: ["images"]) instead:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("every picker launch still restricts to images", () => {
    const withPicker = SOURCE_FILES.filter((f) => sourceCode(f).includes("launchImageLibraryAsync"));
    assert.ok(withPicker.length >= 6, `expected the known picker call sites, got ${withPicker.length}`);
    for (const file of withPicker) {
      assert.match(
        read(file),
        /mediaTypes: \["images"\]/,
        `${file} must scope the picker to images`,
      );
    }
  });
});

describe("Animated — no native-driver warning on web", () => {
  it("USE_NATIVE_DRIVER is derived from the platform, not hard-coded", () => {
    assert.match(
      read("lib/animation-driver.ts"),
      /export const USE_NATIVE_DRIVER = Platform\.OS !== "web";/,
    );
  });

  it("no source file passes a bare `useNativeDriver: true`", () => {
    const offenders = SOURCE_FILES.filter((f) => sourceCode(f).includes("useNativeDriver: true"));
    assert.deepEqual(
      offenders,
      [],
      `route these through USE_NATIVE_DRIVER:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("is reading a tree that still passes the option at all", () => {
    // The control the sweep never had, and needs more since 2026-08-29 than it
    // did before: dropping the raw read took its match count in the whole walk
    // to zero, so it now asserts an absence over a tree where the offending
    // spelling is extinct. Nothing in it would notice `useNativeDriver` being
    // renamed by a react-native major, or every animation moving to Reanimated
    // — the sweep would go on reporting a clean tree about a property no file
    // states any more. Four modules pass the option today; the floor is three
    // so one of them can stop animating without a ratification.
    const passers = SOURCE_FILES.filter((f) => sourceCode(f).includes("useNativeDriver"));
    assert.ok(
      passers.length >= 3,
      `only ${passers.length} module(s) pass useNativeDriver at all — the sweep above is reading a tree that stopped using the option, so its clean report is about nothing (four at the last count): ${passers.join(", ")}`,
    );
  });

  it("the exemption this sweep used to carry was excusing a comment", () => {
    // Why there is no hole here any more, kept as an assertion rather than as a
    // sentence: `lib/animation-driver.ts` was the sweep's one exclusion, and
    // the only thing in it that ever matched sits in the doc block above the
    // constant. The raw file still says the shape; the code does not. If that
    // ever stops being true the sweep above turns red — which is the correct
    // answer for the module that declares the alternative — and this case says
    // so first, in the words of the exclusion it replaced.
    assert.ok(read("lib/animation-driver.ts").includes("useNativeDriver: true"));
    assert.ok(!sourceCode("lib/animation-driver.ts").includes("useNativeDriver: true"));
  });

  it("the transform/opacity animations adopted the constant", () => {
    for (const file of ["app/wishlist.tsx", "components/skeleton.tsx", "lib/toast-context.tsx"]) {
      const src = read(file);
      assert.match(src, /import \{ USE_NATIVE_DRIVER \} from "@\/lib\/animation-driver";/, file);
      assert.match(src, /useNativeDriver: USE_NATIVE_DRIVER/, file);
    }
  });

  it("leaves layout-driving animations on the JS driver", () => {
    // swipe-tabs animates width/height/translate on a container — the native
    // driver cannot handle layout props, so `false` there is correct on every
    // platform and must NOT be swapped for the constant.
    const src = read("components/swipe-tabs.tsx");
    assert.match(src, /useNativeDriver: false/);
    assert.doesNotMatch(src, /USE_NATIVE_DRIVER/);
  });
});
