import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TOAST_ACTION_DISPLAY_MS,
  TOAST_DISPLAY_MS,
  toastDisplayMs,
} from "@/lib/toast-timing";
import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeStrings } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * A toast that can be acted on, and the first thing that acts on it.
 *
 * Entering reorder mode used to explain why dragging was off; it clears the
 * sort now, which discards something the owner chose — so the toast that says
 * so has to be able to put it back. `toast-context.tsx` pulls React Native, so
 * the timing rule lives in its own module and everything else here is
 * structural.
 */
const toastSrc = readRepoFile("lib/toast-context.tsx");
const screenSrc = readRepoFile("app/collection/[id].tsx");

describe("toastDisplayMs", () => {
  it("gives an actionable toast a longer window than a reporting one", () => {
    // An undo the user cannot reach in time is worse than no undo: it shows
    // them the way back and then takes it away.
    assert.equal(toastDisplayMs(false), TOAST_DISPLAY_MS);
    assert.equal(toastDisplayMs(true), TOAST_ACTION_DISPLAY_MS);
    assert.ok(TOAST_ACTION_DISPLAY_MS > TOAST_DISPLAY_MS);
  });

  it("keeps both windows in the range a human can actually use", () => {
    // Long enough to read a sentence; short enough that the toast is not
    // furniture. A regression to 800ms or 30s would pass every other check.
    assert.ok(TOAST_DISPLAY_MS >= 2500 && TOAST_DISPLAY_MS <= 5000);
    assert.ok(TOAST_ACTION_DISPLAY_MS >= 5000 && TOAST_ACTION_DISPLAY_MS <= 10000);
  });
});

describe("the toast renders and times its action", () => {
  it("takes the window from the shared rule rather than a literal", () => {
    assert.match(toastSrc, /setTimeout\(\(\) => dismiss\(id\), toastDisplayMs\(!!input\.action\)\)/);
    assert.doesNotMatch(toastSrc, /const DISPLAY_MS = \d+/, "the timing literal came back");
  });

  it("renders the action only when there is one", () => {
    assert.match(toastSrc, /\{toast\.action \? \(/);
  });

  it("gives the action a button role and its label to a screen reader", () => {
    const action = toastSrc.match(/\{toast\.action \? \([\s\S]*?\) : null\}/)?.[0] ?? "";
    assert.ok(action.length > 0, "expected to extract the action block");
    assert.match(action, /accessibilityRole="button"/);
    assert.match(action, /accessibilityLabel=\{toast\.action\.label\}/);
  });

  it("dismisses the toast after running the action, not before", () => {
    // A toast left standing invites a second press on an undo that already
    // happened; dismissing first would swallow a handler that threw.
    const action = toastSrc.match(/\{toast\.action \? \([\s\S]*?\) : null\}/)?.[0] ?? "";
    const order = action.indexOf("toast.action?.onPress()");
    const dismiss = action.indexOf("onDismiss()");
    assert.ok(order > 0 && dismiss > order, "onPress must run before onDismiss");
  });

  it("takes a translated label, not a key", () => {
    // The module sits below the i18n context and every other string it renders
    // arrives the same way.
    assert.match(toastSrc, /export type ToastAction = \{ label: string; onPress: \(\) => void \};/);
    assert.doesNotMatch(toastSrc, /useI18n/);
  });
});

describe("entering reorder mode clears the sort", () => {
  it("clears only when entering, and only when a sort is on", () => {
    // Leaving the mode must not touch the sort, and entering it with no sort
    // must not toast about nothing.
    const decl = screenSrc.match(/const toggleReorderMode = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] ?? "";
    assert.ok(decl.length > 0, "expected to extract the toggleReorderMode declaration");
    assert.match(decl, /const entering = !reorderMode;/);
    assert.match(decl, /if \(!entering \|\| itemFilters\.sort === "default"\) return;/);
  });

  it("offers the cleared sort back through the toast's action", () => {
    const decl = screenSrc.match(/const toggleReorderMode = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] ?? "";
    assert.match(decl, /const previous = itemFilters\.sort;/);
    assert.match(decl, /applySort\("default"\);/);
    assert.match(decl, /action: \{ label: t\("undo"\), onPress: \(\) => applySort\(previous\) \}/);
  });

  it("keeps the notice for the case it was written for", () => {
    // A sort applied WHILE reorder mode is already on still needs explaining —
    // the handoff only covers the way in.
    assert.match(screenSrc, /reorderMode\s*&&\s*\n\s*itemFilters\.sort !== "default";/);
    assert.match(screenSrc, /t\("reorderBlockedBySort"\)/);
  });
});

describe("the handoff's strings", () => {
  const KEYS = ["sortClearedForReorder", "undo"] as const;

  it("declares both keys in every locale", () => {
    const src = readI18nSource();
    for (const key of KEYS) assertDeclaredInEveryLocale(src, key);
  });

  it("translates each rather than copying the English six times", () => {
    const src = readI18nSource();
    for (const key of KEYS) {
      const values = localeStrings(src, key);
      assert.equal(
        new Set(values.values()).size,
        values.size,
        `${key} repeats a string across locales`,
      );
    }
  });
});
