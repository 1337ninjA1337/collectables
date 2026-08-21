import type { AnalyticsEventName } from "@/lib/analytics";
import {
  APP_LANGUAGE_VALUES,
  FRIEND_ACCEPT_DIRECTION_VALUES,
  INVALID_PRICE_REASON_VALUES,
  MARKETPLACE_MODE_VALUES,
  PREMIUM_INTENT_SOURCE_VALUES,
  SELLER_RELATIONSHIP_VALUES,
  SIGNUP_METHOD_VALUES,
  UPSELL_CONTROL_VALUES,
  UPSELL_FEATURE_VALUES,
  UPSELL_SOURCE_VALUES,
  VISIBILITY_VALUES,
} from "@/lib/analytics-prop-values";

/**
 * Event taxonomy — single source of truth for the analytics events the app
 * captures. Used by:
 *
 *   - `lib/analytics.ts:trackEvent` for compile-time name validation (the
 *     `AnalyticsEventName` union must stay in lockstep with the keys here;
 *     `__tests__/analytics-events.test.ts` enforces parity).
 *   - the Power BI schema documentation (`docs/powerbi-connection.md`) so the
 *     report builder knows which event names + property keys to expect in the
 *     `analytics_events` table.
 *
 * Each entry carries:
 *   - `description` — human-readable summary surfaced in the Power BI schema
 *     and (optionally) in PostHog's event-definition metadata UI.
 *   - `props` — the allowed property keys for the event. Used by the schema
 *     doc and by future runtime-validation code that strips unknown keys
 *     before calling `trackEvent`. The list is non-empty for every event so
 *     analytics consumers always have something to slice by.
 */
export type AnalyticsEventDefinition = {
  readonly description: string;
  readonly props: readonly string[];
  /**
   * Optional closed sets of allowed VALUES, keyed by prop name. Absent means
   * the prop is unconstrained (ids, counts, anything sourced from outside the
   * app); a prop named here may only carry a listed value, enforced by
   * `assertValidProps` on the same dev-throws / production-warns policy the
   * key check uses. Every key must also appear in `props` — the two lists
   * disagreeing is checked in `__tests__/analytics-events.test.ts`, because a
   * `values` entry for a prop the event does not have is a rule that can
   * never fire.
   */
  readonly values?: Readonly<Record<string, readonly string[]>>;
};

// `as const satisfies` (instead of a wide `Record<...>` annotation) lifts
// every prop name into the type system: `ANALYTICS_EVENTS.collection_created
// .props[0]` is typed `"visibility"`, not `string`, so the future
// `validateEventProps(name, payload)` guard and per-event autocomplete get
// literal keys while the shape is still checked against
// `AnalyticsEventDefinition`. Runtime value is unchanged.
export const ANALYTICS_EVENTS = {
  signup_completed: {
    description:
      "Fired when a freshly-created user finishes the OTP/OAuth flow (detected by `created_at` within the last 5 minutes).",
    props: ["method", "provider", "language"],
    // `provider` is whatever Supabase reports and is deliberately open.
    values: { method: SIGNUP_METHOD_VALUES, language: APP_LANGUAGE_VALUES },
  },
  collection_created: {
    description:
      "Fired after a successful save in `app/create-collection.tsx`. Lets us track public-vs-private adoption and whether premium users behave differently; `hasCover` flags whether a cover photo was uploaded at create time.",
    props: ["visibility", "isPremium", "hasCover"],
    values: { visibility: VISIBILITY_VALUES },
  },
  item_added: {
    description:
      "Fired after a successful save in `app/create.tsx`. Slice by `collectionId` to find the most-active collections; `hasPhoto` measures the first-photo conversion funnel.",
    props: ["collectionId", "hasPhoto"],
  },
  item_photo_attached: {
    description:
      "Fired the first time an existing item gets a photo (post-create photo upload). Distinct from `item_added` so we can attribute photo conversions independently.",
    props: ["itemId", "collectionId"],
  },
  item_photos_replaced: {
    description:
      "Fired when an item that already had photos is saved with a different photo set (gallery rotation). Distinct from `item_photo_attached`, which only covers the first-photo edge — together they separate curation behaviour from photo onboarding.",
    props: ["itemId", "collectionId", "photoCount"],
  },
  listing_created: {
    description:
      "Fired from `app/item/[id].tsx` after a marketplace listing is published. `mode` is the `MarketplaceMode` the listing was created in; `hasPrice` flags whether the listing carries a numeric price. (This sentence used to read `mode` = sale/trade/swap — two of those three values have never existed; the rendered value set beside the key is now generated from the type rather than remembered.)",
    props: ["mode", "hasPrice"],
    values: { mode: MARKETPLACE_MODE_VALUES },
  },
  listing_dropped: {
    description:
      "Fired from `app/item/[id].tsx` when the listing sheet is dismissed with a dirty draft (the user filled in fields but never published). The abandon arm balancing `listing_created`; `hasPrice` flags whether a price had been typed at dismissal.",
    props: ["mode", "hasPrice"],
    values: { mode: MARKETPLACE_MODE_VALUES },
  },
  listing_price_invalid: {
    description:
      "Fired from `app/item/[id].tsx` when a sell-mode submit is rejected because the typed price fails `parseCurrencyValue`. `reason` classifies the failure (empty / unparseable / non_positive); `language` surfaces locales where comma-vs-dot decimal habits drive high invalid rates.",
    props: ["reason", "language"],
    values: { reason: INVALID_PRICE_REASON_VALUES, language: APP_LANGUAGE_VALUES },
  },
  listing_claimed: {
    description:
      "Fired from `app/listing/[id].tsx` after the buy/trade flow completes. `sellerWasFriend` measures the social-graph contribution to marketplace velocity; `sellerRelationship` is the finer friend/following/stranger bucket (`relationshipForAnalytics`) so reports can slice friend trades from stranger sales.",
    props: ["mode", "sellerWasFriend", "sellerRelationship"],
    values: {
      mode: MARKETPLACE_MODE_VALUES,
      sellerRelationship: SELLER_RELATIONSHIP_VALUES,
    },
  },
  listing_view: {
    description:
      "Fired from `app/listing/[id].tsx` after a dwell-time gate (`useDwellTimeEffect`) when a user views someone else's listing — pagination scroll-pasts and navigation flickers never count. The denominator for `listing_claimed`'s view-to-buy conversion; `sellerRelationship` slices conversion by social proximity, `isSold` separates browsing the active feed from viewing sold history.",
    props: ["mode", "sellerRelationship", "isSold"],
    values: {
      mode: MARKETPLACE_MODE_VALUES,
      sellerRelationship: SELLER_RELATIONSHIP_VALUES,
    },
  },
  chat_opened: {
    description:
      "Fired from `app/chat/[id].tsx` `useEffect`, debounced so navigating in/out doesn't double-count. `withFriend` distinguishes mutual-follow chats.",
    props: ["conversationId", "withFriend"],
  },
  friend_requested: {
    description:
      "Fired from the request-send action in `lib/social-context.tsx`. `targetUserId` lets us spot reciprocal-follow loops.",
    props: ["targetUserId"],
  },
  friend_request_accepted: {
    description:
      "Fired from the friendRequests diff effect in `lib/social-context.tsx` when a half handshake flips to a mutual friendship — the accepted arm of the `friend_requested` funnel. `direction` says which side completed it: `accepted_by_me` (this device tapped accept) or `accepted_by_them` (our outgoing request converted remotely).",
    props: ["targetUserId", "direction"],
    values: { direction: FRIEND_ACCEPT_DIRECTION_VALUES },
  },
  friend_request_cancelled: {
    description:
      "Fired from `removeFriend` in `lib/social-context.tsx` when a pending outgoing request is withdrawn before the counterpart accepted (`classifyRequestRemoval` = cancelled_request — declines and unfriends stay silent). The churn arm of the funnel: sent → accepted | cancelled.",
    props: ["targetUserId"],
  },
  premium_activated: {
    description:
      "Fired from the premium false→true transition hook in `components/bottom-nav.tsx`. `source` carries which screen triggered the upgrade via the one-shot `consumeLastPremiumIntent()` intent ref (`settings` / `create_collection` / `upsell_sheet` / `server_sync` for entitlements restored by the cloud validation merge / `unknown` for an untagged caller).",
    props: ["source"],
    values: { source: PREMIUM_INTENT_SOURCE_VALUES },
  },
  premium_upsell_shown: {
    description:
      "Fired when a free user hits a premium gate (e.g. taps the locked Private visibility chip). `feature` names the gated capability, `source` the screen, and `control` which affordance was pressed — `chip` for the padlocked chip, `hint` for the sentence beside it. Zero events for a feature over a long window is the evidence needed to hide its locked affordance entirely, and that decision is per-CONTROL: the two send the same feature and source, so without `control` a tap on the sentence reads as a tap on the chip.",
    props: ["feature", "source", "control"],
    // `source` here is the SCREEN, a different set from `premium_activated`'s
    // intent source above — same prop name, so the sets have to be per-event.
    values: {
      feature: UPSELL_FEATURE_VALUES,
      source: UPSELL_SOURCE_VALUES,
      control: UPSELL_CONTROL_VALUES,
    },
  },
  language_switched: {
    description:
      "Fired from `lib/i18n-context.tsx:setLanguage()` whenever the user picks a new language. Used to size the i18n test surface per locale.",
    props: ["language", "previousLanguage"],
    values: {
      language: APP_LANGUAGE_VALUES,
      previousLanguage: APP_LANGUAGE_VALUES,
    },
  },
} as const satisfies Record<AnalyticsEventName, AnalyticsEventDefinition>;

/**
 * Literal union of the allowed prop keys for one event, e.g.
 * `AnalyticsEventProps<"collection_created">` = `"visibility" | "isPremium"`.
 */
export type AnalyticsEventProps<N extends AnalyticsEventName> =
  (typeof ANALYTICS_EVENTS)[N]["props"][number];

/**
 * Sorted array of event names. Useful for the Power BI schema doc (predictable
 * ordering) and for tests that walk every event without depending on object
 * insertion order.
 */
export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] =
  Object.freeze(
    (Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[]).slice().sort(),
  );
