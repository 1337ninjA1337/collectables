import {
  indexI18nKeyUsage,
  unreadI18nKeys,
  type ScannedSource,
} from "@/lib/i18n-key-usage";
import { TRANSLATION_LANGUAGES } from "@/lib/i18n-coverage";
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
  // Parsed ONCE, here, and handed down as an index. See the note on
  // {@link localesDeclaring} for why it takes the index rather than the source.
  const declarations = indexLocaleDeclarations(i18nSource);
  return unreadI18nKeys(usage).map((key) => ({
    key,
    declaredIn: localesDeclaring(declarations, key),
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

/**
 * Which keys each locale map declares — the translations source parsed once.
 *
 * A locale missing from the source is missing from the map rather than present
 * and empty, and the two are different facts: "this checkout has no `de` map"
 * is worth being able to see, and an empty `Set` would report every key as
 * undeclared there, which reads identically to a locale that translated
 * nothing.
 */
export type LocaleDeclarations = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Build it, over every language {@link TRANSLATION_LANGUAGES} names.
 *
 * DERIVED from that constant, which is the one every i18n suite in the tree
 * measures against and the one a seventh language is added to. It was a fourth
 * hand-written copy of the same six codes, and the way that copy fails is
 * quiet: the report would keep saying a key is declared in six locales while
 * the seventh translated it too, so "a two-line deletion" — the whole reason
 * this exists — would be a number nobody could act on. `i18n-coverage` declares
 * no imports back this way, so this is a leaf-ward edge.
 */
export function indexLocaleDeclarations(i18nSource: string): LocaleDeclarations {
  const index = new Map<string, ReadonlySet<string>>();
  for (const code of TRANSLATION_LANGUAGES) {
    const block = findLocaleBlock(i18nSource, code);
    if (block) index.set(code, new Set(block.keys));
  }
  return index;
}

/**
 * Which locale maps declare `key`, in picker order.
 *
 * TAKES THE INDEX, NOT THE SOURCE, and that is the point rather than a
 * convenience. It used to take the source and call `findLocaleBlock` itself,
 * once per locale per finding — so a run over the real tree re-parsed a
 * 500-key file `orphans × 6` times and then scanned an array of ~498 keys
 * linearly for each. Both costs are invisible at three orphans and neither has
 * a reason to exist.
 *
 * The fix is not "remember to hoist the parse": it is that this function no
 * longer HAS the source, so re-parsing per key is not a thing it can express.
 * The compiler enforces that; `__tests__/check-orphan-i18n-keys.test.ts` says
 * so out loud for the reader who would otherwise thread the source back in as
 * an obvious simplification.
 *
 * Order is {@link TRANSLATION_LANGUAGES}' rather than the map's insertion
 * order, which happens to agree — the report prints this list verbatim and
 * should depend on the constant that documents itself as picker order, not on
 * how the index was filled.
 */
function localesDeclaring(
  declarations: LocaleDeclarations,
  key: string,
): readonly string[] {
  const declaring: string[] = [];
  for (const code of TRANSLATION_LANGUAGES) {
    if (declarations.get(code)?.has(key)) declaring.push(code);
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
