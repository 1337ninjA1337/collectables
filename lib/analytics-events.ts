import type { AnalyticsEventName } from "@/lib/analytics";

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
  },
  collection_created: {
    description:
      "Fired after a successful save in `app/create-collection.tsx`. Lets us track public-vs-private adoption and whether premium users behave differently; `hasCover` flags whether a cover photo was uploaded at create time.",
    props: ["visibility", "isPremium", "hasCover"],
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
      "Fired from `app/item/[id].tsx` after a marketplace listing is published. `mode` = sale/trade/swap; `hasPrice` flags whether the listing carries a numeric price.",
    props: ["mode", "hasPrice"],
  },
  listing_claimed: {
    description:
      "Fired from `app/listing/[id].tsx` after the buy/trade flow completes. `sellerWasFriend` measures the social-graph contribution to marketplace velocity.",
    props: ["mode", "sellerWasFriend"],
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
  premium_activated: {
    description:
      "Fired from the premium false→true transition hook in `components/bottom-nav.tsx`. `source` carries which screen triggered the upgrade.",
    props: ["source"],
  },
  premium_upsell_shown: {
    description:
      "Fired when a free user hits a premium gate (e.g. taps the locked Private visibility chip). `feature` names the gated capability, `source` the screen. Zero events for a feature over a long window is the evidence needed to hide its locked affordance entirely.",
    props: ["feature", "source"],
  },
  language_switched: {
    description:
      "Fired from `lib/i18n-context.tsx:setLanguage()` whenever the user picks a new language. Used to size the i18n test surface per locale.",
    props: ["language", "previousLanguage"],
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
