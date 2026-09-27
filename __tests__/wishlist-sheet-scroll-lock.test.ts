import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRepoFile as read } from "./helpers/repo-file";

/**
 * The scroll lock that was written to a ref and read as a prop.
 *
 * Dragging the wishlist "Add" sheet down is a vertical gesture over a
 * `ScrollView` that also wants vertical gestures, so the sheet's
 * `PanResponder` takes the list out of the way for the duration of the drag:
 * `onPanResponderGrant` turns scrolling off, `onPanResponderRelease` turns it
 * back on. That flag was a `useRef(true)` — assigned from the handlers, read
 * as `scrollEnabled={scrollEnabled.current}` in the render.
 *
 * React is not watching a ref assignment, so the prop the ScrollView actually
 * held was whatever the last render had computed: `true`, for the whole drag,
 * every time. The lock did nothing.
 *
 * **And the render it depended on is why "did nothing" is the good case.** Any
 * unrelated re-render during the gesture — a chunked-list page arriving, a
 * theme or currency change, a parent context update — would have picked the
 * `false` up mid-drag, and one after the release the `true`. The behaviour was
 * a function of what else the screen happened to be doing, which is the shape
 * of bug that reproduces for one person and for nobody else.
 *
 * `react-hooks/refs` reports exactly this as "cannot access refs during
 * render", one of 44 across eight files, and it is the only one of them that
 * was a behaviour bug rather than a construction idiom.
 */
describe("app/wishlist.tsx — the sheet's scroll lock", () => {
  const src = read("app/wishlist.tsx");

  it("holds the flag in state, not in a ref", () => {
    assert.match(
      src,
      /const \[scrollEnabled, setScrollEnabled\] = useState\(true\);/,
      "the lock must be state — a ref assignment does not re-render, so the prop never changes",
    );
    assert.doesNotMatch(src, /scrollEnabled\.current/, "no reader or writer may be left on the ref");
  });

  it("is turned off on grant and back on on release", () => {
    // Both halves, because either one alone is a sheet that never locks or a
    // list that never scrolls again after the first drag.
    assert.match(src, /onPanResponderGrant: \(\) => \{\s*\n\s*setScrollEnabled\(false\);/);
    assert.match(src, /onPanResponderRelease: \([^)]*\) => \{\s*\n\s*setScrollEnabled\(true\);/);
  });

  it("passes the state value itself to the ScrollView", () => {
    assert.match(src, /scrollEnabled=\{scrollEnabled\}/);
  });

  it("builds the responder once, which is what makes the setter safe to capture", () => {
    // `setScrollEnabled` has a stable identity across renders, so a responder
    // that closed over the first render's copy still reaches the current
    // component. Nothing else the handlers touch is a value: `reducedMotion`
    // is read through `useReducedMotionRef` for exactly this reason.
    assert.match(src, /const sheetPanResponder = useConstant\(\(\) =>\n\s+PanResponder\.create\(\{/);
    assert.match(src, /const sheetTranslateY = useConstant\(\(\) => new Animated\.Value\(0\)\);/);
    assert.match(src, /const reducedMotion = useReducedMotionRef\(\);/);
  });
});
