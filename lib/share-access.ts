import { Collection } from "@/lib/types";

/**
 * Decide whether a visitor who opens a shared collection link should
 * be auto-registered in the collection's `sharedWithUserIds` list so
 * the collection appears in their "friend collections" later.
 *
 * Rules:
 *  - Skip when there is no signed-in user.
 *  - Skip when the visitor is the owner.
 *  - Skip when the collection is already public (discoverable anyway).
 *  - Skip when the visitor is already in sharedWithUserIds.
 *  - Otherwise: save, so the private link grants persistent access.
 */
export function shouldAutoSaveSharedCollection(
  collection: Collection | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!collection || !userId) return false;
  if (collection.ownerUserId === userId) return false;
  if (collection.visibility === "public") return false;
  const alreadyShared = (collection.sharedWithUserIds ?? []).includes(userId);
  if (alreadyShared) return false;
  return true;
}

/**
 * Merge a viewer userId into a collection's sharedWithUserIds array,
 * returning a new array. De-duplicates entries.
 */
export function addViewerToSharedIds(
  existing: readonly string[] | undefined,
  userId: string,
): string[] {
  const list = existing ?? [];
  if (list.includes(userId)) return [...list];
  return [...list, userId];
}

/**
 * Remove a viewer userId from a collection's sharedWithUserIds array,
 * returning a new array.
 */
export function removeViewerFromSharedIds(
  existing: readonly string[] | undefined,
  userId: string,
): string[] {
  const list = existing ?? [];
  return list.filter((id) => id !== userId);
}
