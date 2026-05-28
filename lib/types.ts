export type ItemCondition = "new" | "excellent" | "good" | "fair";
export type CollectionRole = "owner" | "viewer";

export type ItemTag = {
  label: string;
  color: string;
};
export type ProfileRelationship = "self" | "friend" | "following" | "request_sent" | "request_received" | "none";

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  username: string;
  publicId: string;
  bio: string;
  avatar: string;
  isPremium?: boolean;
  /**
   * The user's app-wide display currency (ISO 4217), synced across devices via
   * the profiles row. NULL/undefined → fall back to the device-local
   * preference, then the language default. See bug-2c in collections-context.
   */
  displayCurrency?: string | null;
};

export type CollectableItem = {
  id: string;
  collectionId: string;
  title: string;
  acquiredAt: string;
  acquiredFrom: string;
  description: string;
  variants: string;
  photos: string[];
  createdBy: string;
  createdByUserId: string;
  createdAt: string;
  cost?: number | null;
  costCurrency?: string | null;
  sortOrder?: number;
  isWishlist?: boolean;
  condition?: ItemCondition;
  tags?: ItemTag[];
  /**
   * ISO timestamp set when the seller archives an item after a marketplace
   * sale (or other manual archive action). Archived items are excluded from
   * collection listings, totals, recent items, and search — but remain in
   * storage for stats and audit history. Nullable / undefined for legacy and
   * non-archived items, mirroring the optional-field shape of `isWishlist`.
   */
  archivedAt?: string | null;
};

export type ReactionEmoji = "heart" | "fire" | "eyes" | "star" | "clap";
export type ReactionTargetType = "collection" | "item";

export type Reaction = {
  id: string;
  userId: string;
  targetType: ReactionTargetType;
  targetId: string;
  emoji: ReactionEmoji;
  createdAt: string;
};

export type CollectionVisibility = "public" | "private";

export type ChatMessage = {
  id: string;
  chatId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  createdAt: string;
};

export type MarketplaceMode = "trade" | "sell";

export type MarketplaceListing = {
  id: string;
  itemId: string;
  ownerUserId: string;
  mode: MarketplaceMode;
  askingPrice: number | null;
  currency: string;
  notes: string;
  createdAt: string;
  soldAt: string | null;
  buyerUserId: string | null;
  arrivedAt: string | null;
};

export type Collection = {
  id: string;
  name: string;
  coverPhoto: string;
  description: string;
  ownerName: string;
  ownerUserId: string;
  sharedWith: string[];
  sharedWithUserIds: string[];
  role: CollectionRole;
  sortOrder?: number;
  visibility: CollectionVisibility;
  /**
   * ISO 4217 currency code (e.g. "USD") to display this collection's
   * aggregated totals in. When `null` / `undefined`, totals fall back to the
   * user's app-wide `displayCurrency`. Per-collection override so a user
   * with USD as their default can still view a "Vinyl, bought in Europe"
   * collection in EUR.
   */
  currency?: string | null;
  stopwords?: string[];
};
