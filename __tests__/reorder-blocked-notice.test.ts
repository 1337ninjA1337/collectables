/**
 * Pins the "reorder is off while sorted" notice in `app/collection/[id].tsx`.
 *
 * Owners reorder items by opting into `reorderMode`, but the drag branch is
 * additionally gated on `itemFilters.sort === "default"` — `onDragEnd`
 * re-writes `sortOrder` from the VISIBLE order, so dragging an alphabetically
 * sorted list would silently corrupt the manual one. Before this notice the
 * owner tapped "Reorder", the button lit up, and nothing became draggable:
 * indistinguishable from a broken button.
 *
 * Both the screen and the i18n module pull react-native peers and can't be
 * imported under `tsx --test`, so every assertion here is structural — the
 * same shape the other collection-detail pins use.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readI18nSource } from "./helpers/i18n-source-file";

function readScreenSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

const NOTICE_KEYS = ["reorderBlockedBySort", "reorderResetSort"] as const;

describe("reorder-blocked-by-sort notice — gating", () => {
  it("derives the flag from owner + not-selecting + reorderMode + non-default sort", () => {
    assert.match(
      readScreenSrc(),
      /const\s+reorderBlockedBySort\s*=\s*\n\s*!!collection\s*&&\s*\n\s*user\?\.id === collection\.ownerUserId\s*&&\s*\n\s*!selectionMode\s*&&\s*\n\s*reorderMode\s*&&\s*\n\s*itemFilters\.sort !== "default";/,
    );
  });

  it("is the exact complement of the isDragBranch sort gate", () => {
    // If these two ever drift, the owner gets either a notice while dragging
    // works, or silence while it doesn't. Both conditions must name the same
    // sort comparison against the same "default" literal.
    const src = readScreenSrc();
    assert.match(src, /const isDragBranch = isOwner && !selectionMode && reorderMode && itemFilters\.sort === "default";/);
    assert.match(src, /reorderMode\s*&&\s*\n\s*itemFilters\.sort !== "default";/);
  });

  it("requires reorderMode so a sorted owner who never asked to reorder is not nagged", () => {
    const src = readScreenSrc();
    const decl = src.match(/const\s+reorderBlockedBySort\s*=[\s\S]*?;\n/)?.[0] ?? "";
    assert.ok(decl.length > 0, "expected to extract the reorderBlockedBySort declaration");
    assert.match(decl, /\breorderMode\b/);
  });

  it("derives ownership locally instead of reading the post-narrow bindings", () => {
    // The flag is consumed by `listTitleAndFilters`, which is hoisted above
    // the early returns that narrow `collection` — touching `activeCollection`
    // or `isOwner` there would be a TDZ crash.
    const src = readScreenSrc();
    const decl = src.match(/const\s+reorderBlockedBySort\s*=[\s\S]*?;\n/)?.[0] ?? "";
    assert.doesNotMatch(decl, /activeCollection/);
    assert.doesNotMatch(decl, /\bisOwner\b/);
    const declAt = src.indexOf("const reorderBlockedBySort =");
    const firstEarlyReturn = src.indexOf("if (loadingRemote && !collection)");
    assert.ok(declAt > 0 && declAt < firstEarlyReturn, "the flag must be derived above the early returns");
  });
});

describe("reorder-blocked-by-sort notice — rendering", () => {
  it("rides in listTitleAndFilters so both header paths show it", () => {
    // The owner-with-a-sort case lands on the viewer FlatList branch (whose
    // header is ListHeaderComponent) — rendering the notice only in the
    // ScrollView fallback would make it invisible exactly when it is needed.
    const src = readScreenSrc();
    const memo = src.match(/const\s+listTitleAndFilters\s*=\s*useMemo\([\s\S]*?\);\n/)?.[0] ?? "";
    assert.ok(memo.length > 0, "expected to extract the listTitleAndFilters memo");
    assert.match(memo, /\{reorderBlockedBySort \? \(/);
    assert.match(memo, /t\("reorderBlockedBySort"\)/);
    assert.match(memo, /t\("reorderResetSort"\)/);
  });

  it("announces itself to screen readers as an alert", () => {
    assert.match(readScreenSrc(), /style=\{styles\.reorderNotice\} accessibilityRole="alert"/);
  });

  it("gives the reset action a button role and a label", () => {
    const src = readScreenSrc();
    const action = src.match(/<Pressable\n\s*style=\{styles\.reorderNoticeAction\}[\s\S]*?\/>|<Pressable\n\s*style=\{styles\.reorderNoticeAction\}[\s\S]*?<\/Pressable>/)?.[0] ?? "";
    assert.ok(action.length > 0, "expected to extract the reset-sort Pressable");
    assert.match(action, /accessibilityRole="button"/);
    assert.match(action, /accessibilityLabel=\{t\("reorderResetSort"\)\}/);
  });

  it("resets ONLY the sort, preserving the owner's search and filters", () => {
    // `setItemFilters(EMPTY_FILTERS)` would silently drop an active query or
    // condition filter alongside the sort — a destructive surprise.
    const src = readScreenSrc();
    assert.match(
      src,
      /const resetSort = useCallback\(\s*\n\s*\(\) => setItemFilters\(\(current\) => \(\{ \.\.\.current, sort: "default" \}\)\),\s*\n\s*\[\],\s*\n\s*\);/,
    );
    const decl = src.match(/const resetSort = useCallback\([\s\S]*?\);\n/)?.[0] ?? "";
    assert.doesNotMatch(decl, /EMPTY_FILTERS/);
  });

  it("keeps resetSort referentially stable so the memo is not defeated", () => {
    // An inline arrow would change identity every render and re-run the
    // listTitleAndFilters memo on every parent pass — the exact cost HM-A
    // exists to avoid.
    const decl = readScreenSrc().match(/const resetSort = useCallback\([\s\S]*?\);\n/)?.[0] ?? "";
    assert.match(decl, /\[\],\s*\n\s*\);/, "resetSort must have an empty dep array");
  });

  it("styles the notice with design tokens, no inline hex", () => {
    const src = readScreenSrc();
    for (const style of [
      "reorderNotice",
      "reorderNoticeText",
      "reorderNoticeAction",
      "reorderNoticeActionText",
    ]) {
      assert.match(src, new RegExp(`\\n  ${style}: \\{`), `missing StyleSheet entry ${style}`);
    }
    const block = src.match(/\n {2}reorderNotice: \{[\s\S]*?\n {2}reorderNoticeActionText: \{[\s\S]*?\n {2}\},/)?.[0] ?? "";
    assert.ok(block.length > 0, "expected to extract the notice styles");
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}/);
    // Wraps rather than clipping the message on a narrow phone.
    assert.match(block, /flexWrap: "wrap"/);
  });
});

describe("reorder-blocked-by-sort notice — i18n", () => {
  it("declares both keys in every locale", () => {
    const src = readI18nSource();
    for (const key of NOTICE_KEYS) {
      const hits = src.match(new RegExp(`^  ${key}: "[^"]+",$`, "gm")) ?? [];
      assert.equal(hits.length, 6, `${key} must exist, non-empty, in all six locales (got ${hits.length})`);
    }
  });

  it("translates each key rather than copying the English string six times", () => {
    const src = readI18nSource();
    for (const key of NOTICE_KEYS) {
      const values = (src.match(new RegExp(`^  ${key}: "([^"]+)",$`, "gm")) ?? []).map((line) =>
        line.slice(line.indexOf('"') + 1, -2),
      );
      assert.equal(new Set(values).size, 6, `${key} has duplicate copy across locales: ${values.join(" | ")}`);
    }
  });

  it("keeps the copy out of the screen source (no hard-coded strings)", () => {
    const src = readScreenSrc();
    assert.doesNotMatch(src, /Reordering is off while items are sorted/);
    assert.doesNotMatch(src, /Reset sort"/);
  });
});
