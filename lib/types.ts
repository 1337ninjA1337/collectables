export type CollectionRole = "owner" | "viewer";
export type ProfileRelationship = "self" | "friend" | "following" | "request_sent" | "request_received" | "none";

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  username: string;
  publicId: string;
  bio: string;
  avatar: string;
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
  sortOrder?: number;
  isWishlist?: boolean;
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
};
