import {
  indexI18nKeyUsage,
  unreadI18nKeys,
  type ScannedSource,
} from "@/lib/i18n-key-usage";
import { findLocaleBlock, TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-source";


/**
 * Scanner behind `scripts/check-orphan-i18n-keys.ts` (`npm run lint:orphan-i18n`):
 * flags base translation keys that nothing in the source tree reads.
 *
 * A dead translation key is dead SILENTLY, which is why this needs a guard
 * rather than review. Every locale map in `lib/i18n-context.tsx` opens with
 * `...en`, so `t("peopleTitle")` returns a non-empty string in all six
 * languages whether or not a screen renders it — nothing at runtime, and no
 * assertion that renders a component, can tell a live key from an orphan. Only
 * the source can. Three families totalling 36 keys were removed by hand on
 * 2026-08-20/21 after a throwaway scan found them; this is that scan, made
 * permanent, so the next one cannot accumulate.
 *
 * WHAT COUNTS AS A READ is not decided here any more. `lib/i18n-key-usage.ts`
 * owns the rule and the reverse index it builds — file → keys, key → files —
 * because "is this key read anywhere" is the smaller half of a fact that walk
 * already computes, and the per-screen half is what the remaining translation
 * work needs. This module is the ORPHAN question: which keys came back with no
 * readers, which locales declare them, and how that reads as a report.
 *
 * Pure module: no filesystem access — the CLI walks the tree and hands sources
 * over, so the scanner is unit-testable under `node --test`.
 */

/** A base key no source file mentions. */
export type OrphanKeyFinding = {
  /** The key, as the base map spells it. */
  readonly key: string;
  /** Every locale that declares it — what a removal would have to delete. */
  readonly declaredIn: readonly string[];
};

/**
 * Base keys that no scanned source mentions, in base-map order.
 *
 * Base-map order rather than alphabetical so a whole dead family reports as a
 * run of adjacent keys — which is how the three removed families read, and how
 * a reader recognises "this is one feature" rather than "these are nine
 * unrelated mistakes". The order is {@link unreadI18nKeys}' now, since the
 * index is keyed in the order the base map declares.
 */
export function findOrphanI18nKeys(
  i18nSource: string,
  sources: readonly ScannedSource[],
): OrphanKeyFinding[] {
  const usage = indexI18nKeyUsage(baseKeys(i18nSource), sources);
  return unreadI18nKeys(usage).map((key) => ({
    key,
    declaredIn: localesDeclaring(i18nSource, key),
  }));
}

/**
 * The base map's keys, or a throw naming what is missing.
 *
 * Throws rather than answering with an empty list, which the index would
 * happily accept and report as a tree with no orphans: no keys asked about,
 * none unread. "There are no orphans" and "there are no keys" are the same
 * green run and different facts.
 */
function baseKeys(i18nSource: string): readonly string[] {
  const base = findLocaleBlock(i18nSource, TRANSLATION_BASE_LANGUAGE);
  if (!base) {
    throw new Error(
      `check-orphan-i18n-keys: no \`const ${TRANSLATION_BASE_LANGUAGE}\` map in the translations source — without the base map there are no keys to check, which is not the same as there being no orphans`,
    );
  }
  return base.keys;
}

/** Which locale maps declare `key`, in file order. */
function localesDeclaring(i18nSource: string, key: string): readonly string[] {
  const declaring: string[] = [];
  for (const code of ["ru", "en", "be", "pl", "de", "es"]) {
    const block = findLocaleBlock(i18nSource, code);
    if (block?.keys.includes(key)) declaring.push(code);
  }
  return declaring;
}

/**
 * The report, naming every orphan and what removing it would touch.
 *
 * Says which locales declare each key because that is the next question a
 * reader has: a key in `en` and `ru` is a two-line deletion, and one the four
 * partial locales also translated is a reminder that somebody spent time on a
 * string with no consumer.
 */
export function formatOrphanKeyReport(
  findings: readonly OrphanKeyFinding[],
  scannedFiles: number,
): string {
  const lines = [
    `check-orphan-i18n-keys: ${findings.length} base key(s) that nothing in ${scannedFiles} scanned file(s) reads.`,
    "",
    "A key no source mentions still RESOLVES — every locale map spreads `...en`, so",
    "`t(key)` returns a non-empty string in all six languages and nothing at runtime",
    "shows the difference. Delete it, or add the reader that was meant to render it.",
    "",
  ];
  for (const { key, declaredIn } of findings) {
    lines.push(`  ${key} — declared in ${declaredIn.join(", ")}`);
  }
  return lines.join("\n");
}
