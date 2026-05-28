/**
 * Plain-data shapes shared between `lib/collections-context.tsx` and the
 * pure `lib/transfer-item-helpers.ts` planner. Extracted to break the
 * implicit React import cycle that would otherwise pull `useAuth` /
 * `useI18n` through the helpers module.
 */

import type { ItemCondition, ItemTag, MarketplaceMode } from "@/lib/types";

export type AcquiredItemSnapshot = {
  title: string;
  photos: string[];
  description?: string;
  variants?: string;
  cost?: number | null;
  acquiredFrom?: string;
  condition?: ItemCondition;
  tags?: ItemTag[];
};

export type TransferSource = {
  listingId: string;
  listingCreatedAt: string;
  sellerUserId: string;
  mode: MarketplaceMode;
  price: number | null;
  currency: string;
};

export type AcquiredCollectionOptions = {
  collectionName?: string;
  collectionDescription?: string;
  /**
   * Optional source-listing metadata. When provided, the transfer is
   * persisted to a buyer-local audit log keyed by `${listingId}-${createdAt}`
   * so provenance survives an upstream listing deletion.
   */
  source?: TransferSource;
};
