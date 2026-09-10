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
  it("offers both moves as named accessibility actions with translated labels", () => {
    const body = renderer();
    assert.match(body, /accessibilityActions=\{\[/);
    assert.match(body, /\{ name: "moveUp", label: t\("moveUp"\) \}/);
    assert.match(body, /\{ name: "moveDown", label: t\("moveDown"\) \}/);
  });

  it("routes each action name to a move in that direction", () => {
    const body = renderer();
    assert.match(body, /onAccessibilityAction=\{\(event\) => \{/);
    assert.match(body, /actionName === "moveUp"\) moveBy\(-1\)/);
    assert.match(body, /actionName === "moveDown"\) moveBy\(1\)/);
  });

  it("offers only the move that would do something", () => {
    // `moveItem` clamps, so "move up" on the first card is a no-op that a
    // screen reader would still announce as an available action. Offering it
    // and doing nothing is worse than never mentioning it.
    const body = renderer();
    assert.match(body, /const canMoveUp = index !== undefined && index > 0;/);
    assert.match(body, /const canMoveDown = index !== undefined && index < ownedCollections\.length - 1;/);
    assert.match(body, /\.\.\.\(canMoveUp \? \[\{ name: "moveUp"/);
    assert.match(body, /\.\.\.\(canMoveDown \? \[\{ name: "moveDown"/);
  });

  it("keeps the long press, so a pointer user loses nothing", () => {
    // Wrapped since the pick-up announcement landed, but `drag()` is still what
    // it ends in — a wrapper that forgot to call it would leave the pointer
    // user with a card that dims and never moves.
    const body = renderer();
    assert.match(body, /onLongPress=\{\(\) => \{[\s\S]*?drag\(\);\n\s*\}\}/);
    assert.match(body, /disabled=\{isActive\}/);
  });
});

describe("owned-collection reorder actions — what they write", () => {
  it("commits through the same moveItem the drag commits through", () => {
    // A hand-rolled splice here would be a second answer to "where does the
    // row land", and the two would drift the first time either is fixed.
    const body = renderer();
    assert.match(
      body,
      /reorderOwnedCollections\(moveItem\(ownedCollections, index, index \+ delta\)\.map\(\(c\) => c\.id\)\)/,
    );
    assert.match(readHomeSrc(), /import \{ moveItem \} from "@\/lib\/drag-reorder";/);
  });

  it("writes the ids of the whole list, not just the pair that swapped", () => {
    // `reorderOwnedCollections` takes the full order; sending two ids would
    // drop every collection the user did not touch.
    assert.match(renderer(), /moveItem\([^)]*\)\.map\(\(c\) => c\.id\)/);
  });

  it("does nothing when the row has no index", () => {
    // `getIndex()` is `number | undefined` — a windowed row that has not been
    // placed yet returns undefined, and `undefined + 1` would reach moveItem
    // as NaN.
    const body = renderer();
    assert.match(body, /const index = getIndex\(\);/);
    assert.match(body, /if \(index === undefined\) return;/);
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
