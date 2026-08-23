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
 */
export const PRIVACY_PAGE_LANGUAGES: readonly PrivacyPageLanguage[] = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "be", label: "Беларуская" },
  { code: "pl", label: "Polski" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
];

/** The original the five translations are checked against, not one of them. */
export const PRIVACY_DEFAULT_LANGUAGE = "en";
