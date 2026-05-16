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
  stopwords?: string[];
};
