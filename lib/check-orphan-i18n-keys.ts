import { findLocaleBlock, TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-source";
import { stripComments } from "@/lib/strip-comments";

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
 * WHAT COUNTS AS A READ, and why it is not `t("…")`.
 *
 * The obvious rule — match `t("key")` — is wrong here, and measurably: 43 of
 * this tree's 502 base keys are never written inside a `t(...)` call at all.
 * They are reached through four different forms:
 *
 *  - `t("filterClearSearch")`, the direct call;
 *  - `{ mode: "name-asc", labelKey: "sortNameAsc" }` in `lib/item-filters.ts`
 *    and `from_negative: "filterPriceNegative"` beside it — a key stored in a
 *    table and handed to `t()` somewhere else entirely;
 *  - `pick(t, "crashFallbackTitle")` in `components/crash-fallback.tsx`, a
 *    helper that takes the key and the translator;
 *  - ``t(`condition${…}` as "conditionNew" | "conditionExcellent" | …)``, the
 *    tree's only dynamic key build, which spells its union out in an `as`
 *    clause.
 *
 * So the rule is: a base key is READ if it appears anywhere in the source tree
 * as a bare string literal. That covers all four forms uniformly, and it is
 * what makes an exemptions list unnecessary — the `as` clause of the dynamic
 * build IS a list of string literals, so the case the original design worried
 * about (a hand-maintained allowlist for dynamic keys, drifting out of date)
 * does not arise. If a fifth form ever appears that this cannot see, the fix
 * is to widen the rule or to write the key down in an `as` clause, not to
 * exempt it: an exemption is a key nobody has to justify again.
 *
 * The rule is deliberately LOOSE in one direction and the looseness is the
 * price of having no exemptions. A key whose name collides with an unrelated
 * string literal — `"you"`, `"profile"` — is counted as read even if nothing
 * calls `t()` on it. It is still far tighter than the bare-word matching the
 * throwaway scans used, which counted `profileId` as read because
 * `lib/social-context.tsx` declares six `(profileId: string)` PARAMETERS; that
 * key was dead and three hand-run scans missed it. Prefer a rule that reports
 * one real orphan late over one that reports a live key.
 *
 * Comments are stripped before matching, so a doc block naming a key does not
 * keep it alive — this module's own would otherwise resurrect nine of them.
 * `lib/i18n-context.tsx` is excluded from the walk for the same reason at a
 * larger scale: it declares every key, so including it would make every key
 * read and the guard vacuous.
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
 * Every bare string literal in one source, comments stripped.
 *
 * Restricted to identifier-shaped contents because that is what a translation
 * key is: matching arbitrary string bodies would pull in every sentence in the
 * tree and cost time for hits that can never be keys.
 */
export function collectStringLiterals(source: string): ReadonlySet<string> {
  const literals = new Set<string>();
  for (const match of stripComments(source).matchAll(
    /["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  )) {
    literals.add(match[1]);
  }
  return literals;
}

/** One source file, as the CLI hands it over. */
export type ScannedSource = {
  readonly file: string;
  readonly source: string;
};

/**
 * Base keys that no scanned source mentions, in base-map order.
 *
 * Base-map order rather than alphabetical so a whole dead family reports as a
 * run of adjacent keys — which is how the three removed families read, and how
 * a reader recognises "this is one feature" rather than "these are nine
 * unrelated mistakes".
 */
export function findOrphanI18nKeys(
  i18nSource: string,
  sources: readonly ScannedSource[],
): OrphanKeyFinding[] {
  const base = findLocaleBlock(i18nSource, TRANSLATION_BASE_LANGUAGE);
  if (!base) {
    throw new Error(
      `check-orphan-i18n-keys: no \`const ${TRANSLATION_BASE_LANGUAGE}\` map in the translations source — without the base map there are no keys to check, which is not the same as there being no orphans`,
    );
  }

  const mentioned = new Set<string>();
  for (const { source } of sources) {
    for (const literal of collectStringLiterals(source)) mentioned.add(literal);
  }

  return base.keys
    .filter((key) => !mentioned.has(key))
    .map((key) => ({ key, declaredIn: localesDeclaring(i18nSource, key) }));
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
