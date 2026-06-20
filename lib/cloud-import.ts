import AsyncStorage from "@react-native-async-storage/async-storage";

import { cloudImportedKey } from "@/lib/storage-keys";
import type { CollectableItem, Collection } from "@/lib/types";

/**
 * BE-17 — one-time local→cloud import.
 *
 * The first time a user authenticates on a device, their locally-held owned
 * collections + items (created before sign-in, or before cloud sync existed)
 * must be pushed to Supabase once so the cloud gets a copy. This is gated by a
 * per-user `collectables-cloud-imported-v1` flag so the import runs exactly
 * once; the flag is only set after the import succeeds, so an offline/failed
 * attempt retries on the next authed load.
 *
 * The selection logic (`selectOwnedForImport`) is pure and node-testable; the
 * flag helpers are thin AsyncStorage wrappers keyed via `cloudImportedKey`.
 */

/**
 * Pick the user's *own* collections + their items for the one-time import.
 *
 * Collections: only those the user owns (`ownerUserId` matches and `role` is
 * `"owner"`) — viewer/shared collections belong to someone else and must never
 * be re-uploaded by a viewer. Items: those belonging to an owned collection, or
 * the user's own wishlist items (which may not live under a normal collection —
 * `upsertItem` lazily ensures a wishlist collection for them). Anything the user
 * merely views (items in a shared collection authored by another user) is left
 * out so an import never clobbers or duplicates a peer's data.
 */
export function selectOwnedForImport(
  collections: readonly Collection[],
  items: readonly CollectableItem[],
  userId: string,
): { collections: Collection[]; items: CollectableItem[] } {
  const owned = collections.filter(
    (c) => c.ownerUserId === userId && c.role === "owner",
  );
  const ownedIds = new Set(owned.map((c) => c.id));
  const ownedItems = items.filter(
    (i) =>
      ownedIds.has(i.collectionId) ||
      (i.isWishlist === true && i.createdByUserId === userId),
  );
  return { collections: owned, items: ownedItems };
}

/** True once the one-time import has already completed for this user. */
export async function hasCloudImported(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(cloudImportedKey(userId))) !== null;
  } catch {
    // A read failure just means we may re-attempt the (idempotent) import — the
    // upserts are `ON CONFLICT DO UPDATE`, so a duplicate run is harmless.
    return false;
  }
}

/** Record that the one-time import has completed for this user. */
export async function markCloudImported(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(cloudImportedKey(userId), new Date().toISOString());
  } catch {
    // Best-effort: a failed flag write just re-runs the idempotent import next
    // load — it never re-uploads stale data because the upserts are by id.
  }
}
