/**
 * What a hydrate learned from one stored blob, and whether it is safe to write
 * anything back afterwards.
 *
 * ## The bug this exists to make unwriteable
 *
 * `CollectionsProvider` hydrated seven sources in one `Promise.all` — five
 * AsyncStorage reads and two Supabase fetches — under a single `try` whose
 * `catch` did this:
 *
 *     catch { setLocalCollections(seedCollections); setLocalItems(seedItems); }
 *     finally { setReady(true); }
 *
 * and `ready` is what enables the five `usePersistedBlob` effects. So ANY
 * rejection in that batch replaced the signed-in user's collections and items
 * with the DEMO SEED DATA and then persisted it over their real blobs —
 * permanently, because those writes succeed. The likeliest rejection was not
 * the store: `fetchFollowedCollectionIds` and `fetchWishlistItemsByUserId` are
 * network calls, so **an offline launch was enough**.
 *
 * ## The rule, stated once
 *
 * There is exactly one situation in which seed data is the right answer, and it
 * is an EMPTY key — the store answered and holds nothing for this user, which
 * is a fresh sign-in. Every other non-answer means the user's blob may still be
 * on disk and intact:
 *
 *   - UNREADABLE (the read threw) — the blob is untouched and unknown;
 *   - UNUSABLE (the store answered with something of the wrong shape) — the
 *     blob is corrupt, and overwriting it destroys any chance of recovering it.
 *
 * In both, the honest local state is EMPTY, and the honest thing to do about
 * persistence is nothing at all until a launch reads it successfully. That is
 * what {@link mayPersistHydration} is for: `ready` (the UI may render) and "it
 * is safe to write" are two different questions that were one boolean.
 *
 * Pure, and its own module, so the rule can be checked by being CALLED — the
 * provider pulls React Native peers, so anything left inline there can only be
 * asserted about its source text.
 */

/** One blob's outcome. `value` exists only when something was actually read. */
export type StoredBlob<V> =
  | { readonly status: "stored"; readonly value: V }
  | { readonly status: "empty" }
  | { readonly status: "unreadable" }
  | { readonly status: "unusable" };

/** The read threw. Written once so a caller cannot spell the status wrong. */
export const UNREADABLE_BLOB: StoredBlob<never> = { status: "unreadable" };

/**
 * `null`, `undefined` and `""` all mean the store holds nothing here — an empty
 * string is what a truncated write leaves behind, and it parses to nothing
 * either way.
 */
function parseStored(raw: string | null | undefined): StoredBlob<unknown> {
  if (raw === null || raw === undefined || raw === "") return { status: "empty" };
  try {
    return { status: "stored", value: JSON.parse(raw) };
  } catch {
    return { status: "unusable" };
  }
}

/**
 * Classify a stored JSON array, without ever throwing.
 *
 * Anything that parses to a non-array is UNUSABLE rather than empty, because a
 * value of the wrong shape in this key is still a blob written by something,
 * and the one thing that must not follow is a write over it.
 */
export function readStoredArray<T>(raw: string | null | undefined): StoredBlob<T[]> {
  const blob = parseStored(raw);
  if (blob.status !== "stored") return blob;
  return Array.isArray(blob.value) ? { status: "stored", value: blob.value as T[] } : { status: "unusable" };
}

/**
 * The same for a keyed store — the two offline queues, which are records rather
 * than arrays and would otherwise be UNUSABLE on every launch that has one.
 *
 * `null` is an object to `typeof` and is not a queue, so it is refused
 * explicitly; an array is refused too, because a queue that arrived as one is a
 * blob written by a different version of this app.
 */
export function readStoredRecord<V>(raw: string | null | undefined): StoredBlob<Record<string, V>> {
  const blob = parseStored(raw);
  if (blob.status !== "stored") return blob;
  const value = blob.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "unusable" };
  return { status: "stored", value: value as Record<string, V> };
}

/**
 * The rows to put on screen: what was stored, `whenEmpty` for a fresh account,
 * and NOTHING for a blob that could not be read or understood.
 *
 * The third case is the one worth reading twice. Handing back `whenEmpty` there
 * is how the seed collections reached a real user's screen and — because the
 * persist effects follow `ready` — their storage.
 */
export function blobRows<T>(blob: StoredBlob<T[]>, whenEmpty: readonly T[]): T[] {
  if (blob.status === "stored") return blob.value;
  if (blob.status === "empty") return [...whenEmpty];
  return [];
}

/** The same for a keyed store: what was stored, or an empty queue. */
export function blobRecord<V>(blob: StoredBlob<Record<string, V>>): Record<string, V> {
  return blob.status === "stored" ? blob.value : {};
}

/**
 * Whether a hydrate that saw these blobs may persist what it puts in state.
 *
 * False if ANY of them is unreadable or unusable, because the blobs share one
 * `enabled` flag and a hydrate that could not read the items blob has no
 * business rewriting the collections one either — they reference each other by
 * id, and a half-known pair written back is worse than neither.
 *
 * An empty list may persist: that is a caller which read nothing, which is a
 * caller with nothing to lose.
 */
export function mayPersistHydration(blobs: readonly StoredBlob<unknown>[]): boolean {
  return blobs.every((blob) => blob.status === "stored" || blob.status === "empty");
}
