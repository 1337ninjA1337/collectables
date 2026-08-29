import type { Collection, CollectableItem } from "@/lib/types";

/**
 * Structural equality, deep enough for a row and no deeper.
 *
 * The merges below return the LOCAL array by reference when the cloud rows
 * changed nothing, which is the no-op contract `applyTombstones`,
 * `mergeTombstoneIds`, `dedupeItems` and the pending-write helpers all state in
 * their own doc blocks — these two were the outliers, and they sit on the path
 * every delta pull walks. Without it a pull that returns a row byte-identical to
 * the one already held still built a fresh array, so `setLocalItems` saw a new
 * reference, React re-rendered every collection screen and the persist effect
 * rewrote BOTH AsyncStorage blobs. That is not a rare shape: the delta window is
 * `updated_at=gt` over a timestamp, so the boundary row comes back on the next
 * pull by construction.
 *
 * `===` alone cannot decide it. A re-fetched row is freshly parsed JSON, so
 * `photos` and `tags` are new arrays holding equal values and every item would
 * read as changed. Arrays compare element-wise and plain objects key-wise —
 * which is exactly the shape of `tags` (`{label, color}[]`) and the depth a row
 * actually has. Anything else falls through to `===`, so a value this does not
 * understand reads as CHANGED and the caller allocates: the wrong answer in the
 * safe direction.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => sameValue(entry, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** True when `merged` says nothing `existing` did not already say. */
function unchanged<T extends object>(existing: T, merged: T): boolean {
  return sameValue(existing, merged);
}

/**
 * Merges a cloud-fetched list into a local list, deduping by `id`. Cloud
 * entries replace local entries with the same ID (cloud wins on conflict).
 * Local-only entries are preserved so an offline write that hasn't synced
 * yet doesn't disappear when we re-pull from cloud.
 *
 * Owner role: when a local collection had `role: "owner"`, that's preserved
 * over a cloud row that comes back with `role: "viewer"` (the cloud `toCollection`
 * hardcodes viewer for safety on shared/public reads).
 *
 * Returns `local` by reference when the cloud rows changed nothing — see
 * {@link sameValue} for why that matters and why `===` cannot decide it.
 */
export function mergeCollectionsFromCloud(
  local: readonly Collection[],
  cloud: readonly Collection[],
  ownerUserId: string,
): Collection[] {
  const byId = new Map<string, Collection>();
  for (const c of local) byId.set(c.id, c);
  let changed = false;
  for (const c of cloud) {
    const existing = byId.get(c.id);
    const promoted: Collection =
      c.ownerUserId === ownerUserId
        ? { ...c, role: "owner" }
        : c;
    if (!existing) {
      changed = true;
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
      if (!unchanged(existing, merged)) {
        changed = true;
        byId.set(c.id, merged);
      }
    }
  }
  return changed ? Array.from(byId.values()) : (local as Collection[]);
}

/**
 * Merges a cloud-fetched item list into a local item list, deduping by `id`.
 * Cloud rows replace local rows with the same ID (cloud wins on conflict);
 * local-only items are preserved.
 *
 * Returns `local` by reference when the cloud rows changed nothing — see
 * {@link sameValue}.
 */
export function mergeItemsFromCloud(
  local: readonly CollectableItem[],
  cloud: readonly CollectableItem[],
): CollectableItem[] {
  const byId = new Map<string, CollectableItem>();
  for (const item of local) byId.set(item.id, item);
  let changed = false;
  for (const item of cloud) {
    const existing = byId.get(item.id);
    if (!existing) {
      changed = true;
      byId.set(item.id, item);
      continue;
    }
    const merged: CollectableItem = { ...existing, ...item };
    if (!unchanged(existing, merged)) {
      changed = true;
      byId.set(item.id, merged);
    }
  }
  return changed ? Array.from(byId.values()) : (local as CollectableItem[]);
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
