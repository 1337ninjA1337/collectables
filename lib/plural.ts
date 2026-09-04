/**
 * How this app agrees a word with a number, in all six languages.
 *
 * Two rules, because the six locales need two. English, German and Spanish
 * take a singular and a plural; Russian, Belarusian and Polish take three
 * forms and pick between them on the last digit. Both live here rather than in
 * two modules, because the question a reader arrives with is "how do plurals
 * work in this map", and splitting the answer by language family is how one
 * half gets applied and the other forgotten — which is exactly what happened.
 *
 * WHAT WAS WRONG, in every locale including the base one.
 *
 * Sixteen keys interpolate a count. Before this module, four of them agreed
 * anything: `en.deleteItemsTitle` and the two `syncingPill*` keys had inline
 * ternaries, and `ru.selectedCount` had the Slavic rule spelled out by hand. The
 * rest were flat templates carrying the plural form, so under the number one
 * they read:
 *
 *   "1 items", "1 photos", "Shared with 1 people", "Moved 1 items"     (en)
 *   "1 Objekte", "Mit 1 Personen geteilt"                              (de)
 *   "1 objetos", "Cargar más (1 restantes)"                            (es)
 *   "1 предметов", "1 прадметаў", "1 przedmiotów"                      (ru/be/pl)
 *
 * A collection holding one item is the most ordinary state in the app and it
 * was ungrammatical in six languages at once. Nothing reported it: those keys
 * are DECLARED everywhere, so every coverage percentage counted them as done
 * and every completeness suite passed. They were translated, and translated
 * wrongly — the boundary of what a count of decisions can measure.
 *
 * WHY THE WORDS STAY AT THE CALL SITE. Neither function knows any vocabulary.
 * That is what lets `pl` use the three-form branch for `osoba`/`osoby`/`osób`
 * while `ru` uses it for `предмет`/`предмета`/`предметов`, and what lets a
 * caller agree a VERB as easily as a noun — `de.accessOpenFor` passes
 * "Person hat" and "Personen haben", because German changes both.
 *
 * NOT every count-bearing key needs either function, and most do not.
 * `Перамешчана: 5` puts the number after a colon, `Filters (3)` brackets it,
 * `1 selected` and `1 remaining` are participles that do not inflect, and
 * *фото* is an indeclinable loanword in Russian and Belarusian. Reaching for a
 * helper where the grammar does not ask for one adds forms to maintain for no
 * reader. `__tests__/i18n-agreement.test.ts` draws that line as a rule: a word
 * placed directly after the count must come from here, with a per-entry
 * exemption list for the words that genuinely do not change.
 *
 * Integer counts only, in both functions. A fractional count takes the "many"
 * form in Russian and a genitive singular in Polish — a different rule for a
 * case this app does not have, since everything counted here is a row.
 *
 * Node-pure, so `__tests__/plural.test.ts` exercises both branches directly
 * rather than through `lib/i18n-context.tsx`, which pulls React Native peers.
 *
 * WHO ELSE ASKS, because it is no longer only the translation maps. Everything
 * above is about the six languages and the sixteen count-bearing keys, and that
 * is where the rule was argued — but the same sentence gets written wherever a
 * number meets a word, and this repository wrote it twice more before noticing.
 * `lib/audit-baseline.ts` prints "1 advisory" / "18 advisories" for a human
 * reading a failing gate, and `__tests__/helpers/coverage-floor.ts` prints "only
 * 1 probe" / "only 0 probes" for a human reading a failing assertion. Both used
 * to carry their own `count === 1`.
 *
 * Nothing about `plural` is specific to a translation map — it knows no
 * vocabulary at all, which is exactly what makes it the two-form rule for a
 * gate's English as much as for `en`, `de` and `es`. `slavicPlural` has no
 * caller outside `lib/i18n-context.tsx` and wants none: this tree produces no
 * Russian failure messages.
 *
 * The three of them — `lib/i18n-context.tsx`, `lib/audit-baseline.ts`,
 * `__tests__/helpers/coverage-floor.ts` — are named here rather than counted,
 * and `__tests__/plural.test.ts` walks the tree for importers and fails on one
 * this paragraph does not mention. A list in prose is a list that goes stale;
 * this one goes red instead.
 */

/**
 * The count as a rule can use it: a non-negative integer.
 *
 * `TranslationParams` values are `string | number`, so a caller can hand these
 * functions a numeric string, and a missing param arrives as `undefined`.
 * Anything that is not a finite number becomes `NaN` here, and both rules send
 * `NaN` to their plural form — "some unknown quantity of items" reads
 * correctly, where the singular would assert there is exactly one.
 */
function countOf(count: unknown): number {
  const n = Math.abs(Math.trunc(Number(count)));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Picks between a singular and a plural — English, German, Spanish.
 *
 * Only exactly one takes {@link one}. Zero takes the plural in all three
 * languages ("0 items", "0 Objekte", "0 objetos"), which is why this is not
 * written as "less than two".
 */
export function plural(count: unknown, one: string, other: string): string {
  return countOf(count) === 1 ? one : other;
}

/**
 * Picks between three forms — Russian, Belarusian, Polish.
 *
 * The rule, which is the same in all three languages:
 *
 *  - ends in 1, but not 11        → {@link one}   (1, 21, 101 предмет)
 *  - ends in 2–4, but not 12–14   → {@link few}   (2, 23, 104 предмета)
 *  - anything else                → {@link many}  (0, 5, 11, 19 предметов)
 *
 * Polish agrees on the shape and differs on what the three forms ARE:
 * nominative singular, nominative plural, genitive plural (`przedmiot`,
 * `przedmioty`, `przedmiotów`). Belarusian follows Russian.
 *
 * The `% 100` term is the whole content of the rule and the half that gets
 * dropped: 11 ends in 1 and takes the plural, 111 ends in 11 and takes the
 * singular. An earlier hand-written copy of this in `ru.deleteItemsTitle`
 * excluded the teens as `mod100 < 10 || mod100 >= 20`, which also excludes 10
 * and 15–19 — harmless, because those end in 0 and 5–9 and never reach the
 * branch, and not the rule.
 */
export function slavicPlural(
  count: unknown,
  one: string,
  few: string,
  many: string,
): string {
  const n = countOf(count);
  if (!Number.isFinite(n)) return many;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
