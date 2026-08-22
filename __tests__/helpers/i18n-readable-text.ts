/**
 * The translatable TEXT inside one declared value of `lib/i18n-context.tsx`,
 * whatever shape the value is written in.
 *
 * Extracted from `i18n-complete-families.test.ts`, which grew it, when a second
 * suite needed the same reading. The question "is this locale's string the
 * English one" is asked twice now — once per listed FAMILY, and once over the
 * whole map — and the two must agree about what a value SAYS or the narrower
 * suite could pass a key the broader one fails for a reason that is about the
 * reader rather than about the translation.
 *
 * Takes the value span rather than a language and a key so that it can be
 * exercised on a shape the tree does not currently contain — a capability that
 * is correct and unused is the one a future "nothing uses this" removes
 * truthfully and wrongly. The span itself comes from `LocaleBlock.values`:
 * colon to the comma that ends the entry, brace-aware, which is what makes a
 * block body readable at all.
 *
 * A string literal yields its inner text, escapes and all, tolerating the
 * line-wrapped form (`key:\n    "…"`) the long strings are written in — there
 * is no prettier here, so both spellings genuinely exist side by side.
 *
 * Anything else yields every template literal in it, joined by newlines: one
 * for the arrow-expression form, three for an arrow whose body branches. The
 * interpolations are deliberately left in rather than stripped — they are
 * identical across locales, so they neither hide a difference nor invent one,
 * and they are where a copy-paste hides: `${slavicPlural(params?.count,
 * "предмет", …)}` puts the translated words inside what looks like code.
 *
 * Returns `null` for a value containing no readable text at all, which is the
 * answer the vacuity cases exist to catch — `null` compared against `null` is
 * what a reader that stopped working returns, and it looks like agreement.
 */
export function readableText(value: string): string | null {
  const literal = /^"((?:[^"\\]|\\.)*)"$/s.exec(value);
  if (literal) return literal[1];

  const templates = [...value.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  return templates.length > 0 ? templates.join("\n") : null;
}
