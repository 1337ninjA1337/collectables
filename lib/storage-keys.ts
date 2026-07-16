import AsyncStorage from "@react-native-async-storage/async-storage";

export const LANGUAGE_KEY = "collectables-language-v1";
export const SOCIAL_GRAPH_KEY = "collectables-social-graph-v1";
export const MARKETPLACE_KEY = "collectables-marketplace-v1";
export const DIAGNOSTICS_KEY = "collectables-diagnostics-v1";
export const CURRENCY_KEY = "collectables-currency-v1";
export const PINNED_CURRENCIES_KEY = "collectables-pinned-currencies-v1";
export const CURRENCY_RATES_KEY = "collectables-currency-rates-v1";

export function collectionsKey(userId: string): string {
  return `collectables-collections-v1-${userId}`;
}

export function itemsKey(userId: string): string {
  return `collectables-items-v1-${userId}`;
}

export function followedCollectionsKey(userId: string): string {
  return `collectables-followed-collections-v1-${userId}`;
}

export function pendingCollectionsKey(userId: string): string {
  return `collectables-pending-collections-v1-${userId}`;
}

export function pendingItemsKey(userId: string): string {
  return `collectables-pending-items-v1-${userId}`;
}

export function pendingSocialKey(userId: string): string {
  return `collectables-pending-social-v1-${userId}`;
}

/**
 * One-time local→cloud import flag (BE-17). Set the first time a user's locally
 * held owned collections/items have been pushed to Supabase, so the import runs
 * exactly once per user/device instead of on every authed load.
 */
export function cloudImportedKey(userId: string): string {
  return `collectables-cloud-imported-v1-${userId}`;
}

export function chatCacheKey(userId: string): string {
  return `collectables-chats-v1-${userId}`;
}

export function socialCacheKey(userId: string): string {
  return `collectables-social-v1-${userId}`;
}

export function premiumKey(userId: string): string {
  return `collectables-premium-v1-${userId}`;
}

export function marketplaceTransferLogKey(userId: string): string {
  return `collectables-marketplace-transfer-log-v1-${userId}`;
}

/**
 * Per-entity, per-user delta-pull cursor (BE-14). Stores the highest
 * `updated_at` timestamp seen so far for a given entity so the next cloud pull
 * can ask for `updated_at=gt.<cursor>` instead of refetching the whole table.
 */
export function syncCursorKey(entity: string, userId: string): string {
  return `collectables-sync-cursor-v1-${entity}-${userId}`;
}

/**
 * Per-entity, per-user soft-delete tombstone set (BE-15a). Stores the ids of
 * rows the cloud reported as `deleted_at != null` so the client can keep
 * dropping them locally even when a later full/seed load would otherwise
 * resurrect them — generalising the social-graph `deletedProfileIds` set.
 */
export function tombstoneKey(entity: string, userId: string): string {
  return `collectables-tombstones-v1-${entity}-${userId}`;
}

export async function migrateStorageKey(oldKey: string, newKey: string): Promise<void> {
  try {
    const value = await AsyncStorage.getItem(oldKey);
    if (value === null) return;
    await AsyncStorage.setItem(newKey, value);
    await AsyncStorage.removeItem(oldKey);
  } catch {
    // Best-effort: migration failure must not crash context boot.
  }
}

export const COLLECTABLES_STORAGE_PREFIX = "collectables-";

/**
 * Returns every AsyncStorage key currently owned by the app (anything matching
 * `collectables-*`). Exposed so a dev-only escape hatch can wipe onboarding
 * state without enumerating every keyspace by hand.
 */
export async function getAllCollectablesKeys(): Promise<string[]> {
  const all = await AsyncStorage.getAllKeys();
  return all.filter((k) => k.startsWith(COLLECTABLES_STORAGE_PREFIX));
}

/**
 * Wipes every AsyncStorage key matching `collectables-*`. Intended as a
 * dev-only reset (exposed via `__resetCollectablesStorage` and the DevMenu);
 * production code paths should use the per-user reset helper instead.
 */
export async function clearAllCollectablesStorage(): Promise<void> {
  const keys = await getAllCollectablesKeys();
  if (keys.length === 0) return;
  await AsyncStorage.multiRemove(keys);
}

export async function clearAllUserData(userId: string): Promise<void> {
  const keys = [
    collectionsKey(userId),
    itemsKey(userId),
    followedCollectionsKey(userId),
    pendingCollectionsKey(userId),
    pendingItemsKey(userId),
    pendingSocialKey(userId),
    cloudImportedKey(userId),
    chatCacheKey(userId),
    socialCacheKey(userId),
    premiumKey(userId),
    marketplaceTransferLogKey(userId),
    syncCursorKey("collections", userId),
    syncCursorKey("items", userId),
    tombstoneKey("collections", userId),
    tombstoneKey("items", userId),
    SOCIAL_GRAPH_KEY,
    LANGUAGE_KEY,
    MARKETPLACE_KEY,
    CURRENCY_KEY,
    PINNED_CURRENCIES_KEY,
    CURRENCY_RATES_KEY,
  ];
  await AsyncStorage.multiRemove(keys);
}
