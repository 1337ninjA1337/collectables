import type { AppLanguage } from "@/lib/i18n-context";
import type { CurrencyValueError } from "@/lib/format-currency-input";
import type { PremiumIntentSource } from "@/lib/premium-context";
import type { PremiumUpsellControl } from "@/lib/premium-helpers";
import type { AnalyticsRelationship } from "@/lib/social-helpers";
import type { CollectionVisibility, MarketplaceMode } from "@/lib/types";

/**
 * The closed sets of VALUES a small number of analytics props may carry.
 *
 * `ANALYTICS_EVENTS[name].props` has always constrained the payload's KEYS —
 * `assertValidProps` throws in dev and strips in production on a key the
 * taxonomy does not name. The values were free strings, and a typo in one is
 * the more expensive mistake of the two: an unknown key produces a column the
 * dashboard has never heard of and nobody builds a report on, while
 * `source: "collectionEdit"` produces a real column with a second bucket in
 * it, splitting a funnel that is then read as a number that looks too low.
 *
 * Only props with a genuinely finite, app-decided set live here. Ids
 * (`collectionId`, `targetUserId`), counts (`photoCount`) and values that
 * come from outside the app (`provider`, which is whatever Supabase reports)
 * are deliberately absent: a table that has to be exempted is a table that
 * stops being read. Booleans are absent for a different reason — `AnalyticsProps`
 * already types them, so a set of `[true, false]` would restate the compiler.
 *
 * Every set is bound to the type it mirrors rather than written out as a
 * loose array, so the two cannot drift in either direction: widening
 * `MarketplaceMode` without widening the table fails to compile, and so does
 * a table member the union does not have.
 */

/**
 * Builds a value set from a `Record<T, true>`, which is what makes the
 * binding exhaustive BOTH ways: a missing member is a missing property and an
 * extra member is an excess property. A plain `readonly T[]` would accept a
 * table that lists two of a union's five members, which is the drift this
 * module exists to prevent.
 *
 * Sorted, because the Power BI schema doc renders these and an insertion-order
 * list would rewrite the doc whenever somebody reordered a union.
 */
function closedSet<T extends string>(members: Record<T, true>): readonly T[] {
  return (Object.keys(members) as T[]).sort();
}

/** `collection_created.visibility`. */
export const VISIBILITY_VALUES = closedSet<CollectionVisibility>({
  public: true,
  private: true,
});

/** `listing_created` / `listing_dropped` / `listing_claimed` / `listing_view`. */
export const MARKETPLACE_MODE_VALUES = closedSet<MarketplaceMode>({
  trade: true,
  sell: true,
});

/**
 * `listing_price_invalid.reason` — the parser's own error union, so the reason
 * the funnel records and the inline error the user sees stay one decision
 * table (see `classifyInvalidPrice`, which delegates rather than re-deriving).
 */
export const INVALID_PRICE_REASON_VALUES = closedSet<CurrencyValueError>({
  empty: true,
  unparseable: true,
  non_positive: true,
});

/** `listing_claimed.sellerRelationship` / `listing_view.sellerRelationship`. */
export const SELLER_RELATIONSHIP_VALUES = closedSet<AnalyticsRelationship>({
  friend: true,
  following: true,
  stranger: true,
});

/** `friend_request_accepted.direction`. */
export const FRIEND_ACCEPT_DIRECTION_VALUES = closedSet<
  "accepted_by_me" | "accepted_by_them"
>({
  accepted_by_me: true,
  accepted_by_them: true,
});

/**
 * `signup_completed.method`.
 *
 * `manual_test` is not a typo and not dead: `simulateSignupEvent()` fires a
 * synthetic signup so a developer can verify the PostHog wire end-to-end
 * without forging an OTP flow. It runs in dev, which is exactly the runtime
 * where an undeclared value throws — so the honest move is to declare it here
 * (and to remember it when reading the funnel) rather than to exempt the call
 * site and leave the reader of a `method` breakdown wondering.
 */
export const SIGNUP_METHOD_VALUES = closedSet<"otp" | "oauth" | "manual_test">({
  otp: true,
  oauth: true,
  manual_test: true,
});

/**
 * `signup_completed.language`, `listing_price_invalid.language`,
 * `language_switched.language` / `.previousLanguage` — the six shipped
 * locales. Bound to `AppLanguage` through a type-only import, which is erased
 * at runtime: `lib/i18n-context.tsx` pulls react-native and cannot be LOADED
 * by a node CLI or by `tsx --test`, but its types cost nothing.
 */
export const APP_LANGUAGE_VALUES = closedSet<AppLanguage>({
  ru: true,
  en: true,
  be: true,
  pl: true,
  de: true,
  es: true,
});

/** `premium_activated.source` — where the upgrade was triggered from. */
export const PREMIUM_INTENT_SOURCE_VALUES = closedSet<PremiumIntentSource>({
  settings: true,
  create_collection: true,
  upsell_sheet: true,
  server_sync: true,
  unknown: true,
});

/**
 * `premium_upsell_shown.source` — the SCREEN that showed the gate, which is a
 * different question from `premium_activated.source` above even though the two
 * props share a name and one member. Kept separate because the sets are
 * per-event: merging them would let `premium_upsell_shown` claim a
 * `server_sync` source, which is not a thing a person can see.
 */
export const UPSELL_SOURCE_VALUES = closedSet<"create_collection" | "collection_edit">({
  create_collection: true,
  collection_edit: true,
});

/**
 * `premium_upsell_shown.feature` — one member today, and that is the point:
 * a second premium gate (the marketplace listing cap is the obvious next one)
 * has to be named here before it can report, which is a cheap moment to ask
 * whether it belongs in the same funnel.
 */
export const UPSELL_FEATURE_VALUES = closedSet<"private_collection">({
  private_collection: true,
});

/** `premium_upsell_shown.control` — the padlocked chip, or the sentence. */
export const UPSELL_CONTROL_VALUES = closedSet<PremiumUpsellControl>({
  chip: true,
  hint: true,
});
