import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * HM-C1 structural pins: the "move to collection" picker lives in
 * `components/move-collection-modal.tsx` as a memoized component instead of
 * inline JSX inside `app/collection/[id].tsx`'s modalsBlock. Both handlers
 * it receives are hoisted useCallbacks, so the memo's props diff only fails
 * when the modal actually needs to change — hidden `<Modal visible={false}>`
 * subtrees skip reconciliation during scroll-driven parent re-renders.
 */
function readModalSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "move-collection-modal.tsx"), "utf8");
}

function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("HM-C1 — MoveCollectionModal extraction", () => {
  it("components/move-collection-modal.tsx exports a named-form memo component", () => {
    const src = readModalSrc();
    assert.match(src, /export\s+const\s+MoveCollectionModal\s*=\s*(?:React\.)?memo\(\s*function\s+MoveCollectionModal\b/);
    assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/);
  });

  it("all modal strings go through t()", () => {
    const src = readModalSrc();
    for (const key of ["moveToCollection", "cancel"]) {
      assert.match(src, new RegExp(`t\\("${key}"`), `missing t("${key}")`);
    }
    assert.match(src, /useI18n\(\)/);
  });

  it("the page passes stable handlers + the memoized collections array", () => {
    const src = readCollectionSrc();
    const m = src.match(/<MoveCollectionModal\s+[\s\S]*?\/>/);
    assert.ok(m, "<MoveCollectionModal> call site not found");
    const site = m[0];
    assert.match(site, /visible=\{\s*moveModalOpen\s*\}/);
    assert.match(site, /collections=\{\s*otherOwnedCollections\s*\}/);
    assert.match(site, /onMove=\{\s*handleMoveTo\s*\}/);
    assert.match(site, /onClose=\{\s*closeMoveModal\s*\}/);
  });

  it("handleMoveTo and closeMoveModal are hoisted useCallbacks (not plain functions)", () => {
    const src = readCollectionSrc();
    assert.match(
      src,
      /const\s+handleMoveTo\s*=\s*useCallback\(/,
      "handleMoveTo must be a useCallback so the memoized modal's onMove prop is stable",
    );
    assert.doesNotMatch(src, /async\s+function\s+handleMoveTo\b/, "the old plain-function form must be gone");
    assert.match(src, /const\s+closeMoveModal\s*=\s*useCallback\(\s*\(\)\s*=>\s*setMoveModalOpen\(false\)\s*,\s*\[\s*\]\s*\)/);

    // Hoisted above the loading/not-found early returns (hook-order invariant).
    const firstEarlyReturn = src.search(/\n  if \(loadingRemote && !collection\) \{/);
    assert.ok(firstEarlyReturn > 0, "early-return anchor not found");
    const moveToIdx = src.indexOf("const handleMoveTo = useCallback");
    const closeIdx = src.indexOf("const closeMoveModal = useCallback");
    assert.ok(moveToIdx > 0 && moveToIdx < firstEarlyReturn, "handleMoveTo must sit above the early returns");
    assert.ok(closeIdx > 0 && closeIdx < firstEarlyReturn, "closeMoveModal must sit above the early returns");
  });

  it("handleMoveTo carries honest deps", () => {
    const src = readCollectionSrc();
    const m = src.match(/const\s+handleMoveTo\s*=\s*useCallback\([\s\S]*?\},\s*\[([^\]]*)\]\s*,?\s*\)/);
    assert.ok(m, "handleMoveTo useCallback with dep array not found");
    for (const dep of ["selectedIds", "moveItems", "toast", "t", "exitSelectionMode"]) {
      assert.match(m[1], new RegExp(`\\b${dep}\\b`), `handleMoveTo deps must include ${dep}`);
    }
  });

  it("the inline move-modal JSX and its move-only styles are gone from the page", () => {
    const src = readCollectionSrc();
    assert.doesNotMatch(src, /styles\.modalCard\b/, "move-modal card JSX must not remain in the page");
    for (const style of ["modalCard:", "modalList:", "modalRow:", "modalRowText:"]) {
      assert.doesNotMatch(src, new RegExp(style.replace(":", "\\s*:")), `${style} must live in components/move-collection-modal.tsx`);
    }
    // The backdrop/title/cancel styles deliberately STAY until HM-C3 moves the
    // edit modal out — they're still consumed by the inline edit modal.
    for (const style of ["modalBackdrop:", "modalTitle:", "modalCancel:", "modalCancelText:"]) {
      assert.match(src, new RegExp(style.replace(":", "\\s*:")), `${style} is still an edit-modal concern until HM-C3`);
    }
  });

  it("modalsBlock renders the component (composition point pins keep holding)", () => {
    const src = readCollectionSrc();
    assert.match(
      src,
      /const\s+modalsBlock\s*=\s*\(\s*<>[\s\S]*?<MoveCollectionModal\b/,
      "modalsBlock must render <MoveCollectionModal> as its first child",
    );
  });
});
