import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applySortMode, getTitleCollator } from "@/lib/item-filters";
import { getDefaultLocaleForLanguage, languageLocaleMap } from "@/lib/locale-helpers";
import type { CollectableItem } from "@/lib/types";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * `applySortMode(items, sort)` used to collate with `locale = undefined`, i.e.
 * the JS runtime default. On native that is the DEVICE locale; on a
 * server-rendered web preview it is usually `en-US`. Neither is necessarily the
 * language the user pinned in the app, so a Russian speaker reading the app in
 * Polish could get an ordering that disagrees with every label around it.
 *
 * The fix threads the pinned language through as a BCP-47 tag. The mapping is
 * done at the CALL SITE, not inside `lib/item-filters.ts`, because
 * `lib/locale-helpers.ts` pulls AsyncStorage and would make the pure module
 * un-importable under `tsx --test` — that constraint is worth pinning too,
 * since "just import the map" is the obvious-looking refactor that breaks the
 * whole suite.
 */

function item(id: string, title: string): CollectableItem {
  return {
    id,
    collectionId: "c1",
    title,
    createdAt: "2026-01-01T00:00:00.000Z",
  } as CollectableItem;
}

describe("applySortMode — locale parameter", () => {
  it("accepts a BCP-47 tag as its third argument", () => {
    const sorted = applySortMode([item("1", "Zebra"), item("2", "Apple")], "name-asc", "pl-PL");
    assert.deepEqual(sorted.map((i) => i.title), ["Apple", "Zebra"]);
  });

  it("routes the locale into the cached collator rather than ignoring it", () => {
    // If the parameter were accepted but dropped, this would still pass a
    // smoke test — so assert the collator identity the sort would have used.
    assert.equal(getTitleCollator("de-DE"), getTitleCollator("de-DE"));
    assert.notEqual(getTitleCollator("de-DE"), getTitleCollator("es-ES"));
  });

  it("still works with the locale omitted (callers outside the screen)", () => {
    const sorted = applySortMode([item("1", "Zebra"), item("2", "Apple")], "name-asc");
    assert.deepEqual(sorted.map((i) => i.title), ["Apple", "Zebra"]);
  });

  it("ignores the locale entirely on the default mode (identity path)", () => {
    const input = [item("1", "Zebra"), item("2", "Apple")];
    assert.equal(applySortMode(input, "default", "pl-PL"), input);
  });

  it("collates every supported app language without throwing", () => {
    // Each of the six languages maps to a real BCP-47 tag; an unmapped or
    // malformed tag would make `new Intl.Collator` throw a RangeError and take
    // the whole collection screen down.
    for (const language of Object.keys(languageLocaleMap)) {
      const locale = getDefaultLocaleForLanguage(language);
      const sorted = applySortMode(
        [item("1", "Żaba"), item("2", "Zebra"), item("3", "Apple")],
        "name-asc",
        locale,
      );
      assert.equal(sorted.length, 3, `sorting failed for ${language} (${locale})`);
      assert.equal(sorted[0].title, "Apple", `unexpected head for ${language} (${locale})`);
    }
  });

  it("orders Polish ż after z, matching what a pl user expects", () => {
    // The concrete payoff: in pl-PL collation "ż" is its own letter after "z",
    // while the en-US default folds it next to "z" ahead of "zebra"-like
    // words in some inputs. Asserting the pl ordering pins that the tag is
    // actually reaching ICU and not being swallowed.
    const sorted = applySortMode(
      [item("1", "żubr"), item("2", "zebra")],
      "name-asc",
      getDefaultLocaleForLanguage("pl"),
    );
    assert.deepEqual(sorted.map((i) => i.title), ["zebra", "żubr"]);
  });
});

describe("app/collection/[id].tsx — call-site wiring", () => {
  const src = read("app/collection/[id].tsx");

  it("reads `language` off useI18n alongside `t`", () => {
    assert.match(src, /const\s*\{\s*t,\s*language\s*\}\s*=\s*useI18n\(\);/);
  });

  it("maps the app language to BCP-47 via getDefaultLocaleForLanguage", () => {
    // Passing the raw `AppLanguage` ("ru") instead of the tag ("ru-RU") would
    // still collate, but drops the region-specific rules — the same class of
    // bug the currency/date formatters already solved with this helper.
    assert.match(src, /import\s*\{\s*getDefaultLocaleForLanguage\s*\}\s*from\s*"@\/lib\/locale-helpers";/);
    assert.match(
      src,
      /const\s+sortLocale\s*=\s*useMemo\(\(\)\s*=>\s*getDefaultLocaleForLanguage\(language\)\s*,\s*\[\s*language\s*\]\)/,
    );
  });

  it("passes sortLocale into applySortMode", () => {
    assert.match(src, /applySortMode\(filteredItems,\s*itemFilters\.sort,\s*sortLocale\)/);
  });

  it("lists sortLocale as a memo dependency", () => {
    // Without it a language switch leaves the list collated under the previous
    // locale's rules until some unrelated change invalidates the memo.
    assert.match(
      src,
      /applySortMode\(filteredItems,\s*itemFilters\.sort,\s*sortLocale\)\s*,\s*\n?\s*\[\s*filteredItems\s*,\s*itemFilters\.sort\s*,\s*sortLocale\s*\]/,
    );
  });
});

describe("lib/item-filters.ts — stays node-importable", () => {
  const src = read("lib/item-filters.ts");

  it("does not import locale-helpers (which pulls AsyncStorage)", () => {
    // This is the whole reason the mapping lives at the call site. Importing
    // the map here would drag AsyncStorage into a module the test harness
    // imports directly, breaking every pure test that touches it.
    assert.ok(
      !/from\s*"@\/lib\/locale-helpers"/.test(src),
      "lib/item-filters.ts must not import locale-helpers — map at the call site",
    );
  });

  it("imports nothing from react-native or @react-native-async-storage", () => {
    assert.ok(!/from\s*"react-native"/.test(src));
    assert.ok(!/@react-native-async-storage/.test(src));
  });

  it("documents that the locale is a BCP-47 tag from the PINNED language", () => {
    // The parameter is easy to satisfy with the device locale, which is the
    // bug this task fixed. The doc comment is what stops that.
    const docIdx = src.indexOf("export function applySortMode");
    // Strip the ` * ` gutter and collapse newlines — the phrase legitimately
    // wraps across lines, and a raw-source regex would fail on formatting.
    const doc = src
      .slice(Math.max(0, docIdx - 1400), docIdx)
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ");
    assert.match(doc, /BCP-47/);
    assert.match(doc, /pinned app language/i);
  });
});
