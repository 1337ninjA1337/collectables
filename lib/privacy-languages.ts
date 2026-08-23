/**
 * Which languages a `/privacy` page is published in, and which one is the
 * original. Nothing else.
 *
 * WHY THIS IS ITS OWN MODULE. The list lived in `lib/privacy-page.ts`, next to
 * an HTML renderer, a markdown-to-HTML pass, a Content-Security-Policy string
 * and a language picker — and six modules that want nothing but the six codes
 * imported all of it. Four of them are provenance evaluators whose entire job is
 * to compare a recorded value against a table key; they pulled a page renderer
 * into their import graph to ask which codes exist, and `lib/bundle-smoke.ts`
 * asks the same question about a build. A leaf with two constants in it is what
 * they were all reaching for.
 *
 * The second reason is the one that would have bitten: `lib/privacy-body-baselines.ts`
 * imported the list, and `lib/privacy-baseline-provenance.ts` imported BOTH that
 * module and the list directly — the same constant through two paths, which is
 * harmless right up to the day somebody moves the path helper and closes a
 * cycle. There is one path now.
 *
 * A LEAF, deliberately: no imports at all, so anything may depend on it and it
 * can never be the module that made a cycle.
 *
 * Declared here rather than derived from `languageOptions` in
 * `lib/i18n-context.tsx` for the reason that was true before the split and still
 * is: this list is read by node build scripts, which cannot load a module that
 * imports React and AsyncStorage. The two are drift-guarded against each other
 * by `__tests__/privacy-page-i18n.test.ts`.
 */

export type PrivacyPageLanguage = { code: string; label: string };

/**
 * Languages the /privacy page is offered in.
 *
 * English is the canonical full policy at `/privacy/`; every other code is a
 * translated Sentry-disclosure page (`PRIVACY.md.<code>`) served at
 * `/privacy/<code>/`. That asymmetry is why `PRIVACY_TRANSLATED_LANGUAGES` next
 * door is this list MINUS the default rather than a second list.
 *
 * Order is the picker's order and is not alphabetical: the original first, then
 * the translations in the order they shipped.
 *
 * DECLARED `as const satisfies`, not annotated. The annotation
 * (`: readonly PrivacyPageLanguage[]`) that used to be here widened every code
 * to `string` and took {@link PrivacyPageLanguageCode} — and with it the tie
 * between this list and {@link PRIVACY_DEFAULT_LANGUAGE} — down to nothing.
 * `satisfies` checks the same shape and keeps the literals. That is the whole
 * mechanism, so `__tests__/privacy-languages.test.ts` pins it directly rather
 * than trusting a reader to know why the annotation is absent.
 */
export const PRIVACY_PAGE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "be", label: "Беларуская" },
  { code: "pl", label: "Polski" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
] as const satisfies readonly PrivacyPageLanguage[];

/**
 * The six codes, as a type.
 *
 * DERIVED from the list above, which is the only reason it is worth having: a
 * seventh language is one line in one place and this union grows with it. Three
 * modules validate a table key against this set at runtime and will keep doing
 * so — their keys come out of object literals and git output, which no compiler
 * sees. What the type buys is the other half: a value written down in SOURCE as
 * one of the six, checked at the moment it is written rather than on the run
 * where something happens to read it.
 *
 * {@link PRIVACY_DEFAULT_LANGUAGE} is the first such value and was the reason
 * this type exists — see the note there.
 */
export type PrivacyPageLanguageCode =
  (typeof PRIVACY_PAGE_LANGUAGES)[number]["code"];

/**
 * The original the five translations are checked against, not one of them.
 *
 * TYPED, not inferred, and the annotation is the point: it says this string is
 * one of the six the list publishes, and the compiler agrees or the build stops.
 * Before it, the two constants sat next to each other with nothing between them
 * — a default of `"eng"`, or an `en` entry deleted from the list, was a
 * contradiction no check in the repository would have found. What it produced
 * instead was a `/privacy` build whose root page had no picker entry, a
 * `PRIVACY_TRANSLATED_LANGUAGES` that quietly grew a sixth member, and a
 * provenance guard measuring `PRIVACY.md.eng` against a diff and reporting the
 * file as untouched. Every one of those is the same one-word mistake arriving
 * somewhere far away from it.
 */
export const PRIVACY_DEFAULT_LANGUAGE: PrivacyPageLanguageCode = "en";
