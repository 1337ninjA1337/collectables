import AsyncStorage from "@react-native-async-storage/async-storage";

export const LANGUAGE_KEY = "collectables-language-v1";
export const SOCIAL_GRAPH_KEY = "collectables-social-graph-v1";
export const MARKETPLACE_KEY = "collectables-marketplace-v1";
export const DIAGNOSTICS_KEY = "collectables-diagnostics-v1";
/**
 * The currency figures are DISPLAYED in — collection totals, the stats screen,
 * every `<CostBadge>`. Written by `app/settings.tsx` through the provider's
 * `setDisplayCurrency`, and by the profile sync when a signed-in account
 * carries one.
 *
 * It used to be written by the cost FORMS as well, which is why
 * {@link ENTRY_CURRENCY_KEY} exists.
 */
export const CURRENCY_KEY = "collectables-currency-v1";
/**
 * The currency a cost form OPENS with — the last unit the user typed an amount
 * in, so somebody pricing a run of imports does not re-pick JPY on every row.
 *
 * One key did both jobs until 2026-09-12, and the collision was not
 * theoretical: noting a single want priced in yen re-denominated every
 * collection total on the home screen, because the form wrote the display
 * currency on its way past. Two facts that agree most of the time and are not
 * the same fact — what a number is quoted in, and what you want your net worth
 * shown in.
 *
 * There is no migration and there does not need to be one:
 * `getEntryCurrency` falls back to {@link CURRENCY_KEY} when this slot is
 * empty, so a returning user's forms open exactly where they did before and
 * the two only diverge once one is deliberately changed.
 */
export const ENTRY_CURRENCY_KEY = "collectables-entry-currency-v1";
export const PINNED_CURRENCIES_KEY = "collectables-pinned-currencies-v1";
export const CURRENCY_RATES_KEY = "collectables-currency-rates-v1";
/**
 * Sort mode per collection id, as one blob. Not user-scoped: collection ids
 * are uuids, so two accounts on one device cannot collide, and the value is a
 * view preference rather than anything a signed-out user should not see.
 */
export const ITEM_SORT_KEY = "collectables-item-sort-v1";

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
 * The entities that carry a per-user sync cursor AND a tombstone set.
 *
 * One list, and it is here because this is where the two key builders and the
 * account-deletion wipe are. It was the same four-member union declared twice
 * — `SyncEntity` in `lib/sync-cursors.ts` ("entities that carry an
 * `updated_at`/`moddatetime` trigger") and `TombstoneEntity` in
 * `lib/tombstones.ts` ("entities that carry a soft-delete `deleted_at`
 * column") — two sentences about two columns that have named the same four
 * tables since BE-15a, with nothing saying so. Both are aliases of this now,
 * so they cannot disagree about which tables sync.
 *
 * It is a runtime LIST and not only a type because `clearAllUserData` has to
 * iterate it. Before 2026-10-19 it wiped the cursor and tombstone keys for
 * `collections` and `items` by hand while the unions named four, so
 * `collectables-sync-cursor-v1-profiles-<id>` and the `friend_requests` pair
 * would have survived an account deletion the day anything wrote them.
 * Nothing does today — every call site passes `"collections"` or `"items"` —
 * which is what made it a latent gap rather than live residue, and exactly
 * the kind that lands the moment somebody adds a delta pull for profiles.
 */
export const SYNCED_ENTITIES = ["collections", "items", "profiles", "friend_requests"] as const;

/** One of {@link SYNCED_ENTITIES}. */
export type SyncedEntity = (typeof SYNCED_ENTITIES)[number];

/**
 * Per-entity, per-user delta-pull cursor (BE-14). Stores the highest
 * `updated_at` timestamp seen so far for a given entity so the next cloud pull
 * can ask for `updated_at=gt.<cursor>` instead of refetching the whole table.
 *
 * Takes a {@link SyncedEntity} rather than a `string`: the builder is what the
 * wipe enumerates, so a key it can produce for an entity the wipe has never
 * heard of is the defect this signature now refuses.
 */
export function syncCursorKey(entity: SyncedEntity, userId: string): string {
  return `collectables-sync-cursor-v1-${entity}-${userId}`;
}

/**
 * Per-entity, per-user soft-delete tombstone set (BE-15a). Stores the ids of
 * rows the cloud reported as `deleted_at != null` so the client can keep
 * dropping them locally even when a later full/seed load would otherwise
 * resurrect them — generalising the social-graph `deletedProfileIds` set.
 */
export function tombstoneKey(entity: SyncedEntity, userId: string): string {
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

/** A user id in a storage key, as every per-user builder above appends one. */
const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** What replaces the id, so a reader can see that one was there. */
export const STORAGE_KEY_ID_PLACEHOLDER = "{id}";

/**
 * A storage key with the user id taken out, for a crash report or a log line.
 *
 * Every per-user builder above ends `-${userId}`, and a Supabase auth id is
 * the account — sending one to Sentry attaches an identifier to a report that
 * did not need one, in a field `scrubPII` does not know to look at (it reads
 * event bodies, not the `extra` a caller assembles). The keyspace is what a
 * report is actually about: "the items blob stopped persisting" is the fact,
 * and WHOSE items blob is already on the event's user context if it is
 * anywhere.
 *
 * TWO PASSES, BECAUSE THE ID IS NOT ALWAYS A UUID. Replacing the uuid keeps
 * everything around it, which for `syncCursorKey` / `tombstoneKey` is the
 * ENTITY (`…-sync-cursor-v1-items-{id}`) — the part that says which pull
 * broke. A legacy or test id would not match that shape, and returning the key
 * unchanged there is exactly the case this exists to prevent, so anything
 * still carrying a `-v1-` suffix is truncated at the version instead: less
 * detail, and no way for an id to travel. Keys with no per-user half
 * (`collectables-language-v1`) match neither and come back as they are.
 */
export function storageKeyLabel(key: string): string {
  const withoutIds = key.replace(UUID, STORAGE_KEY_ID_PLACEHOLDER);
  if (withoutIds !== key) return withoutIds;
  const version = key.indexOf("-v1-");
  if (version < 0) return key;
  return `${key.slice(0, version + "-v1".length)}-${STORAGE_KEY_ID_PLACEHOLDER}`;
}

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

/**
 * Every key this device holds for one account, removed.
 *
 * The production account-deletion wipe — `lib/delete-account-flow.ts` runs it
 * after the Edge Function has deleted the auth user, and a failure here is
 * what `localDataRemains` reports: one `multiRemove`, all-or-nothing, so a
 * failure leaves EVERY key behind rather than some.
 *
 * The list is hand-written and `clear-all-user-data.test.ts` holds it to the
 * keys this module can actually produce, with an exemption list carrying a
 * reason per key that is deliberately kept. Before that case existed the
 * production wipe was a hand list and the dev-only wipe
 * ({@link clearAllCollectablesStorage}) was a `collectables-*` sweep, so a new
 * storage key joined the second automatically and the first only if somebody
 * remembered — which is how `ITEM_SORT_KEY` came to be missing from it.
 */
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
    // Every synced entity, not the two somebody wrote out: the unions have
    // named four since BE-15a and this list named two, so a cursor or a
    // tombstone set for `profiles` or `friend_requests` would have outlived
    // the account it belonged to.
    ...SYNCED_ENTITIES.map((entity) => syncCursorKey(entity, userId)),
    ...SYNCED_ENTITIES.map((entity) => tombstoneKey(entity, userId)),
    SOCIAL_GRAPH_KEY,
    LANGUAGE_KEY,
    MARKETPLACE_KEY,
    CURRENCY_KEY,
    // Both halves of the split, for the reason the display half was already
    // here: a currency is a fact about the person who picked it, and leaving
    // one behind means the next account on this device opens its first cost
    // form on a stranger's unit.
    ENTRY_CURRENCY_KEY,
    PINNED_CURRENCIES_KEY,
    CURRENCY_RATES_KEY,
    // Added 2026-10-19. Not user-scoped — its own comment argues that a sort
    // mode is a view preference rather than anything a signed-out user should
    // not see, which is true about VISIBILITY and says nothing about
    // deletion: the blob is keyed by the deleted account's collection ids, so
    // leaving it behind is residue of an account that no longer exists in a
    // map that would otherwise only ever grow.
    ITEM_SORT_KEY,
  ];
  await AsyncStorage.multiRemove(keys);
}
