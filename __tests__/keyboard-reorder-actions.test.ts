/**
 * The reorder a user without a long press can perform, on the home screen.
 *
 * Every route into `reorderOwnedCollections` was a long-press-then-drag — on
 * native through `react-native-draggable-flatlist`, on web through the pointer
 * shim. A keyboard, a switch, or a screen reader has no long press, so the
 * ordering of a user's own collections was not merely awkward to change
 * without a pointer: it was unreachable. `accessibilityActions` is the route
 * that does not need one.
 *
 * `app/index.tsx` pulls expo-router and react-native, so the screen's
 * assertions here are structural, the shape the other screen pins use. The
 * arithmetic the actions commit is not structural, though — `moveItem` is a
 * plain function and the last describe exercises it directly, because "move up
 * then down puts the row back" is the property a keyboard user notices first
 * and a regex cannot see.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { moveItem } from "@/lib/drag-reorder";
import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocaleBody,
  localeStrings,
} from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

const ACTION_KEYS = ["moveUp", "moveDown"] as const;

function readHomeSrc(): string {
  return readRepoFile("app/index.tsx");
}

/** The `renderOwnedCollection` body, which is where all of this lives. */
function renderer(): string {
  const src = readHomeSrc();
  const start = src.indexOf("const renderOwnedCollection =");
  assert.ok(start > 0, "expected to find renderOwnedCollection in app/index.tsx");
  const end = src.indexOf("\n  return (\n    <Screen", start);
  assert.ok(end > start, "expected renderOwnedCollection to end before the screen's return");
  return src.slice(start, end);
}

describe("owned-collection reorder actions — the actions themselves", () => {
  it("delegates the whole action pair to lib/reorder-actions.ts", () => {
    // The twelve lines this used to pin — a canMoveUp/canMoveDown pair, the
    // conditional spread, the actionName switch, the undefined guard — were
    // duplicated character for character in `app/collection/[id].tsx`. They
    // are `reorderActionProps` now, and what this suite pins is the wiring;
    // the decisions themselves are run as functions in reorder-actions.test.ts.
    assert.match(readHomeSrc(), /import \{ reorderActionProps \} from "@\/lib\/reorder-actions";/);
    const body = renderer();
    assert.match(body, /const reorderActions = reorderActionProps\(\{/);
    assert.match(body, /rows: ownedCollections,/);
    assert.match(body, /index,/);
    assert.match(body, /label: t,/);
  });

  it("spreads both props onto the row, so neither is quietly dropped", () => {
    // `accessibilityActions` without `onAccessibilityAction` is a list of
    // actions a screen reader offers and nothing answers.
    assert.match(renderer(), /\{\.\.\.reorderActions\}/);
  });

  it("reads the row's own index rather than assuming one", () => {
    // `getIndex()` is `number | undefined`; the guard for that lives in
    // `reorderActionProps` now, which is why this only pins the read.
    assert.match(renderer(), /const index = getIndex\(\);/);
  });

  it("offers every owned collection as the list a move happens within", () => {
    // `rows` is what the move is computed against and what gets committed —
    // handing over a filtered or sliced array would renumber the rest.
    assert.match(renderer(), /rows: ownedCollections,/);
  });

  it("keeps the long press, so a pointer user loses nothing", () => {
    // The wrapper that announces the pick-up and then calls `drag()` is
    // `reorderActionProps`'s now — it comes back as `onLongPress` in the same
    // spread. What this screen still owns is handing the gesture over
    // unconditionally: every owned collection is the user's own to reorder.
    const body = renderer();
    assert.match(body, /drag,/);
    assert.match(body, /disabled=\{isActive\}/);
  });
});

describe("owned-collection reorder actions — what they write", () => {
  it("commits the whole list's ids, not just the pair that swapped", () => {
    // `reorderOwnedCollections` takes the full order; sending two ids would
    // drop every collection the user did not touch. `next` is the whole of
    // `rows`, reordered — which is the contract reorderActionProps states.
    assert.match(
      renderer(),
      /commit: \(next\) => reorderOwnedCollections\(next\.map\(\(c\) => c\.id\)\),/,
    );
  });

  it("passes the announcement straight through, choosing neither moment nor position", () => {
    // Both are the module's: it knows which moment just happened (a pick-up
    // before `drag()`, a landing after a move) and the position the move
    // actually resolved to. A screen that re-derived either is how the spoken
    // position and the visible one drift.
    assert.match(
      renderer(),
      /announce: \(key, at, total\) => announceReorder\(t, key, at, total\),/,
    );
  });

  it("no longer reaches for moveItem itself", () => {
    // A second call site for "where does the row land" is exactly what the
    // extraction removed; the drag's own commit and the keyboard's now share
    // one.
    assert.doesNotMatch(readHomeSrc(), /import \{ moveItem \}/);
  });
});

describe("owned-collection reorder actions — the move itself", () => {
  const rows = ["a", "b", "c", "d"];

  it("moves a row one place in the direction asked for", () => {
    assert.deepEqual(moveItem(rows, 2, 1), ["a", "c", "b", "d"]);
    assert.deepEqual(moveItem(rows, 1, 2), ["a", "c", "b", "d"]);
  });

  it("puts a row back where it was when the two moves are undone", () => {
    // The property a keyboard user checks by accident: down, then up.
    const down = moveItem(rows, 1, 2);
    assert.deepEqual(moveItem(down, 2, 1), rows);
  });

  it("leaves every other row's relative order alone", () => {
    const moved = moveItem(rows, 0, 3);
    assert.deepEqual(moved, ["b", "c", "d", "a"]);
    assert.deepEqual(moved.filter((r) => r !== "a"), ["b", "c", "d"]);
  });

  it("is a no-op at the ends, which is why they are not offered", () => {
    // The gating above exists because of this: the call is harmless, and a
    // harmless call is still an action a screen reader promised would work.
    assert.deepEqual(moveItem(rows, 0, -1), rows);
    assert.deepEqual(moveItem(rows, 3, 4), rows);
  });
});

describe("owned-collection reorder actions — i18n", () => {
  it("declares both labels in every locale", () => {
    const src = readI18nSource();
    for (const key of ACTION_KEYS) {
      assertDeclaredInEveryLocale(src, key);
      assertMatchesInEveryLocaleBody(
        src,
        new RegExp(`\\b${key}: "[^"]+",`),
        `${key} is a non-empty string`,
      );
    }
  });

  it("translates each label rather than copying the English six times", () => {
    const src = readI18nSource();
    for (const key of ACTION_KEYS) {
      const values = localeStrings(src, key);
      assert.equal(
        new Set(values.values()).size,
        values.size,
        `${key} has duplicate copy across locales: ${JSON.stringify([...values])}`,
      );
    }
  });

  it("phrases them as the action offered, not as a button caption", () => {
    // A screen reader reads a custom action as "actions available: move up" —
    // so the string is a verb phrase. "Up" alone would be read as a direction
    // with no verb, which is what a caption on an arrow button would say.
    const src = readI18nSource();
    for (const key of ACTION_KEYS) {
      for (const [locale, value] of localeStrings(src, key)) {
        assert.ok(
          value.trim().split(/\s+/).length >= 2,
          `${key} in ${locale} is a single word (${value}); it should name the action`,
        );
      }
    }
  });

  it("keeps the copy out of the screen source", () => {
    const src = readHomeSrc();
    assert.doesNotMatch(src, /"Move up"/);
    assert.doesNotMatch(src, /"Move down"/);
  });
});
