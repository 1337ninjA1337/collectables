import type { Collection, CollectableItem } from "@/lib/types";

/**
 * Merges a cloud-fetched list into a local list, deduping by `id`. Cloud
 * entries replace local entries with the same ID (cloud wins on conflict).
 * Local-only entries are preserved so an offline write that hasn't synced
 * yet doesn't disappear when we re-pull from cloud.
 *
 * Owner role: when a local collection had `role: "owner"`, that's preserved
 * over a cloud row that comes back with `role: "viewer"` (the cloud `toCollection`
 * hardcodes viewer for safety on shared/public reads).
 */
export function mergeCollectionsFromCloud(
  local: readonly Collection[],
  cloud: readonly Collection[],
  ownerUserId: string,
): Collection[] {
  const byId = new Map<string, Collection>();
  for (const c of local) byId.set(c.id, c);
  for (const c of cloud) {
    const existing = byId.get(c.id);
    const promoted: Collection =
      c.ownerUserId === ownerUserId
        ? { ...c, role: "owner" }
        : c;
    if (!existing) {
      byId.set(c.id, promoted);
    } else {
      // Preserve local "owner" role when the cloud copy says "viewer" for the
      // same owner — the cloud read path defaults role for safety, but if we
      // already trusted ownership locally we shouldn't downgrade.
      const merged: Collection = {
        ...existing,
        ...promoted,
        role:
          existing.role === "owner" || promoted.role === "owner"
            ? "owner"
            : promoted.role,
      };
      byId.set(c.id, merged);
    }
  }
  return Array.from(byId.values());
}

/**
 * Merges a cloud-fetched item list into a local item list, deduping by `id`.
 * Cloud rows replace local rows with the same ID (cloud wins on conflict);
 * local-only items are preserved.
 */
export function mergeItemsFromCloud(
  local: readonly CollectableItem[],
  cloud: readonly CollectableItem[],
): CollectableItem[] {
  const byId = new Map<string, CollectableItem>();
  for (const item of local) byId.set(item.id, item);
  for (const item of cloud) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else {
      byId.set(item.id, { ...existing, ...item });
    }
  }
  return Array.from(byId.values());
}

/**
 * Returns true when the cloud merge produced *any* new collection or item
 * not already present in the local state. Used so the `setState` calls only
 * fire when there is real new data — avoiding an unnecessary AsyncStorage
 * write + downstream re-render storm.
 */
export function hasNewCloudEntries(
  localIds: ReadonlySet<string>,
  cloudIds: readonly string[],
): boolean {
  for (const id of cloudIds) {
    if (!localIds.has(id)) return true;
  }
  return false;
}
