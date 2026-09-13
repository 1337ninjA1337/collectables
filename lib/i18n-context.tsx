import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { trackEvent } from "@/lib/analytics";
// The six locale maps live one per module, and only `en` and `ru` are in the
// entry chunk: `ru` is what this provider starts in and `en` is what every
// missing key falls back to, so both have to be in memory before the first
// paint. The other four — 208 KiB of copy nobody in a Russian session ever
// reads — arrive through `import()` when somebody picks them.
// `lib/i18n/registry.ts` is the cache and the loader.
import type { TranslationKey } from "@/lib/i18n/en";
import {
  baseLocale,
  isLocaleLoaded,
  loadLocale,
  loadedLocale,
} from "@/lib/i18n/registry";
import type { AppLanguage, TranslationParams } from "@/lib/i18n/types";
import { getDefaultLocaleForLanguage } from "@/lib/locale-helpers";
import { reportStorageFailure } from "@/lib/report-storage-failure";
import { LANGUAGE_KEY } from "@/lib/storage-keys";

/**
 * Re-exported, because `@/lib/i18n-context` is where the rest of the app has
 * always asked for these and a move of the maps is not a reason to touch a
 * hundred import lines. `lib/i18n/types.ts` and `lib/i18n/en.ts` are where they
 * are declared.
 */
export type { AppLanguage } from "@/lib/i18n/types";
export type { TranslationKey } from "@/lib/i18n/en";

const languageOptions: { code: AppLanguage; label: string }[] = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "be", label: "Беларуская" },
  { code: "pl", label: "Polski" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
];

// Memoise the Intl.RelativeTimeFormat instance per BCP-47 tag. Without the
// cache, a list view rendering N timestamps (chats, price history) news up
// N formatters per paint — fine for one-off labels, wasteful for long lists.
// Keyed by the resolved BCP-47 tag (after `getDefaultLocaleForLanguage`) so
// callers passing the same `AppLanguage` and callers passing the same raw
// locale string both hit the same cache slot.
const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

function getRelativeTimeFormat(bcp47: string): Intl.RelativeTimeFormat {
  const cached = relativeTimeFormatCache.get(bcp47);
  if (cached) return cached;
  const formatter = new Intl.RelativeTimeFormat(bcp47, { numeric: "auto" });
  relativeTimeFormatCache.set(bcp47, formatter);
  return formatter;
}

/**
 * Compose a "{prefix} {relative-date}" label without forcing every consumer
 * to add a new translation entry per pattern. The six supported locales all
 * share the `prefix + space + when` shape (English "Listed yesterday",
 * Russian "Размещено вчера", German "Eingestellt gestern", etc.), so the
 * helper just splices a single space between the translated prefix and the
 * already-localised relative-time clause.
 *
 * @example
 *   const { t, relativeDateLabel, formatRelativeDate } = useI18n();
 *   relativeDateLabel(t("marketplaceListed"), formatRelativeDate(iso));
 *   // → "Listed 5 hours ago"
 */
export function relativeDateLabel(prefix: string, when: string): string {
  const head = prefix.trim();
  const tail = when.trim();
  if (!head) return tail;
  if (!tail) return head;
  return `${head} ${tail}`;
}

export function formatRelativeDate(iso: string, locale: AppLanguage | string = "en"): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diffMs = then - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);
  const diffWk = Math.round(diffDay / 7);
  const diffMo = Math.round(diffDay / 30);
  const diffYr = Math.round(diffDay / 365);

  const bcp47 = getDefaultLocaleForLanguage(locale);
  const rtf = getRelativeTimeFormat(bcp47);

  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "second");
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  if (Math.abs(diffDay) < 7) return rtf.format(diffDay, "day");
  if (Math.abs(diffWk) < 5) return rtf.format(diffWk, "week");
  if (Math.abs(diffMo) < 12) return rtf.format(diffMo, "month");
  return rtf.format(diffYr, "year");
}

/**
 * Render a locale-aware absolute date+time string for "power-user" timestamps
 * (long-press tooltips, accessibility labels, etc.). Mirrors
 * `formatRelativeDate`'s guard-clause-on-invalid-ISO behaviour so callers can
 * pass through any persisted ISO string without pre-validating it.
 */
export function formatAbsoluteDate(iso: string, locale: AppLanguage | string = "en"): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const bcp47 = getDefaultLocaleForLanguage(locale);
  return new Date(then).toLocaleString(bcp47, { dateStyle: "medium", timeStyle: "short" });
}

const CHAT_PREVIEW_ABSOLUTE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Chat-preview timestamp formatter that mirrors how mainstream chat apps
 * surface fresh activity: messages from the last hour render as an absolute
 * `HH:mm` clock value (locale-aware via `toLocaleTimeString`), and anything
 * older falls back to `formatRelativeDate`. Future timestamps (clock skew,
 * device clocks behind the server) also fall through to the relative branch.
 */
export function formatChatPreviewTimestamp(
  iso: string,
  locale: AppLanguage | string = "en",
): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs >= 0 && diffMs < CHAT_PREVIEW_ABSOLUTE_WINDOW_MS) {
    const bcp47 = getDefaultLocaleForLanguage(locale);
    return new Date(then).toLocaleTimeString(bcp47, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return formatRelativeDate(iso, locale);
}

const I18nContext = createContext<{
  language: AppLanguage;
  ready: boolean;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  formatRelativeDate: (iso: string) => string;
  formatChatPreviewTimestamp: (iso: string) => string;
  formatAbsoluteDate: (iso: string) => string;
  relativeDateLabel: (prefix: string, when: string) => string;
  languageOptions: { code: AppLanguage; label: string }[];
} | null>(null);

export function I18nProvider({ children }: React.PropsWithChildren) {
  const [language, setLanguageState] = useState<AppLanguage>("ru");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(LANGUAGE_KEY)
      .then(async (value) => {
        if (!active) {
          return;
        }
        if (!value || !languageOptions.some((option) => option.code === value)) {
          return;
        }
        const stored = value as AppLanguage;
        // The copy comes BEFORE `ready`, or the first paint is English under a
        // Polish setting and swaps a frame later. The tree is already gated on
        // `ready` for the storage read; for the two eager locales this adds
        // nothing, and for the other four it is one chunk.
        if (!isLocaleLoaded(stored) && (await loadLocale(stored)) === null) {
          // Unreachable copy: stay in the default rather than render a
          // language whose strings are not there.
          return;
        }
        if (active) setLanguageState(stored);
      })
      // A `.finally` HANDLES NOTHING. This chain ended at one, so a rejected
      // read left the rejection with no handler anywhere — an unhandled
      // rejection on every mount of a device whose store is broken, which is a
      // redbox in dev and a logged error nobody sees in production. Exactly the
      // shape `setLanguage` carried below until this week, on the other half of
      // the same key. `ready` still flips, because the default language is a
      // usable app and blocking the tree on a broken store is worse.
      .catch((error: unknown) => {
        reportStorageFailure("i18n-context.getItem", LANGUAGE_KEY, error);
      })
      .finally(() => {
        if (active) {
          setReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      language,
      ready,
      setLanguage: async (nextLanguage: AppLanguage) => {
        // The chunk first, and nothing happens if it does not arrive: a switch
        // that renders English under a Polish setting is worse than a switch
        // that visibly did not happen, and tapping again retries.
        if (!isLocaleLoaded(nextLanguage) && (await loadLocale(nextLanguage)) === null) {
          return;
        }
        if (nextLanguage !== language) {
          trackEvent("language_switched", {
            language: nextLanguage,
            previousLanguage: language,
          });
        }
        setLanguageState(nextLanguage);
        // NOT AWAITED BARE. The one caller is `void setLanguage(...)`, so a
        // rejected write here became an UNHANDLED REJECTION — a redbox in dev
        // and a silent drop in production, with the language applied to state
        // and never persisted. The user picks a language, sees it change, and
        // finds the old one back on the next launch with nothing anywhere
        // saying why. The in-memory change above already happened and stays.
        try {
          await AsyncStorage.setItem(LANGUAGE_KEY, nextLanguage);
        } catch (error: unknown) {
          reportStorageFailure("i18n-context.setItem", LANGUAGE_KEY, error);
        }
      },
      t: (key: TranslationKey, params?: TranslationParams) => {
        // `?? baseLocale` and not `translations[language]`: a language whose
        // chunk has not landed has no map at all, and indexing one that is
        // undefined is a crash on every string on the screen.
        const map = loadedLocale(language) ?? baseLocale;
        const entry = map[key] ?? baseLocale[key];
        return typeof entry === "function" ? entry(params) : entry;
      },
      formatRelativeDate: (iso: string) => formatRelativeDate(iso, language),
      formatChatPreviewTimestamp: (iso: string) => formatChatPreviewTimestamp(iso, language),
      formatAbsoluteDate: (iso: string) => formatAbsoluteDate(iso, language),
      relativeDateLabel,
      languageOptions,
    }),
    [language, ready],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}

/**
 * Variant of `useI18n` that returns `null` instead of throwing when invoked
 * outside the `I18nProvider`. Used by the crash fallback so it can localise
 * itself when the provider mounted, but not crash recursively if the boundary
 * fires before/around the provider tree.
 */
export function useOptionalI18n() {
  return useContext(I18nContext);
}
