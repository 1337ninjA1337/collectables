import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BB-A structural pins: the selection-mode bulk-bar lives in
 * `components/bulk-bar.tsx` as a memoized component instead of inline JSX
 * in `app/collection/[id].tsx`. The four callbacks it receives are the
 * hoisted useCallbacks, so the memo actually skips re-renders; the page
 * keeps only the spacer that reserves scroll room under the bar.
 */
function readBulkBarSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "bulk-bar.tsx"), "utf8");
}

function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("BB-A — BulkBar extraction", () => {
  it("components/bulk-bar.tsx exports a named-form memo component", () => {
    const src = readBulkBarSrc();
    assert.match(src, /export\s+const\s+BulkBar\s*=\s*(?:React\.)?memo\(\s*function\s+BulkBar\b/);
    assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/);
  });

  it("all bulk-bar strings go through t()", () => {
    const src = readBulkBarSrc();
    for (const key of ["selectedCount", "moveToCollection", "delete", "cancel"]) {
      assert.match(src, new RegExp(`t\\("${key}"`), `missing t("${key}")`);
    }
    assert.match(src, /useI18n\(\)/);
  });

  it("the page passes the four hoisted handlers into <BulkBar>", () => {
    const src = readCollectionSrc();
    const m = src.match(/<BulkBar\s+count=[\s\S]*?\/>/);
    assert.ok(m, "<BulkBar> call site not found");
    const site = m[0];
    assert.match(site, /count=\{\s*selectedIds\.size\s*\}/);
    assert.match(site, /onMove=\{\s*handleOpenMove\s*\}/);
    assert.match(site, /onDelete=\{\s*handleBulkDelete\s*\}/);
    assert.match(site, /onCancel=\{\s*exitSelectionMode\s*\}/);
  });

  it("the inline bulk-bar JSX and styles are gone from the page (spacer stays)", () => {
    const src = readCollectionSrc();
    assert.doesNotMatch(src, /styles\.bulkBarInner/, "inline bulk-bar JSX must not remain in the page");
    assert.doesNotMatch(src, /bulkBarButton:/, "bulk-bar styles must live in components/bulk-bar.tsx");
    assert.match(src, /bulkBarSpacer/, "the scroll spacer stays a page concern");
  });
});
