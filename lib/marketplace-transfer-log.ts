import AsyncStorage from "@react-native-async-storage/async-storage";

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

export async function loadTransferLog(
  userId: string,
): Promise<MarketplaceTransferLogEntry[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(marketplaceTransferLogKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTransferLogEntry);
  } catch {
    return [];
  }
}

/**
 * Appends a transfer log entry, deduping by `id`. Newest entries go to the
 * front of the array so a future "Purchases" tab can render them in
 * recency order without re-sorting.
 */
export async function appendTransferLogEntry(
  userId: string,
  entry: MarketplaceTransferLogEntry,
): Promise<MarketplaceTransferLogEntry[]> {
  if (!userId) return [];
  const existing = await loadTransferLog(userId);
  const next = mergeTransferLogEntry(existing, entry);
  try {
    await AsyncStorage.setItem(
      marketplaceTransferLogKey(userId),
      JSON.stringify(next),
    );
  } catch {
    // Storage failure is non-fatal — the log is an audit-history nicety,
    // not part of the claim's critical path.
  }
  return next;
}
