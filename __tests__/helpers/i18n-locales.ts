/**
 * "Is this key translated everywhere?", asked of each locale map instead of
 * counted across the file.
 *
 * Twenty-odd cases in eleven suites asked it the same wrong way: match
 * `key:` against the whole of `lib/i18n-context.tsx`, count the hits, assert
 * six. It reads as a parity check and it is a SUM, so it is satisfied by any
 * arrangement adding to six — a key declared twice in `ru` and missing from
 * `de` is green, which is the exact failure the check was written to catch,
 * and the message it prints when it does fail ("expected 6, got 5") names no
 * locale. The parser has answered the question properly since `localeKeys`
 * existed; these call sites predate it.
 *
 * Two more things the count got wrong and nobody had reason to look at:
 *  - it matched anywhere, including inside a template that mentions the key,
 *    so a `t("filterClearSearch")` in a comment could stand in for a
 *    declaration;
 *  - the six was a literal. A seventh language turns every one of these cases
 *    red at once with "expected 6, got 7", which reads as the new locale being
 *    wrong rather than as twenty assertions needing their number bumped. The
 *    locales are read from the PICKER here (`languageOptionCodes`), so a
 *    seventh is checked rather than counted.
 */

import assert from "node:assert/strict";

import {
  findLocaleBlock,
  languageOptionCodes,
  localeKeys,
  TRANSLATION_BASE_LANGUAGE,
} from "@/lib/i18n-source";

/** The picker's language codes — what "every locale" means, in picker order. */
export function locales(source: string): readonly string[] {
  return languageOptionCodes(source);
}

/**
 * Each locale map's body text, keyed by language code.
 *
 * For the assertions that are about a VALUE's shape (`params?.count ?? 0`, a
 * template rather than a string) rather than about a key existing. Scoping the
 * match to one map is what makes the answer name a locale; it does not make a
 * lazy `[\s\S]*?` between the key and the shape exact, so a pattern that could
 * stride from one key to a later key's value in the same map still can. Prefer
 * a pattern anchored to the key it is about.
 */
export function localeBodies(source: string): ReadonlyMap<string, string> {
  const bodies = new Map<string, string>();
  for (const code of locales(source)) {
    const block = findLocaleBlock(source, code);
    assert.ok(block, `no translation map for '${code}'`);
    bodies.set(code, block!.body);
  }
  return bodies;
}

/**
 * Asserts every locale DECLARES the key for itself, rather than inheriting the
 * English one through its `...en` spread.
 *
 * The distinction is the whole subject: an inherited key renders, fits the
 * layout, and returns a non-empty string from `t()`, so nothing at runtime and
 * nothing in a green suite tells it from a translated one.
 */
export function assertDeclaredInEveryLocale(
  source: string,
  key: string,
): void {
  const missing = locales(source).filter(
    (code) => !localeKeys(source, code).has(key),
  );
  assert.deepEqual(
    missing,
    [],
    `'${key}' is not declared in ${missing.join(", ")} — those locales serve the English string`,
  );
}

/**
 * Asserts each locale's map matches `pattern` — the value-shape counterpart of
 * {@link assertDeclaredInEveryLocale}.
 *
 * `pattern` is applied to one map's body at a time and must not carry the `g`
 * flag: a global regex keeps `lastIndex` between calls, which would make this
 * report failures depending on the order the locales happen to be walked in.
 */
export function assertMatchesInEveryLocale(
  source: string,
  pattern: RegExp,
  label: string,
): void {
  assert.ok(
    !pattern.global,
    `${label}: pass a non-global pattern — a /g regex carries lastIndex between locales`,
  );
  const missing: string[] = [];
  for (const [code, body] of localeBodies(source)) {
    if (!pattern.test(body)) missing.push(code);
  }
  assert.deepEqual(missing, [], `${label} — not matched in ${missing.join(", ")}`);
}

/**
 * {@link assertMatchesInEveryLocale} over the locales that INHERIT — every one
 * but {@link TRANSLATION_BASE_LANGUAGE}.
 *
 * The suites' phrasing for this is "overrides X in ru / be / pl / de / es
 * rather than falling back to en", and the base map is excluded because it
 * cannot fall back to itself. What it replaces is a per-locale slice —
 * `const ${lang}: TranslationMap = \\{[\\s\\S]*?KEY:[\\s\\S]*?\\};` — that did
 * not slice: `[\\s\\S]*?` crosses `};` as happily as any other character, so
 * the match ran from the named map's opening brace, through however many later
 * maps it took to find the key, and out to the next `};` after THAT. The key
 * had only to exist somewhere at or below the named locale, which for `ru` —
 * the first map in the file — meant anywhere at all.
 */
export function assertMatchesInEveryNonBaseLocale(
  source: string,
  pattern: RegExp,
  label: string,
): void {
  assert.ok(
    !pattern.global,
    `${label}: pass a non-global pattern — a /g regex carries lastIndex between locales`,
  );
  const missing: string[] = [];
  for (const [code, body] of localeBodies(source)) {
    if (code === TRANSLATION_BASE_LANGUAGE) continue;
    if (!pattern.test(body)) missing.push(code);
  }
  assert.deepEqual(missing, [], `${label} — not overridden in ${missing.join(", ")}`);
}

/**
 * One capture group, taken from each locale's map: the locale's own copy for a
 * key, for the cases asserting the six are different strings rather than the
 * English one pasted six times.
 *
 * Throws when a locale does not match at all, so "distinct" is never proved
 * over a short list — five values from six locales are trivially distinct.
 */
export function localeValues(
  source: string,
  pattern: RegExp,
  label: string,
): ReadonlyMap<string, string> {
  assert.ok(
    !pattern.global,
    `${label}: pass a non-global pattern — a /g regex carries lastIndex between locales`,
  );
  const values = new Map<string, string>();
  for (const [code, body] of localeBodies(source)) {
    const match = pattern.exec(body);
    assert.ok(match, `${label}: no match in '${code}'`);
    assert.ok(
      match![1] !== undefined,
      `${label}: pattern has no capture group for the value`,
    );
    values.set(code, match![1]);
  }
  return values;
}
