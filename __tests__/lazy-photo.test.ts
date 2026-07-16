import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// No React mounting harness in the repo (see the [needs-dev-dep] tasks), so
// these are structural pins on the component contract + the ItemCard adoption.
describe("LazyPhoto — loading skeleton + error fallback", () => {
  const src = read("components/lazy-photo.tsx");

  it("exports a memoized named component (DevTools-visible like ItemCard/SelectableItemRow)", () => {
    assert.match(src, /export const LazyPhoto = memo\(function LazyPhoto\b/);
  });

  it("drives a three-state machine off the Image load lifecycle", () => {
    assert.match(src, /"loading" \| "loaded" \| "error"/);
    assert.match(src, /onLoadStart=\{\(\) => setStatus\("loading"\)\}/);
    assert.match(src, /onLoadEnd=\{\(\) => setStatus\("loaded"\)\}/);
    assert.match(src, /onError=\{\(\) => setStatus\("error"\)\}/);
  });

  it("renders the AMBER_MUTED_3 skeleton under the in-flight image", () => {
    assert.match(src, /import \{ AMBER_MUTED_3 \} from "@\/lib\/design-tokens"/);
    assert.match(src, /backgroundColor: AMBER_MUTED_3/);
    // The frame clips the absolute-filled image to the caller's rounded corners.
    assert.match(src, /overflow: "hidden"/);
    assert.match(src, /StyleSheet\.absoluteFill/);
  });

  it("a failed load swaps to the caller's fallback color instead of a broken image", () => {
    assert.match(src, /if \(status === "error"\)/);
    assert.match(src, /\{ backgroundColor: fallbackColor \}/);
  });
});

describe("ItemCard — LazyPhoto adoption", () => {
  const src = read("components/item-card.tsx");

  it("both photo branches render LazyPhoto with the deterministic fallback color", () => {
    const uses = src.match(/<LazyPhoto\b/g) ?? [];
    assert.equal(uses.length, 2, "compact + full card branches");
    const fallbacks = src.match(/fallbackColor=\{placeholderColor\(item\.id\)\}/g) ?? [];
    assert.equal(fallbacks.length, 2);
  });

  it("no raw react-native Image remains in ItemCard (photos route through LazyPhoto)", () => {
    assert.ok(!/<Image\b/.test(src), "raw <Image> re-introduced");
    assert.ok(
      !/import \{[^}]*\bImage\b[^}]*\} from "react-native"/.test(src),
      "the react-native Image import should be gone",
    );
  });

  it("thumb URLs still route through withCloudinaryThumbUrl into the uri prop", () => {
    const thumbs = src.match(/uri=\{withCloudinaryThumbUrl\(item\.photos\[0\]/g) ?? [];
    assert.equal(thumbs.length, 2);
  });
});
