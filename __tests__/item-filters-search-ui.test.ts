import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for the in-collection search row added to the
 * `<ItemFilterBar>` sheet UI. The pure matcher already exists in
 * `lib/item-filters.ts` (see `item-filters-query.test.ts`); these tests
 * guard the UI plumbing so a future refactor can't silently disconnect
 * the TextInput from `draft.query` or drop the i18n placeholder key.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("components/item-filters.tsx — search row UI", () => {
  const src = read("components/item-filters.tsx");

  it("renders a TextInput bound to draft.query inside the sheet", () => {
    // value={draft.query} — without this, the input would render blank
    // even after a previous search-and-apply round, breaking the
    // "open sheet again to refine my search" flow.
    assert.match(src, /value=\{\s*draft\.query\s*\}/);
  });

  it("writes back to draft.query via setDraft on every keystroke", () => {
    // The onChangeText must mirror the same setDraft pattern as the
    // other fields so Apply/Reset CTAs stay coherent.
    assert.match(
      src,
      /onChangeText=\{\s*\(v\)\s*=>\s*setDraft\(\{\s*\.\.\.draft\s*,\s*query:\s*v\s*\}\)\s*\}/,
    );
  });

  it("uses the new searchInCollectionPlaceholder i18n key on the TextInput", () => {
    assert.match(src, /placeholder=\{\s*t\(\s*"searchInCollectionPlaceholder"\s*\)\s*\}/);
  });

  it("renders a clear chip (Ionicons close-circle) only when draft.query has content", () => {
    // The chip must be gated on draft.query.length > 0 — a permanently
    // visible clear button on an empty input is the usability anti-pattern
    // we're avoiding (matches the create.tsx search row shape).
    assert.match(
      src,
      /\{\s*draft\.query\.length\s*>\s*0\s*\?\s*\(\s*<Pressable[\s\S]*?name="close-circle"/,
    );
  });

  it("clear chip resets draft.query to the empty string (not undefined)", () => {
    // setDraft({ ...draft, query: "" }) preserves all other in-flight
    // draft state — a `setDraft({ query: "" })` (no spread) would wipe
    // the user's price/date inputs as a side effect.
    assert.match(
      src,
      /onPress=\{\s*\(\)\s*=>\s*setDraft\(\{\s*\.\.\.draft\s*,\s*query:\s*""\s*\}\)\s*\}/,
    );
  });

  it("places the search row above the price-range field row in the sheet", () => {
    // Ordering matters for affordance: search is the primary CTA,
    // price/date are advanced filters.
    const searchIdx = src.indexOf("sheetSearchRow");
    const priceIdx = src.indexOf("filterPriceFrom");
    assert.ok(searchIdx > 0, "sheetSearchRow style is missing");
    assert.ok(priceIdx > 0, "filterPriceFrom field is missing");
    assert.ok(
      searchIdx < priceIdx,
      `expected the search row to be declared before the price-range field row (searchIdx=${searchIdx} priceIdx=${priceIdx})`,
    );
  });

  it("declares sheetSearchRow + sheetSearchInput styles for the new row", () => {
    assert.match(src, /sheetSearchRow:\s*\{[\s\S]*?flexDirection:\s*"row"/);
    assert.match(src, /sheetSearchInput:\s*\{[\s\S]*?flex:\s*1/);
  });
});

describe("i18n — searchInCollectionPlaceholder key across all 6 supported languages", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares searchInCollectionPlaceholder in the en base table", () => {
    // The en table defines the TranslationKey union (keyof typeof en),
    // so the key MUST land here — otherwise the other languages can't
    // override it and t("searchInCollectionPlaceholder") wouldn't type-check.
    assert.match(src, /searchInCollectionPlaceholder:\s*"[^"]+"/);
  });

  it("overrides searchInCollectionPlaceholder in ru / be / pl / de / es so each language has a native string", () => {
    for (const lang of ["ru", "be", "pl", "de", "es"]) {
      const re = new RegExp(
        `const\\s+${lang}:\\s*TranslationMap\\s*=\\s*\\{[\\s\\S]*?searchInCollectionPlaceholder:\\s*"[^"]+"[\\s\\S]*?\\};`,
      );
      assert.match(
        src,
        re,
        `${lang} table is missing a localized searchInCollectionPlaceholder override`,
      );
    }
  });

  it("exactly 6 searchInCollectionPlaceholder declarations across the file (en + 5 overrides)", () => {
    const matches = src.match(/searchInCollectionPlaceholder:\s*"[^"]+"/g) ?? [];
    assert.equal(
      matches.length,
      6,
      `expected 6 searchInCollectionPlaceholder declarations, got ${matches.length}`,
    );
  });
});

describe("components/item-filters.tsx — search row accessibility", () => {
  const src = read("components/item-filters.tsx");

  it("labels the TextInput so VoiceOver announces more than 'edit text'", () => {
    // The placeholder is only read AFTER focus, so an unlabeled input is
    // undiscoverable while swiping through the sheet — the whole point of
    // the separate a11y key rather than reusing the placeholder string.
    assert.match(src, /accessibilityLabel=\{\s*t\(\s*"searchInCollectionA11y"\s*\)\s*\}/);
  });

  it("gives the TextInput the search role", () => {
    assert.match(src, /accessibilityRole="search"/);
  });

  it("keeps the label and the placeholder on separate i18n keys", () => {
    // Reusing `searchInCollectionPlaceholder` for both would force the label
    // to stay short enough not to be truncated in the field, which is the
    // opposite constraint from the one a spoken label has.
    assert.doesNotMatch(src, /accessibilityLabel=\{\s*t\(\s*"searchInCollectionPlaceholder"\s*\)\s*\}/);
  });

  it("names the clear button, which was an unlabeled icon-only Pressable", () => {
    assert.match(
      src,
      /<Pressable[\s\S]{0,220}accessibilityRole="button"[\s\S]{0,120}accessibilityLabel=\{\s*t\(\s*"filterClearSearch"\s*\)\s*\}/,
    );
  });

  it("hides both decorative Ionicons from the accessibility tree", () => {
    // A focusable but unnamed icon makes a screen-reader user swipe past an
    // anonymous element to reach the field it decorates.
    const hidden = src.match(/accessibilityElementsHidden/g) ?? [];
    assert.ok(hidden.length >= 2, `expected the magnifier + clear icons hidden, got ${hidden.length}`);
    // Android honours importantForAccessibility, iOS accessibilityElementsHidden —
    // shipping only one leaves the other platform announcing the icon.
    const androidHidden = src.match(/importantForAccessibility="no"/g) ?? [];
    assert.equal(androidHidden.length, hidden.length, "each hidden icon needs BOTH platform props");
  });
});

describe("i18n — search a11y keys across all 6 supported languages", () => {
  const src = read("lib/i18n-context.tsx");

  for (const key of ["searchInCollectionA11y", "filterClearSearch"]) {
    it(`declares ${key} exactly 6 times (en base + 5 overrides)`, () => {
      const matches = src.match(new RegExp(`${key}:\\s*"[^"]+"`, "g")) ?? [];
      assert.equal(matches.length, 6, `expected 6 ${key} declarations, got ${matches.length}`);
    });

    it(`localizes ${key} in ru / be / pl / de / es rather than falling back to en`, () => {
      for (const lang of ["ru", "be", "pl", "de", "es"]) {
        const re = new RegExp(
          `const\\s+${lang}:\\s*TranslationMap\\s*=\\s*\\{[\\s\\S]*?${key}:\\s*"[^"]+"[\\s\\S]*?\\};`,
        );
        assert.match(src, re, `${lang} table is missing a localized ${key} override`);
      }
    });
  }

  it("keeps the spoken label distinct from the placeholder in every language", () => {
    // Identical strings would mean VoiceOver reads the same phrase twice —
    // once as the label, once as the placeholder value.
    const labels = src.match(/searchInCollectionA11y:\s*"([^"]+)"/g) ?? [];
    const placeholders = src.match(/searchInCollectionPlaceholder:\s*"([^"]+)"/g) ?? [];
    assert.equal(labels.length, placeholders.length);
    for (let i = 0; i < labels.length; i += 1) {
      const label = labels[i].split('"')[1];
      const placeholder = placeholders[i].split('"')[1];
      assert.notEqual(label, placeholder, `label duplicates the placeholder: "${label}"`);
      assert.ok(label.length > placeholder.length, `the spoken label should be the fuller phrase: "${label}"`);
    }
  });
});

describe("components/item-filters.tsx — active query quick chip", () => {
  const src = read("components/item-filters.tsx");

  it("renders the chip only when the query has non-whitespace content", () => {
    // A whitespace-only query matches nothing in `applyItemFilters`, so a
    // chip for it would name a narrowing that isn't happening.
    assert.match(src, /const queryChip = filters\.query\.trim\(\);/);
    assert.match(src, /\{\s*queryChip\.length\s*>\s*0\s*\?\s*\(\s*<Pressable/);
  });

  it("shows the trimmed needle, matching what applyItemFilters actually matches on", () => {
    assert.match(src, /<Text style=\{styles\.queryQuickChipText\} numberOfLines=\{1\}>\s*\{queryChip\}/);
  });

  it("clears ONLY the query, leaving sort and the other filters intact", () => {
    // `reset()` wipes everything; this chip's ✕ must undo the chip alone.
    assert.match(src, /function clearQuery\(\) \{\s*onChange\(\{ \.\.\.filters, query: "" \}\);\s*\}/);
  });

  it("reads the query back from `filters`, not from the sheet's `draft`", () => {
    // `draft` is uncommitted sheet state — a chip driven by it would name a
    // narrowing the user typed but never applied.
    assert.doesNotMatch(src, /const queryChip = draft/);
  });

  it("is announced with the needle in its label", () => {
    assert.match(src, /accessibilityLabel=\{\s*t\("queryChipClear", \{ query: queryChip \}\)\s*\}/);
  });

  it("caps the chip width and ellipsises, so a long needle can't push the other chips off-screen", () => {
    assert.match(src, /queryQuickChip:\s*\{[\s\S]*?maxWidth:\s*\d+/);
    assert.match(src, /queryQuickChipText:\s*\{[\s\S]*?flexShrink:\s*1/);
  });

  it("sits before the sort chip in the quickChips row", () => {
    // Narrowing-by-content is the more surprising state to forget, so it
    // reads first in the scroll order.
    const queryIdx = src.indexOf("styles.queryQuickChip");
    const sortIdx = src.indexOf("styles.sortQuickChip");
    assert.ok(queryIdx > 0 && sortIdx > 0);
    assert.ok(queryIdx < sortIdx, "the query chip should render before the sort chip");
  });
});

describe("i18n — queryChipClear across all 6 supported languages", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares queryChipClear exactly 6 times (en base + 5 overrides)", () => {
    const matches = src.match(/queryChipClear:\s*\(params\?: TranslationParams\)/g) ?? [];
    assert.equal(matches.length, 6, `expected 6 queryChipClear declarations, got ${matches.length}`);
  });

  it("interpolates the needle in every language rather than dropping it", () => {
    // A label that says only "tap to clear" tells a non-visual user that
    // something is narrowing the list but not what.
    const bodies = src.match(/queryChipClear:\s*\(params\?: TranslationParams\)\s*=>\s*\n?\s*`[^`]+`/g) ?? [];
    assert.equal(bodies.length, 6);
    for (const body of bodies) {
      assert.match(body, /\$\{params\?\.query \?\? ""\}/, `missing query interpolation: ${body}`);
    }
  });

  it("localizes queryChipClear in ru / be / pl / de / es", () => {
    for (const lang of ["ru", "be", "pl", "de", "es"]) {
      const re = new RegExp(
        `const\\s+${lang}:\\s*TranslationMap\\s*=\\s*\\{[\\s\\S]*?queryChipClear:[\\s\\S]*?\\};`,
      );
      assert.match(src, re, `${lang} table is missing a localized queryChipClear override`);
    }
  });
});
