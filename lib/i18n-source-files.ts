/**
 * Where the app's copy lives, said once for the tooling that measures it.
 *
 * The six locale maps were 3696 of `lib/i18n-context.tsx`'s 3929 lines until
 * 2026-09-13, when they became modules of their own — the step that makes four
 * of them fetchable on demand instead of shipped to every visitor. Three
 * readers care WHICH files that is: the copy measure behind
 * `check-bundle-size`'s drift line, the orphan-key guard, and the suites that
 * ask structural questions of the translations.
 *
 * A list in three places is a list that disagrees the first time a seventh
 * language lands, and the disagreement is silent in the direction that
 * matters: a locale nobody measures reads as copy that costs nothing.
 *
 * Strings only, and no imports, so nothing about naming these files can pull
 * anything into a bundle — the same reason `lib/source-dirs.ts` is shaped this
 * way.
 */

/** The provider: the context, the hooks and the date formatters. */
export const I18N_PROVIDER_SOURCE = "lib/i18n-context.tsx";

/** `AppLanguage`, `TranslationParams`, `TranslationValue`. */
export const I18N_TYPES_SOURCE = "lib/i18n/types.ts";

/**
 * The six locale maps, `en` first because it is the key set the other five are
 * checked against, then the order `languageOptions` lists them in.
 */
export const I18N_LOCALE_SOURCES: readonly string[] = [
  "lib/i18n/en.ts",
  "lib/i18n/ru.ts",
  "lib/i18n/be.ts",
  "lib/i18n/pl.ts",
  "lib/i18n/de.ts",
  "lib/i18n/es.ts",
];

/** Every file the translations module is spread across, provider first. */
export const I18N_SOURCE_FILES: readonly string[] = [
  I18N_PROVIDER_SOURCE,
  I18N_TYPES_SOURCE,
  ...I18N_LOCALE_SOURCES,
];
