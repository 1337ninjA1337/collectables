import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * HM-C2 structural pins: the collection share sheet lives in
 * `components/collection-share-sheet.tsx` as a memoized component instead of
 * ~115 lines of inline JSX inside `app/collection/[id].tsx`'s modalsBlock.
 * The handlers it receives are hoisted useCallbacks and `sharedWithUserIds`
 * is the page's memoized fallback array, so the memo's props diff only fails
 * when the sheet actually needs to change. The `linkCopied` copy-feedback
 * state lives inside the component — flipping it re-renders only the sheet.
 */
function readSheetSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "collection-share-sheet.tsx"), "utf8");
}

function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("HM-C2 — CollectionShareSheet extraction", () => {
  it("components/collection-share-sheet.tsx exports a named-form memo component", () => {
    const src = readSheetSrc();
    assert.match(src, /export\s+const\s+CollectionShareSheet\s*=\s*(?:React\.)?memo\(\s*function\s+CollectionShareSheet\b/);
    assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/);
  });

  it("all sheet strings go through t()", () => {
    const src = readSheetSrc();
    for (const key of [
      "shareTitle",
      "shareCollectionHint",
      "linkCopied",
      "copyLink",
      "shareVia",
      "shareWithFriends",
      "shareWithFriendsHint",
      "shared",
      "share",
      "noFriendsToShare",
      "peopleWithAccess",
      "peopleWithAccessHint",
      "removeAccess",
      "cancel",
    ]) {
      assert.match(src, new RegExp(`t\\("${key}"`), `missing t("${key}")`);
    }
    assert.match(src, /useI18n\(\)/);
  });

  it("linkCopied state (and its 2s reset timer) lives inside the component, not the page", () => {
    const sheet = readSheetSrc();
    assert.match(sheet, /const\s+\[linkCopied,\s*setLinkCopied\]\s*=\s*useState\(false\)/);
    assert.match(sheet, /setTimeout\(\(\)\s*=>\s*setLinkCopied\(false\),\s*2000\)/);
    const page = readCollectionSrc();
    assert.doesNotMatch(page, /linkCopied/, "linkCopied must no longer be page state");
  });

  it("the page passes stable handlers + the memoized sharedWithUserIds array", () => {
    const src = readCollectionSrc();
    const m = src.match(/<CollectionShareSheet\s+[\s\S]*?\/>/);
    assert.ok(m, "<CollectionShareSheet> call site not found");
    const site = m[0];
    assert.match(site, /visible=\{\s*shareOpen\s*\}/);
    assert.match(site, /collectionId=\{\s*activeCollection\.id\s*\}/);
    assert.match(site, /collectionName=\{\s*activeCollection\.name\s*\}/);
    assert.match(site, /sharedWithUserIds=\{\s*sharedWithUserIds\s*\}/, "must pass the memoized fallback array, not activeCollection.sharedWithUserIds");
    assert.match(site, /friends=\{\s*friends\s*\}/);
    assert.match(site, /getProfileById=\{\s*getProfileById\s*\}/);
    assert.match(site, /onShare=\{\s*handleShareWithFriend\s*\}/);
    assert.match(site, /onUnshare=\{\s*handleUnshareWithUser\s*\}/);
    assert.match(site, /onClose=\{\s*closeShareSheet\s*\}/);
  });

  it("the share handlers are hoisted useCallbacks with nullable-collection guards", () => {
    const src = readCollectionSrc();
    for (const name of ["handleShareWithFriend", "handleUnshareWithUser", "closeShareSheet"]) {
      assert.match(src, new RegExp(`const\\s+${name}\\s*=\\s*useCallback\\(`), `${name} must be a useCallback`);
    }
    // Both mutations guard on the still-nullable `collection`, never the
    // post-narrow `activeCollection` (they sit above the early returns).
    const shareBlock = src.match(/const\s+handleShareWithFriend\s*=\s*useCallback\([\s\S]*?\[collection,\s*shareCollectionWithUser\]/);
    assert.ok(shareBlock, "handleShareWithFriend must guard on collection and dep on [collection, shareCollectionWithUser]");
    assert.match(shareBlock[0], /if\s*\(!collection\)\s*return;/);
    const firstEarlyReturn = src.search(/\n  if \(loadingRemote && !collection\) \{/);
    assert.ok(firstEarlyReturn > 0, "early-return anchor not found");
    for (const name of ["handleShareWithFriend", "handleUnshareWithUser", "closeShareSheet"]) {
      const idx = src.indexOf(`const ${name} = useCallback`);
      assert.ok(idx > 0 && idx < firstEarlyReturn, `${name} must sit above the early returns`);
    }
  });

  it("the inline share-sheet JSX and its styles are gone from the page (header share buttons stay)", () => {
    const src = readCollectionSrc();
    assert.doesNotMatch(src, /styles\.shareSheet\b/, "share-sheet JSX must not remain in the page");
    for (const style of ["shareBackdrop:", "shareSheet:", "shareFriendRow:", "shareCancelButton:", "shareFriendsEmpty:"]) {
      assert.doesNotMatch(src, new RegExp(style.replace(":", "\\s*:")), `${style} must live in components/collection-share-sheet.tsx`);
    }
    // The header's share chip is a page concern and stays.
    assert.match(src, /shareButton\s*:/);
    assert.match(src, /styles\.shareButton\b/);
  });

  it("Share and buildDeepLink moved out of the page with the sheet", () => {
    const src = readCollectionSrc();
    assert.doesNotMatch(src, /\bShare\b\s*[,}]/, "react-native Share import must be gone from the page");
    assert.doesNotMatch(src, /buildDeepLink/, "buildDeepLink is now a sheet concern");
    const sheet = readSheetSrc();
    assert.match(sheet, /\bShare\.share\(/);
    assert.match(sheet, /buildDeepLink\(`collection\/\$\{collectionId\}`\)/);
  });

  it("the shareOpen profile-prefetch effect stays a page concern", () => {
    const src = readCollectionSrc();
    assert.match(src, /if\s*\(!shareOpen\s*\|\|\s*sharedWithUserIds\.length\s*===\s*0\)\s*return;/);
    assert.match(src, /ensureProfilesLoaded\(sharedWithUserIds\)/);
  });

  it("modalsBlock renders the component (composition point pins keep holding)", () => {
    const src = readCollectionSrc();
    assert.match(
      src,
      /const\s+modalsBlock\s*=\s*\(\s*<>[\s\S]*?<MoveCollectionModal\b[\s\S]*?<CollectionShareSheet\b/,
      "modalsBlock must render <CollectionShareSheet> after <MoveCollectionModal>",
    );
  });
});
