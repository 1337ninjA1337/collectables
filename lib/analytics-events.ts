import type { AnalyticsEventName } from "@/lib/analytics";

export type AnalyticsEventSpec = {
  /** Human-readable description used in the Power BI schema doc and any future event-catalogue export. */
  description: string;
  /** Allowed property keys for the event. The TS union of these is what consumers should pass to `trackEvent`. */
  props: readonly string[];
};

/**
 * The canonical event taxonomy. Used by the SDK wrapper (`lib/analytics.ts`)
 * and by the Power BI schema doc (`docs/powerbi-connection.md` once Analytics
 * #14 lands) so the runtime, the warehouse mirror (`analytics_events`), and
 * the BI report all agree on the same shape.
 */
export const ANALYTICS_EVENTS: Readonly<
  Record<AnalyticsEventName, AnalyticsEventSpec>
> = {
  signup_completed: {
    description: "Fired the first time a user finishes the OTP sign-up flow.",
    props: ["method"],
  },
  collection_created: {
    description: "Fired after a new collection is saved.",
    props: ["visibility", "isPremium"],
  },
  item_added: {
    description: "Fired when an item is added to a collection.",
    props: ["collectionId", "hasPhoto"],
  },
  item_photo_attached: {
    description: "Fired when an existing item gets its first photo attachment.",
    props: ["itemId"],
  },
  listing_created: {
    description: "Fired when an item is listed on the marketplace (sale or trade).",
    props: ["mode", "hasPrice"],
  },
  listing_claimed: {
    description: "Fired when a buyer/trader completes a marketplace claim.",
    props: ["mode", "sellerWasFriend"],
  },
  chat_opened: {
    description: "Fired when the chat thread mounts (debounced to avoid double-counts).",
    props: ["threadId"],
  },
  friend_requested: {
    description: "Fired when the user sends a new friend request.",
    props: ["targetUserId"],
  },
  premium_activated: {
    description: "Fired on the false→true transition of the user's premium flag.",
    props: ["source"],
  },
  language_switched: {
    description: "Fired when the user changes the UI language.",
    props: ["from", "to"],
  },
};

/**
 * Reverse lookup so the event name is also a valid string the SDK can emit.
 * Convenient in tests and BI-doc generators that need a list of names.
 */
export const ANALYTICS_EVENT_NAMES = Object.keys(
  ANALYTICS_EVENTS,
) as AnalyticsEventName[];
