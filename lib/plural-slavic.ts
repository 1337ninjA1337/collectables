/**
 * The one/few/many agreement Russian, Belarusian and Polish all share.
 *
 * Six locales write count-bearing strings and three of them need a noun to
 * agree with the number. English and German and Spanish need two forms and get
 * them from a ternary at the call site; `ru`, `be` and `pl` need three, and
 * before this module existed they mostly did not have them:
 *
 *   `itemsCount` rendered "1 предметов" / "1 прадметаў" / "1 przedmiotów",
 *   `accessOpenFor` rendered "для 1 человек", `sharedWithPeople` rendered
 *   "Udostępniono 1 osobom".
 *
 * Every one of those is the plural form under the number one, on the surface a
 * user meets most often — a collection with a single item, a link shared with
 * a single person. They were DECLARED, so no coverage number reported them and
 * no family suite could: the keys are translated, and translated wrongly.
 *
 * The rule was already in the tree twice, spelled out inline inside
 * `ru.selectedCount` and `ru.deleteItemsTitle`, which is how it came to be
 * applied to two keys out of sixteen. Stated once here, it is a thing a
 * translator can reach for.
 *
 * THE RULE, which is the same in all three languages:
 *
 *  - ends in 1, but not 11        → the singular         (1, 21, 101 предмет)
 *  - ends in 2–4, but not 12–14   → the "few" form       (2, 23, 104 предмета)
 *  - anything else                → the "many" form      (5, 11, 19 предметов)
 *
 * Polish agrees on the shape and differs on what the three forms ARE:
 * nominative singular, nominative plural, genitive plural (`przedmiot`,
 * `przedmioty`, `przedmiotów`). Belarusian follows Russian. So the branch
 * belongs here and the words belong at the call site, which is also what makes
 * this usable for a case (`osoba`/`osoby`/`osób`) that is not a count of
 * objects at all.
 *
 * Not every count-bearing key needs it. `Перамешчана: 5` puts the number after
 * a colon and agrees with nothing, `Фільтры (3)` parenthesises it, and `фота`
 * is indeclinable in Belarusian — those are correct as flat templates and are
 * deliberately left alone. Reaching for this function where the grammar does
 * not ask for it would add three words to maintain for no reader.
 *
 * Integer counts only. A fractional count takes the "many" form in Russian and
 * a genitive singular in Polish, which is a different rule for a case this app
 * does not have: everything counted here is a row.
 *
 * Node-pure, so `__tests__/plural-slavic.test.ts` exercises the branch
 * directly rather than through `lib/i18n-context.tsx`, which pulls React
 * Native peers.
 */

/**
 * Picks the form `count` agrees with.
 *
 * `count` is whatever a `TranslationParams` holds — a number, or the string a
 * caller passed by mistake — so it is coerced and a non-number falls to
 * {@link many}, the form that reads correctly for "some unknown quantity".
 */
export function slavicPlural(
  count: unknown,
  one: string,
  few: string,
  many: string,
): string {
  const n = Math.abs(Math.trunc(Number(count)));
  if (!Number.isFinite(n)) return many;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
