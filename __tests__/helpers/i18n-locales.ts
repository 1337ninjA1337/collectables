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
 * One key's declared VALUE in each locale, exactly — the parser's span, not a
 * regex's guess at where the entry ends.
 *
 * The pattern-taking helpers above match against a whole map body, which
 * leaves the `key:[\s\S]*?SHAPE` idiom able to stride from its own key to a
 * LATER key's value and call that a match. That is the same lazy-crossing
 * mistake as the per-locale slice, one level down, and it is why the scanner
 * now returns value spans: matched against this, the value is all there is to
 * match.
 *
 * Throws when a locale does not declare the key, rather than omitting it — the
 * callers are asserting something about every locale, and a short map would
 * make the loop that follows quietly weaker.
 */
export function localeValuesOf(
  source: string,
  key: string,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const code of locales(source)) {
    const block = findLocaleBlock(source, code);
    assert.ok(block, `no translation map for '${code}'`);
    const value = block!.values.get(key);
    assert.ok(
      value !== undefined,
      `'${key}' is not declared in ${code} — that locale serves the English string`,
    );
    values.set(code, value!);
  }
  return values;
}

/**
 * Asserts every locale's declared value for `key` matches `pattern`.
 *
 * The exact-span counterpart of {@link assertMatchesInEveryLocale}: use this
 * whenever the claim is about ONE key's value, and reach for the body-matching
 * form only when the claim is genuinely about the map.
 */
export function assertValueInEveryLocale(
  source: string,
  key: string,
  pattern: RegExp,
  label: string,
): void {
  assert.ok(
    !pattern.global,
    `${label}: pass a non-global pattern — a /g regex carries lastIndex between locales`,
  );
  const wrong: string[] = [];
  for (const [code, value] of localeValuesOf(source, key)) {
    if (!pattern.test(value)) wrong.push(`${code} (${value})`);
  }
  assert.deepEqual(wrong, [], `${label} — wrong in ${wrong.join("; ")}`);
}

/**
 * Each locale's copy for a key that is declared as a plain string literal, with
 * the quotes off — for the cases asserting the locales carry different words
 * rather than the English one pasted six times.
 *
 * Throws on a locale whose value is not a string literal, so a key that became
 * a formatter in one language is a named failure rather than a silently
 * skipped comparison.
 */
export function localeStrings(
  source: string,
  key: string,
): ReadonlyMap<string, string> {
  const strings = new Map<string, string>();
  for (const [code, value] of localeValuesOf(source, key)) {
    const match = /^"([^"]*)"$/.exec(value);
    assert.ok(match, `${code}: '${key}' is not a plain string literal: ${value}`);
    strings.set(code, match![1]);
  }
  return strings;
}
