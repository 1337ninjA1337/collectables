import AsyncStorage from "@react-native-async-storage/async-storage";

import { reportStorageFailure } from "@/lib/report-storage-failure";
import { marketplaceTransferLogKey } from "@/lib/storage-keys";
import type { MarketplaceMode } from "@/lib/types";

/**
 * A single buyer-side record of a marketplace acquisition. Persisted to
 * AsyncStorage so the buyer keeps provenance even after the seller deletes
 * the original `MarketplaceListing` row upstream.
 *
 * The `id` shape is `${listingId}-${createdAt}` — see `transferLogEntryId`.
 */
export type MarketplaceTransferLogEntry = {
  id: string;
  listingId: string;
  listingCreatedAt: string;
  sellerUserId: string;
  itemId: string;
  collectionId: string;
  title: string;
  photo: string | null;
  mode: MarketplaceMode;
  price: number | null;
  currency: string;
  acquiredFrom: string;
  acquiredAt: string;
};

/**
 * Composes the stable id used to dedupe transfer log entries. Two claims of
 * the same listing (e.g. retried after a transient failure) collapse into a
 * single log row because `listingId` + `createdAt` together identify the
 * exact source listing instance.
 */
export function transferLogEntryId(listingId: string, listingCreatedAt: string): string {
  return `${listingId}-${listingCreatedAt}`;
}

/**
 * Pure dedup-and-prepend merge. Extracted so node tests can exercise the
 * idempotency invariant without needing to mock AsyncStorage.
 */
export function mergeTransferLogEntry(
  existing: MarketplaceTransferLogEntry[],
  entry: MarketplaceTransferLogEntry,
): MarketplaceTransferLogEntry[] {
  const filtered = existing.filter((e) => e.id !== entry.id);
  return [entry, ...filtered];
}

export function isTransferLogEntry(v: unknown): v is MarketplaceTransferLogEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.listingId === "string" &&
    typeof o.listingCreatedAt === "string" &&
    typeof o.sellerUserId === "string" &&
    typeof o.itemId === "string" &&
    typeof o.collectionId === "string" &&
    typeof o.title === "string" &&
    (o.photo === null || typeof o.photo === "string") &&
    (o.mode === "trade" || o.mode === "sell") &&
    (o.price === null || typeof o.price === "number") &&
    typeof o.currency === "string" &&
    typeof o.acquiredFrom === "string" &&
    typeof o.acquiredAt === "string"
  );
}

/**
 * The buyer's stored provenance log, or NULL when the store could not be read.
 *
 * The null is the same distinction `getTombstones` draws, for the same reason
 * and with a worse consequence if it is collapsed. Every caller merges into
 * what it read and writes the union back, so `[]` for a FAILED READ replaces
 * the log with whatever this one call happened to see — permanently, because
 * that write succeeds. Here that is the buyer's whole acquisition history,
 * deleted by one transient storage error, in the one store this app keeps that
 * nothing upstream can rebuild: the seller's `MarketplaceListing` row is gone
 * by then, which is why the log exists.
 *
 * `[]` means the store ANSWERED and holds no log for this user: no user id, no
 * stored value, or content that is not a transfer log. Nothing is stuck in any
 * of those, and re-learning from an empty list is right.
 */
export async function loadTransferLog(
  userId: string,
): Promise<MarketplaceTransferLogEntry[] | null> {
  if (!userId) return [];
  const key = marketplaceTransferLogKey(userId);
  // TWO ARMS, because one cannot say which failed. A single `try` around the
  // read AND the parse makes stored garbage indistinguishable from a broken
  // store, which is the distinction this whole function is now about — and it
  // is the collapse the first draft of this change shipped for one test run.
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (error: unknown) {
    // Reported for the reason the write below is: this is an AUDIT history, and
    // a device that cannot read it is one where every later claim appends to
    // nothing. The caller holds its write rather than overwriting, so the
    // symptom is a log that stops growing — invisible from the outside.
    reportStorageFailure("marketplace-transfer-log.getItem", key, error);
    return null;
  }
  if (!raw) return [];
  try {
    // NOT reported: the store ANSWERED and what it held is not a log, so there
    // is nothing to preserve and appending to `[]` is the honest recovery.
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTransferLogEntry) : [];
  } catch {
    return [];
  }
}

/**
 * Appends a transfer log entry, deduping by `id`. Newest entries go to the
 * front of the array so a future "Purchases" tab can render them in
 * recency order without re-sorting.
 *
 * Answers null when the log could not be READ, having written nothing: the
 * merge would be into an empty list, and persisting that is how a transient
 * storage error becomes a deleted audit history. See {@link loadTransferLog}.
 */
export async function appendTransferLogEntry(
  userId: string,
  entry: MarketplaceTransferLogEntry,
): Promise<MarketplaceTransferLogEntry[] | null> {
  if (!userId) return [];
  const existing = await loadTransferLog(userId);
  if (existing === null) return null;
  const next = mergeTransferLogEntry(existing, entry);
  const key = marketplaceTransferLogKey(userId);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(next));
  } catch (error: unknown) {
    // Storage failure is non-fatal — the log is an audit-history nicety,
    // not part of the claim's critical path. It is also an AUDIT history, so
    // a gap in it that nothing recorded is the one kind of gap that matters.
    reportStorageFailure("marketplace-transfer-log.setItem", key, error);
  }
  return next;
}
