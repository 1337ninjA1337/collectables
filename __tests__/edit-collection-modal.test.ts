import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * HM-C3 structural pins: the edit-collection form lives in
 * `components/edit-collection-modal.tsx` as a memoized component instead of
 * ~120 lines of inline JSX inside `app/collection/[id].tsx`'s modalsBlock.
 * The 7 edit fields deliberately STAY page state (openEditModal seeds them,
 * handleSaveEdit + the currency sheet's `edit` mode consume them) — the
 * component takes narrow value/setter props, all referentially stable, so
 * the hidden `<Modal visible={false}>` subtree skips reconciliation during
 * scroll-driven parent re-renders.
 */
function readModalSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "edit-collection-modal.tsx"), "utf8");
}

function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("HM-C3 — EditCollectionModal extraction", () => {
  it("components/edit-collection-modal.tsx exports a named-form memo component", () => {
    const src = readModalSrc();
    assert.match(src, /export\s+const\s+EditCollectionModal\s*=\s*(?:React\.)?memo\(\s*function\s+EditCollectionModal\b/);
    assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/);
  });

  it("all modal strings go through t()", () => {
    const src = readModalSrc();
    for (const key of [
      "editCollection",
      "collectionNameLabel",
      "collectionNamePlaceholder",
      "collectionDescriptionLabel",
      "collectionDescriptionPlaceholder",
      "collectionCoverLabel",
      "editCover",
      "visibilityLabel",
      "visibilityPrivatePremiumOnly",
      "premiumTitle",
      "visibilityPublicHint",
      "visibilityPrivateHint",
      "currencyLabel",
      "collectionCurrencyAuto",
      "collectionCurrencyHint",
      "saving",
      "saveChanges",
      "cancelEdit",
    ]) {
      assert.match(src, new RegExp(`t\\("${key}"`), `missing t("${key}")`);
    }
    assert.match(src, /useI18n\(\)/);
  });

  it("uses MaskedTextInput for the text fields (clarity-mask convention)", () => {
    const src = readModalSrc();
    assert.match(src, /from\s+"@\/components\/masked-text-input"/);
    assert.doesNotMatch(src, /<TextInput\b/);
  });

  it("the page passes state values + stable setters and handlers", () => {
    const src = readCollectionSrc();
    const m = src.match(/<EditCollectionModal\s+[\s\S]*?\/>/);
    assert.ok(m, "<EditCollectionModal> call site not found");
    const site = m[0];
    assert.match(site, /visible=\{\s*editModalOpen\s*\}/);
    assert.match(site, /name=\{\s*editName\s*\}/);
    assert.match(site, /description=\{\s*editDescription\s*\}/);
    assert.match(site, /coverUri=\{\s*editCoverUri\s*\}/);
    assert.match(site, /visibility=\{\s*editVisibility\s*\}/);
    assert.match(site, /currency=\{\s*editCurrency\s*\}/);
    assert.match(site, /saving=\{\s*editSaving\s*\}/);
    assert.match(site, /onChangeName=\{\s*setEditName\s*\}/);
    assert.match(site, /onChangeDescription=\{\s*setEditDescription\s*\}/);
    assert.match(site, /onChangeVisibility=\{\s*setEditVisibility\s*\}/);
    assert.match(site, /onPickCover=\{\s*pickEditCover\s*\}/);
    assert.match(site, /onOpenCurrencySheet=\{\s*openEditCurrencySheet\s*\}/);
    assert.match(site, /onSave=\{\s*handleSaveEdit\s*\}/);
    assert.match(site, /onClose=\{\s*closeEditModal\s*\}/);
  });

  it("the edit handlers are hoisted useCallbacks above the early returns", () => {
    const src = readCollectionSrc();
    const firstEarlyReturn = src.search(/\n  if \(loadingRemote && !collection\) \{/);
    assert.ok(firstEarlyReturn > 0, "early-return anchor not found");
    for (const name of [
      "pickEditCoverFromGallery",
      "pickEditCoverFromCamera",
      "pickEditCover",
      "handleSaveEdit",
      "openEditCurrencySheet",
      "closeEditModal",
    ]) {
      assert.match(src, new RegExp(`const\\s+${name}\\s*=\\s*useCallback\\(`), `${name} must be a useCallback`);
      const idx = src.indexOf(`const ${name} = useCallback`);
      assert.ok(idx > 0 && idx < firstEarlyReturn, `${name} must sit above the early returns`);
      assert.doesNotMatch(src, new RegExp(`async\\s+function\\s+${name}\\b`), `old plain-function ${name} must be gone`);
    }
  });

  it("handleSaveEdit guards on the nullable collection and carries honest deps", () => {
    const src = readCollectionSrc();
    const m = src.match(/const\s+handleSaveEdit\s*=\s*useCallback\(([\s\S]*?)\},\s*\[([^\]]*)\]\s*,?\s*\)/);
    assert.ok(m, "handleSaveEdit useCallback with dep array not found");
    assert.match(m[1], /if\s*\(!collection\)\s*return;/);
    assert.doesNotMatch(m[1], /activeCollection/, "handleSaveEdit must not touch the post-narrow activeCollection");
    for (const dep of ["collection", "editName", "editDescription", "editCoverUri", "editCoverChanged", "editVisibility", "editCurrency", "isPremium", "updateCollection", "toast", "t"]) {
      assert.match(m[2], new RegExp(`\\b${dep}\\b`), `handleSaveEdit deps must include ${dep}`);
    }
  });

  it("the inline edit-modal JSX and its styles are gone from the page (pageHeader edit button stays)", () => {
    const src = readCollectionSrc();
    for (const style of ["editModalCard:", "editFieldGroup:", "editVisibilityChip:", "editCurrencyButton:", "editSaveButton:"]) {
      assert.doesNotMatch(src, new RegExp(style.replace(":", "\\s*:")), `${style} must live in components/edit-collection-modal.tsx`);
    }
    // The pageHeader's "edit collection" button is a page concern and stays.
    assert.match(src, /editCollectionButton\s*:/);
    assert.match(src, /styles\.editCollectionButton\b/);
  });

  it("the locked-chip upsell (trackEvent + toast) moved into the component", () => {
    const page = readCollectionSrc();
    assert.doesNotMatch(page, /premium_upsell_shown/, "the upsell event now fires from the component");
    const modal = readModalSrc();
    assert.match(modal, /trackEvent\(\s*"premium_upsell_shown"/);
    assert.match(modal, /useToast\(\)/);
  });

  it("modalsBlock is now composition-only (no inline <Modal> left in the page)", () => {
    const src = readCollectionSrc();
    assert.doesNotMatch(src, /<Modal\b/, "all three modals are extracted components now");
    assert.match(
      src,
      /const\s+modalsBlock\s*=\s*\(\s*<>[\s\S]*?<MoveCollectionModal\b[\s\S]*?<CollectionShareSheet\b[\s\S]*?<EditCollectionModal\b[\s\S]*?<CurrencySheet\b/,
      "modalsBlock must compose the three extracted modals + CurrencySheet in order",
    );
  });
});
