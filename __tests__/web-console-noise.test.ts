import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readRepoFile as read } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

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
 */

const SOURCE_FILES = sourceFiles("app", "components", "lib");

describe("expo-image-picker — no deprecated MediaTypeOptions", () => {
  it("no source file reaches for the deprecated enum", () => {
    const offenders = SOURCE_FILES.filter((f) => read(f).includes("MediaTypeOptions"));
    assert.deepEqual(
      offenders,
      [],
      `use the MediaType string union (mediaTypes: ["images"]) instead:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("every picker launch still restricts to images", () => {
    const withPicker = SOURCE_FILES.filter((f) => read(f).includes("launchImageLibraryAsync"));
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
    const offenders = SOURCE_FILES.filter(
      (f) => f !== "lib/animation-driver.ts" && read(f).includes("useNativeDriver: true"),
    );
    assert.deepEqual(
      offenders,
      [],
      `route these through USE_NATIVE_DRIVER:\n  ${offenders.join("\n  ")}`,
    );
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
