/**
 * Pure helpers for the marketplace `transferItemToBuyer` flow. Extracted
 * so node tests can exercise the build / dedupe / cover-photo invariants
 * without needing to mount React, AsyncStorage, or the Supabase client.
 *
 * The React context (`lib/collections-context.tsx`) calls `planTransferItem`
 * to compute the next item, the (optional) new Acquired collection, and an
 * idempotency signal, then writes the result back to its own state.
 */

import { userScopedCollectionId } from "@/lib/collections-helpers";
import {
  type MarketplaceTransferLogEntry,
  transferLogEntryId,
} from "@/lib/marketplace-transfer-log";
import type {
  AcquiredItemSnapshot,
  AcquiredCollectionOptions,
  TransferSource,
} from "@/lib/transfer-item-types";
import type { CollectableItem, Collection } from "@/lib/types";

export const ACQUIRED_COLLECTION_ID_SUFFIX = "acquired-marketplace";

/**
 * Slugify an item title for the acquired-item id. Mirrors the in-line slug
 * the context used to compute by hand. Empty / unsupported titles fall back
 * to a stable `"acquired"` slug so the id template never produces `acq--…`.
 */
export function acquiredItemSlug(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "acquired";
}

/**
 * Compose the acquired-item id. When `source` is supplied, the id is
 * derived from `transferLogEntryId(source)` so a retried claim of the same
 * listing produces the *same* item id — which `planTransferItem` exploits
 * to dedupe re-claims without scanning every field.
 *
 * Without a source, the id falls back to a per-call timestamp; the caller
 * pre-computes the timestamp (`now`) so test runs are deterministic.
 */
export function acquiredItemId(
  snapshot: AcquiredItemSnapshot,
  source: TransferSource | undefined,
  nowMs: number,
): string {
  const slug = acquiredItemSlug(snapshot.title);
  if (source) {
    return `acq-${slug}-${transferLogEntryId(source.listingId, source.listingCreatedAt)}`;
  }
  return `acq-${slug}-${nowMs}`;
}

export type TransferItemInput = {
  snapshot: AcquiredItemSnapshot;
  options?: AcquiredCollectionOptions;
  ownerUserId: string;
  ownerName: string;
  existingCollection: Collection | undefined;
  existingItems: CollectableItem[];
  now: Date;
};

export type TransferItemPlan = {
  collectionId: string;
  /** Set when the Acquired collection does not yet exist for this user. */
  newCollection: Collection | null;
  /**
   * The acquired item to upsert. When `isDuplicate === true` the caller
   * should treat this as a no-op — the field still carries the *existing*
   * item so callers wishing to return its id stay symmetric.
   */
  item: CollectableItem;
  /**
   * `true` when an item with the same id (derived from `source`) was
   * already present in `existingItems`. Idempotency guard for retried
   * claims of the same source listing.
   */
  isDuplicate: boolean;
  /**
   * The audit-log entry to persist. `null` when no `source` was supplied.
   */
  logEntry: MarketplaceTransferLogEntry | null;
};

/**
 * Pure computation of what `transferItemToBuyer` should write. Performs no
 * I/O and mutates no state — the caller (React context) is responsible for
 * forwarding the plan into its `setLocalCollections` / `setLocalItems`
 * setters and the remote upsert / log-append helpers.
 *
 * Invariants asserted by the paired unit test:
 *   (a) idempotent re-claims of the same `source` return `isDuplicate: true`
 *       and reuse the existing item (no duplicate-item creation).
 *   (b) `newCollection.coverPhoto` is the snapshot's first photo on the
 *       *first* transfer (when no Acquired collection exists yet).
 *   (c) the item carries the snapshot's `condition` and `tags` verbatim.
 */
export function planTransferItem(input: TransferItemInput): TransferItemPlan {
  const {
    snapshot,
    options,
    ownerUserId,
    ownerName,
    existingCollection,
    existingItems,
    now,
  } = input;
  const collectionId = userScopedCollectionId(ownerUserId, ACQUIRED_COLLECTION_ID_SUFFIX);

  const newCollection: Collection | null = existingCollection
    ? null
    : {
        id: collectionId,
        name: options?.collectionName ?? "Acquired",
        description: options?.collectionDescription ?? "",
        coverPhoto: snapshot.photos[0] ?? "",
        ownerName,
        ownerUserId,
        sharedWith: [],
        sharedWithUserIds: [],
        role: "owner",
        visibility: "private",
      };

  const itemId = acquiredItemId(snapshot, options?.source, now.getTime());
  const duplicate = existingItems.find((i) => i.id === itemId);
  if (duplicate) {
    return {
      collectionId,
      newCollection,
      item: duplicate,
      isDuplicate: true,
      logEntry: null,
    };
  }

  const acquiredAt = now.toISOString().slice(0, 10);
  const item: CollectableItem = {
    id: itemId,
    collectionId,
    title: snapshot.title.trim() || "Acquired item",
    acquiredAt,
    acquiredFrom: snapshot.acquiredFrom?.trim() ?? "",
    description: snapshot.description?.trim() ?? "",
    variants: snapshot.variants?.trim() ?? "",
    photos: snapshot.photos,
    createdBy: ownerName,
    createdByUserId: ownerUserId,
    createdAt: now.toISOString(),
    cost: typeof snapshot.cost === "number" ? snapshot.cost : null,
    isWishlist: false,
    condition: snapshot.condition,
    tags: snapshot.tags,
  };

  const logEntry: MarketplaceTransferLogEntry | null = options?.source
    ? {
        id: transferLogEntryId(options.source.listingId, options.source.listingCreatedAt),
        listingId: options.source.listingId,
        listingCreatedAt: options.source.listingCreatedAt,
        sellerUserId: options.source.sellerUserId,
        itemId: item.id,
        collectionId,
        title: item.title,
        photo: item.photos[0] ?? null,
        mode: options.source.mode,
        price: options.source.price,
        currency: options.source.currency,
        acquiredFrom: item.acquiredFrom,
        acquiredAt: item.createdAt,
      }
    : null;

  return {
    collectionId,
    newCollection,
    item,
    isDuplicate: false,
    logEntry,
  };
}
