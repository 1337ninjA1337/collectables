/**
 * The vocabulary the locale modules are written in.
 *
 * Split out of `lib/i18n-context.tsx` when the six locale maps became modules
 * of their own: they need these three names and nothing else from the
 * provider, and a locale module that imported the provider would pull React,
 * AsyncStorage and the analytics client into a file that is a dictionary.
 *
 * `TranslationKey` and `TranslationMap` are NOT here — they are derived from
 * the English map and live in `./en`, because the key set is that file and a
 * type declared away from its source is a second statement of it.
 */

/** Every language the app ships copy for. */
export type AppLanguage = "ru" | "en" | "be" | "pl" | "de" | "es";

/** What a counted or named string is interpolated with. */
export type TranslationParams = Record<string, string | number>;

/** A entry in a locale map: a literal, or a function of its params. */
export type TranslationValue = string | ((params?: TranslationParams) => string);
