import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * HM-C4 structural pins: `CurrencySheet` is memoized (named form) and the
 * collection-detail call site passes hoisted-useCallback handlers, so the
 * hidden `<Modal visible={false}>` subtree skips reconciliation during
 * scroll-driven re-renders. This closes the HM-C modalsBlock sweep — all
 * four children of the composition-only modalsBlock are memoized components
 * receiving referentially stable props.
 */
function readSheetSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "currency-sheet.tsx"), "utf8");
}

function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("HM-C4 — CurrencySheet memoization + stable call site", () => {
  it("components/currency-sheet.tsx exports a named-form memo component", () => {
    const src = readSheetSrc();
    assert.match(src, /export\s+const\s+CurrencySheet\s*=\s*(?:React\.)?memo\(\s*function\s+CurrencySheet\b/);
    assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/);
  });

  it("the collection call site passes only referentially stable props", () => {
    const src = readCollectionSrc();
    const m = src.match(/<CurrencySheet\s+[\s\S]*?\/>/);
    assert.ok(m, "<CurrencySheet> call site not found");
    const site = m[0];
    assert.match(site, /visible=\{\s*currencySheetOpen\s*\}/);
    assert.match(site, /selectedCode=\{\s*editCurrency\s*\}/);
    assert.match(site, /query=\{\s*currencyQuery\s*\}/);
    assert.match(site, /onQueryChange=\{\s*setCurrencyQuery\s*\}/);
    assert.match(site, /onSelect=\{\s*handleCurrencySelect\s*\}/);
    assert.match(site, /onClose=\{\s*closeCurrencySheet\s*\}/);
    assert.doesNotMatch(site, /=>/, "no inline arrows may remain on the memoized sheet's props");
  });

  it("handleCurrencySelect and closeCurrencySheet are hoisted useCallbacks", () => {
    const src = readCollectionSrc();
    const firstEarlyReturn = src.search(/\n  if \(loadingRemote && !collection\) \{/);
    assert.ok(firstEarlyReturn > 0, "early-return anchor not found");
    for (const name of ["handleCurrencySelect", "closeCurrencySheet"]) {
      assert.match(src, new RegExp(`const\\s+${name}\\s*=\\s*useCallback\\(`), `${name} must be a useCallback`);
      const idx = src.indexOf(`const ${name} = useCallback`);
      assert.ok(idx > 0 && idx < firstEarlyReturn, `${name} must sit above the early returns`);
    }
  });

  it("handleCurrencySelect carries honest deps", () => {
    const src = readCollectionSrc();
    const m = src.match(/const\s+handleCurrencySelect\s*=\s*useCallback\([\s\S]*?\},\s*\[([^\]]*)\]\s*,?\s*\)/);
    assert.ok(m, "handleCurrencySelect useCallback with dep array not found");
    for (const dep of ["currencySheetMode", "collection", "updateCollection"]) {
      assert.match(m[1], new RegExp(`\\b${dep}\\b`), `handleCurrencySelect deps must include ${dep}`);
    }
  });
});
