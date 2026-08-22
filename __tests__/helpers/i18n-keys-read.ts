/**
 * "Does this screen render these strings?", asked with the repo's own rule.
 *
 * Seven suites asked it by hand: `new RegExp(`t\\("${key}"`)` against one
 * file's text, once per key, in `share-sheet`, `bulk-bar-extraction`,
 * `edit-collection-modal`, `move-collection-modal`, `collection-share-sheet`
 * and `photo-lightbox-item-card`. Nothing was wrong with the answers — those
 * screens all use the direct call — and the RULE is one this repository has
 * already measured as wrong: 43 of 502 base keys are never written inside a
 * `t(...)` call, because a key can be stored in a table
 * (`labelKey: "sortNameAsc"`, which `lib/item-filters.ts` does), handed to a
 * helper (`pick(t, "crashFallbackTitle")`) or named in an `as` clause. The
 * first screen to move a key into a table goes red while still rendering it,
 * and the suite reporting that would be reporting its own rule.
 *
 * So the question routes through `lib/i18n-key-usage.ts` — the same index
 * `check-orphan-i18n-keys` decides orphanhood with. One rule, and a screen
 * that changes HOW it reaches a key no longer has to be re-litigated in the
 * suite that pins WHICH keys it reads.
 *
 * The conversion also added a check the regex form could not make: a key
 * asserted here must exist in the base map. A test naming a key nothing
 * declares used to pass as long as the screen named it too — and a screen
 * calling `t("undeclaredKey")` renders the key name at runtime, in every
 * language.
 *
 * Not a coverage rule. This says a named file reads named keys; how much of a
 * SCREEN is translated is a different question, and the index is the thing
 * both stand on.
 */

import assert from "node:assert/strict";

import { indexI18nKeyUsage } from "@/lib/i18n-key-usage";
import { localeKeys, TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-source";

import { readI18nSource } from "./i18n-source-file";
import { sourceCode } from "./source-files";

/**
 * The base map's keys, read once per process.
 *
 * `tsx --test` gives each suite its own process, so this is a per-suite cache
 * of one parse — the same argument `source-files.ts` makes about its walk, at
 * a smaller scale.
 */
let baseKeysCache: readonly string[] | null = null;

function baseKeys(): readonly string[] {
  baseKeysCache ??= [...localeKeys(readI18nSource(), TRANSLATION_BASE_LANGUAGE)];
  return baseKeysCache;
}

/**
 * Every base key one file reads, in base-map order.
 *
 * Comments are stripped before matching (`sourceCode`), so a key named in a
 * doc block explaining why it was removed is not a read.
 */
export function keysReadBy(relative: string): readonly string[] {
  const usage = indexI18nKeyUsage(baseKeys(), [
    { file: relative, source: sourceCode(relative) },
  ]);
  return usage.byFile.get(relative) ?? [];
}

/**
 * Asserts `relative` reads every key in `keys`.
 *
 * Reports the whole missing set rather than the first, because a screen that
 * stopped rendering a section is missing a family and one name at a time reads
 * as three unrelated failures.
 */
export function assertReadsKeys(
  relative: string,
  keys: readonly string[],
): void {
  const declared = new Set(baseKeys());
  const undeclared = keys.filter((key) => !declared.has(key));
  assert.deepEqual(
    undeclared,
    [],
    `these keys are asserted of ${relative} and no locale map declares them: ${undeclared.join(", ")} — \`t()\` renders the key name itself, in every language`,
  );

  const read = new Set(keysReadBy(relative));
  const missing = keys.filter((key) => !read.has(key));
  assert.deepEqual(
    missing,
    [],
    `${relative} does not read ${missing.join(", ")} — every user-facing string on this surface goes through \`t()\``,
  );
}
