import type { CollectableItem } from "@/lib/types";
import { generateUuidV4, isUuidV4 } from "@/lib/uuid";

/**
 * BE-5: items must be server-keyed by a real uuid so they match the
 * `items.id uuid DEFAULT gen_random_uuid()` column. New items are now minted
 * with `generateUuidV4()` (mirroring `addCollection`), but items created before
 * that fix were cached locally with the legacy `slug-<ts>` / `wish-<slug>-<ts>`
 * id scheme — the same non-uuid class that broke chat (`msg-<ts>-<rand>`) and
 * was fixed in `20260516_chat_id_integrity.sql`. Postgres rejects those ids on
 * the cloud POST, so the items can never reconcile to the server.
 *
 * This rewrites every legacy (non-uuid) id on the user's OWN items to a fresh
 * uuid so they reconcile going forward. Only items the active user created are
 * touched: a shared/social/seed item's id must keep matching its source row, so
 * rewriting it locally would orphan it from the cloud read.
 *
 * Returns the (possibly new) item array plus the list of items whose id changed
 * so the caller can re-upsert them to the cloud. The original array is returned
 * unchanged when nothing matched, so a no-op hydrate doesn't churn React state.
 */
export function normalizeOwnItemIds(
  items: CollectableItem[],
  ownerUserId: string,
  newId: () => string = generateUuidV4,
): { items: CollectableItem[]; rewritten: CollectableItem[] } {
  const rewritten: CollectableItem[] = [];
  const next = items.map((item) => {
    if (isUuidV4(item.id) || item.createdByUserId !== ownerUserId) {
      return item;
    }
    const updated = { ...item, id: newId() };
    rewritten.push(updated);
    return updated;
  });

  return rewritten.length > 0 ? { items: next, rewritten } : { items, rewritten };
}
