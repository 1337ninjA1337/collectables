import { captureException } from "@/lib/sentry";

import { en, type TranslationMap } from "./en";
import { ru } from "./ru";
import type { AppLanguage } from "./types";

/**
 * Which locale maps ship with the page load, and how the others arrive.
 *
 * ## 208 KiB, measured
 *
 * All six maps were in the entry chunk and one of them is ever read. They are
 * 314 KiB of source between them — the largest single thing every visitor
 * downloads, because Metro escapes the Cyrillic and the Polish diacritics as
 * `\uXXXX` and six locales cost six bytes a letter — so five sixths of that
 * was copy nobody in the session would see.
 *
 * **`en` and `ru` stay eager, and that is the whole of the trade.** `ru` is
 * what `I18nProvider` starts in and what most sessions stay in, so fetching it
 * would put a network round trip in front of the first paint for the common
 * case. `en` is the fallback every other map spreads and the one `t()` reads
 * when a key is missing, so it has to be in memory whatever the user picked.
 * The other four are fetched when somebody actually chooses them.
 *
 * ## What a failed fetch does
 *
 * Returns null, and the caller keeps the language it had. A browser that
 * cannot reach the chunk (offline, a stale service worker, a deploy mid-flight)
 * would otherwise leave the app in a language whose copy is not there, which
 * renders as English under a Polish setting — the app silently changing
 * language is worse than a switch that visibly did not happen. The failure is
 * reported, so a locale nobody can load is a signal rather than a mystery.
 *
 * ## Why a module and not the provider
 *
 * The provider is React; this is a cache with a loader, and every question
 * worth asking about it — is a locale loaded, does a second call fetch twice,
 * what happens when the chunk 404s — is answerable without mounting anything.
 */

/** The maps that are in the entry chunk, keyed for the registry. */
const EAGER: ReadonlyMap<AppLanguage, TranslationMap> = new Map([
  ["en", en as TranslationMap],
  ["ru", ru],
]);

/** The languages a page load pays for. */
export const EAGER_LOCALES: readonly AppLanguage[] = [...EAGER.keys()];

/**
 * A named alias rather than an inline `() => Promise<TranslationMap>` below,
 * because the arrow's `=` ends the annotation as far as `lib/i18n-source.ts`'s
 * declaration reader is concerned — and that reader is how every suite finds
 * the record that has to name all six languages.
 */
type LocaleLoader = () => Promise<TranslationMap>;

/**
 * One `import()` per lazy locale, written as a literal specifier each.
 *
 * Metro resolves a dynamic import statically, so a computed specifier would
 * either bundle every locale back into one chunk or resolve nothing at all.
 * Six named entries is what makes the chunks.
 */
const loaders: Record<AppLanguage, LocaleLoader> = {
  en: () => Promise.resolve(en as TranslationMap),
  ru: () => Promise.resolve(ru),
  be: async () => (await import("./be")).be,
  pl: async () => (await import("./pl")).pl,
  de: async () => (await import("./de")).de,
  es: async () => (await import("./es")).es,
};

const loaded = new Map<AppLanguage, TranslationMap>(EAGER);

/** In-flight fetches, so two callers asking at once share one chunk request. */
const inflight = new Map<AppLanguage, Promise<TranslationMap | null>>();

/** The map every missing key falls back to. Always in memory. */
export const baseLocale: TranslationMap = en as TranslationMap;

/** The map for a language, or null when it has not been fetched yet. */
export function loadedLocale(language: AppLanguage): TranslationMap | null {
  return loaded.get(language) ?? null;
}

export function isLocaleLoaded(language: AppLanguage): boolean {
  return loaded.has(language);
}

/**
 * Resolves a language's map, fetching its chunk the first time.
 *
 * Never rejects: a caller in a render path cannot do anything useful with a
 * thrown chunk error, and the honest answer to "the copy is not reachable" is
 * null plus a report.
 */
export async function loadLocale(
  language: AppLanguage,
): Promise<TranslationMap | null> {
  const already = loaded.get(language);
  if (already) return already;

  const pending = inflight.get(language);
  if (pending) return pending;

  const attempt = loaders[language]()
    .then((map) => {
      loaded.set(language, map);
      return map;
    })
    .catch((error: unknown) => {
      captureException(error, { scope: "i18n.loadLocale" });
      return null;
    })
    .finally(() => {
      // Cleared either way: a failed fetch must be retryable, because the
      // usual cause is a network that comes back.
      inflight.delete(language);
    });

  inflight.set(language, attempt);
  return attempt;
}

/** Test seam: forgets everything a case loaded, keeping the eager pair. */
export function __resetLoadedLocalesForTests(): void {
  loaded.clear();
  for (const [code, map] of EAGER) loaded.set(code, map);
  inflight.clear();
  for (const [code, loader] of realLoaders) loaders[code] = loader;
}

/** What each entry of {@link loaders} was before any case replaced it. */
const realLoaders: ReadonlyMap<AppLanguage, LocaleLoader> = new Map(
  Object.entries(loaders) as [AppLanguage, LocaleLoader][],
);

/**
 * Test seam: swaps one locale's loader.
 *
 * The failure this module promises to survive — a chunk that will not load —
 * has no other way in. `loaders` is module-private on purpose (a caller that
 * could reach it could also bypass the cache), and a suite that only asserts
 * the `.catch` is THERE is asserting the source rather than the behaviour.
 * {@link __resetLoadedLocalesForTests} puts the real one back.
 */
export function __setLocaleLoaderForTests(
  language: AppLanguage,
  loader: LocaleLoader,
): void {
  loaders[language] = loader;
}
