import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards the localization-overflow fix on the home-screen collection tabs.
 * A long unbreakable label (ru "Отслеживаемые") pushed the flex:1 tab row past
 * the screen edge on web. The flex items must be allowed to shrink and the
 * labels must scale/wrap instead of overflowing.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("SwipeTabs — labels stay inside their chips", () => {
  const src = read("components/swipe-tabs.tsx");

  it("lets flex tab items shrink below content width (minWidth: 0)", () => {
    const matches = src.match(/minWidth:\s*0/g) ?? [];
    assert.ok(matches.length >= 2, `expected minWidth:0 on tab + subTab, got ${matches.length}`);
  });

  it("scales/wraps tab labels instead of overflowing", () => {
    const matches = src.match(/numberOfLines=\{2\}\s*\n?\s*adjustsFontSizeToFit/g) ?? [];
    assert.ok(matches.length >= 2, `expected adjustsFontSizeToFit on both tab variants, got ${matches.length}`);
  });
});

describe("i18n — overly long tab label shortened to fit", () => {
  it("ru tabSubscribedCollections is a short single word (was the overflowing 'Отслеживаемые')", () => {
    const src = read("lib/i18n-context.tsx");
    assert.match(src, /tabSubscribedCollections:\s*"Подписки"/);
    assert.doesNotMatch(src, /tabSubscribedCollections:\s*"Отслеживаемые"/);
  });
});
