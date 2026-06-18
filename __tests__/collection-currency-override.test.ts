import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for the per-collection currency override shipped in
 * `app/collection/[id].tsx`. The override is opt-in: a NULL value on
 * `collections.currency` means "fall back to the user's app-wide
 * displayCurrency", so legacy rows must keep rendering unchanged.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Collection type — currency override field", () => {
  const src = read("lib/types.ts");

  it("declares `currency?: string | null` on Collection so legacy rows can omit it", () => {
    assert.match(src, /Collection\s*=\s*\{[\s\S]*?currency\?:\s*string\s*\|\s*null;[\s\S]*?stopwords/);
  });
});

describe("DB shape — DbCollection + toCollection map the currency column", () => {
  const src = read("lib/supabase-profiles.ts");
  // BE-10 moved the read-path mapping into the pure `coerce*` validators.
  const coerce = read("lib/supabase-row-coerce.ts");

  it("DbCollection row type carries the nullable `currency` column", () => {
    assert.match(src, /type\s+DbCollection\s*=\s*\{[\s\S]*?currency\?:\s*string\s*\|\s*null;[\s\S]*?\};/);
  });

  it("coerceCollectionRow() forwards row.currency onto Collection.currency (null fallback)", () => {
    assert.match(coerce, /currency:\s*typeof\s+r\.currency\s*===\s*"string"\s*\?\s*r\.currency\s*:\s*null,/);
  });

  it("updateRemoteCollection() patches the currency column when the update carries it", () => {
    assert.match(
      src,
      /if\s*\(\s*"currency"\s+in\s+updates\s*\)\s+body\.currency\s*=\s*updates\.currency\s*\?\?\s*null;/,
    );
  });
});

describe("getCollectionTotalCost — per-collection currency override", () => {
  const src = read("lib/collections-context.tsx");

  it("looks up the collection and reads its currency override before falling back", () => {
    // The override is a property of the collection, not the user. Without
    // this lookup, every collection would share the app-wide displayCurrency
    // and the override couldn't surface.
    assert.match(
      src,
      /const\s+collection\s*=\s*collections\.find\(\s*\(\s*c\s*\)\s*=>\s*c\.id\s*===\s*collectionId\s*\);/,
    );
    assert.match(src, /const\s+target\s*=\s*collection\?\.currency\s*\?\?\s*displayCurrency;/);
  });

  it("threads the resolved `target` currency through sumConverted + the no-rates fallback", () => {
    // Both code paths (rates-available and rates-not-loaded-yet) must use
    // `target`. If only one path uses it, the totals would flicker between
    // currencies during initial app load.
    assert.match(src, /sumConverted\(\s*entries\s*,\s*target\s*,\s*currencyRates\s*\)/);
    assert.match(src, /return\s*\{\s*amount:\s*total,\s*currency:\s*target,\s*converted,\s*skipped\s*\};/);
    assert.match(src, /return\s*\{\s*amount,\s*currency:\s*target,\s*converted:\s*entries\.length,\s*skipped:\s*0\s*\};/);
  });

  it("falls back to `target` (not displayCurrency) for items missing their own costCurrency", () => {
    // Otherwise an item with cost=10 and no costCurrency would be treated
    // as displayCurrency even when the collection has overridden the target.
    assert.match(src, /currency:\s*item\.costCurrency\s*\?\?\s*target,/);
  });
});

describe("CurrencySheet — extracted to a shared component", () => {
  const sheet = read("components/currency-sheet.tsx");
  const create = read("app/create.tsx");
  const collection = read("app/collection/[id].tsx");

  it("components/currency-sheet.tsx exports a named CurrencySheet React component", () => {
    assert.match(sheet, /export\s+function\s+CurrencySheet\s*\(/);
  });

  it("app/create.tsx imports the shared CurrencySheet and no longer declares a local copy", () => {
    assert.match(create, /import\s*\{\s*CurrencySheet\s*\}\s*from\s*"@\/components\/currency-sheet"/);
    // The function-form local declaration is gone — only the JSX usage <CurrencySheet ... /> remains.
    assert.doesNotMatch(create, /function\s+CurrencySheet\s*\(/);
  });

  it("app/collection/[id].tsx imports the shared CurrencySheet and mounts it in JSX", () => {
    assert.match(collection, /import\s*\{\s*CurrencySheet\s*\}\s*from\s*"@\/components\/currency-sheet"/);
    assert.match(collection, /<CurrencySheet\s*\n?\s*visible=\{currencySheetOpen\}/);
  });
});

describe("Collection edit modal — currency picker UI wiring", () => {
  const src = read("app/collection/[id].tsx");

  it("declares editCurrency state seeded by openEditModal from activeCollection.currency", () => {
    assert.match(src, /const\s+\[editCurrency,\s*setEditCurrency\]\s*=\s*useState<string>\(/);
    assert.match(src, /setEditCurrency\(activeCollection\.currency\s*\?\?\s*""\)/);
  });

  it("save handler sends `currency: editCurrency.trim() || null` so blank clears the override", () => {
    // The empty-string-becomes-null collapse is the only way for the user
    // to undo a previously-set override and go back to the app default.
    assert.match(
      src,
      /currency:\s*editCurrency\.trim\(\)\s*\|\|\s*null,/,
    );
  });

  it("renders an edit-modal Pressable that opens the sheet in `edit` mode", () => {
    // The edit-mode path defers the save to the modal submit so Cancel
    // still works. Without the mode flag, every pick would persist
    // immediately and break Cancel semantics.
    assert.match(
      src,
      /onPress=\{\s*\(\s*\)\s*=>\s*\{\s*setCurrencyQuery\(""\);\s*setCurrencySheetMode\("edit"\);\s*setCurrencySheetOpen\(true\);\s*\}\s*\}/,
    );
  });

  it("total-cost summary card is a Pressable for owners that opens the sheet in `quick` mode", () => {
    // Quick-mode tap-to-swap is the discoverable shortcut: tap the
    // currency code on the total-cost card → pick → persists on the spot.
    assert.match(src, /setCurrencySheetMode\("quick"\)/);
    assert.match(src, /isOwner\s*\?\s*\(\s*<Pressable[\s\S]*?onPress=\{openCurrencyPicker\}/);
  });

  it("CurrencySheet onSelect persists immediately when mode === 'quick'", () => {
    assert.match(
      src,
      /if\s*\(\s*currencySheetMode\s*===\s*"quick"\s*\)\s*\{\s*void\s+updateCollection\(\s*activeCollection\.id\s*,\s*\{\s*currency:\s*code\s*\}\s*\);\s*\}/,
    );
  });
});

describe("i18n — collection currency keys across all 6 languages", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares the 3 new keys in the en base table", () => {
    assert.match(src, /collectionCurrencyHint:\s*"[^"]+"/);
    assert.match(src, /collectionCurrencyAuto:\s*"[^"]+"/);
    assert.match(src, /collectionCurrencyA11y:\s*\(params\?:\s*TranslationParams\)\s*=>/);
  });

  it("ru / be / pl / de / es each override collectionCurrencyHint with a native string", () => {
    for (const lang of ["ru", "be", "pl", "de", "es"]) {
      const re = new RegExp(`const\\s+${lang}:\\s*TranslationMap\\s*=\\s*\\{[\\s\\S]*?collectionCurrencyHint:[\\s\\S]*?\\};`);
      assert.match(src, re, `${lang} table missing localized collectionCurrencyHint`);
    }
  });

  it("collectionCurrencyA11y formatter routes params?.currency through a `?? ''` fallback in all 6 locales", () => {
    const matches = src.match(/collectionCurrencyA11y:[\s\S]*?params\?\.currency\s*\?\?\s*""/g) ?? [];
    assert.equal(matches.length, 6, `expected 6 collectionCurrencyA11y formatters with currency fallback, got ${matches.length}`);
  });
});

describe("SQL migration + MANUAL-TASKS entry for the currency column", () => {
  it("ships supabase/migrations/20260523_collection_currency.sql with the ALTER TABLE", () => {
    const sql = read("supabase/migrations/20260523_collection_currency.sql");
    assert.match(sql, /ALTER\s+TABLE\s+public\.collections/);
    assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+currency\s+text\s+NULL/);
  });

  it("MANUAL-TASKS.md documents the 20260523 migration so an operator can apply it", () => {
    const md = read("MANUAL-TASKS.md");
    assert.match(md, /20260523_collection_currency\.sql/);
    assert.match(md, /ADD COLUMN IF NOT EXISTS currency text NULL/);
  });
});
