import { MarketplaceListing, MarketplaceMode } from "@/lib/types";

/**
 * Pure helpers for the marketplace feature so they're testable without
 * pulling in React Native peers.
 */

export const FREE_LISTING_CAP = 1;

/**
 * Free-tier users may have at most one *active* listing at a time. Sold
 * listings (with a non-null `soldAt`) don't count against the cap.
 */
export function countActiveListingsForUser(
  listings: readonly MarketplaceListing[],
  userId: string,
): number {
  let count = 0;
  for (const l of listings) {
    if (l.ownerUserId === userId && !l.soldAt) count++;
  }
  return count;
}

export function canCreateAnotherListing(
  listings: readonly MarketplaceListing[],
  userId: string,
  isPremium: boolean,
): boolean {
  if (isPremium) return true;
  return countActiveListingsForUser(listings, userId) < FREE_LISTING_CAP;
}

export function findListingByItemId(
  listings: readonly MarketplaceListing[],
  itemId: string,
): MarketplaceListing | undefined {
  for (const l of listings) {
    if (l.itemId === itemId && !l.soldAt) return l;
  }
  return undefined;
}

/**
 * Insert-or-replace by id. Mirrors the AsyncStorage write pattern used
 * elsewhere in the app: the caller persists the returned array.
 */
export function upsertListing(
  listings: readonly MarketplaceListing[],
  next: MarketplaceListing,
): MarketplaceListing[] {
  const idx = listings.findIndex((l) => l.id === next.id);
  if (idx === -1) return [...listings, next];
  const out = listings.slice();
  out[idx] = next;
  return out;
}

export function removeListingById(
  listings: readonly MarketplaceListing[],
  id: string,
): MarketplaceListing[] {
  return listings.filter((l) => l.id !== id);
}

/**
 * Listings that should appear on the marketplace browse page: not sold,
 * sorted newest-first.
 */
export function activeListings(
  listings: readonly MarketplaceListing[],
): MarketplaceListing[] {
  return listings
    .filter((l) => !l.soldAt)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Listings owned by `userId`, including sold ones — used by "My listings".
 */
export function listingsForUser(
  listings: readonly MarketplaceListing[],
  userId: string,
): MarketplaceListing[] {
  return listings
    .filter((l) => l.ownerUserId === userId)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Common collectible edition/condition words that distinguish the same card
 * from a collector's perspective but vary so widely in listing titles that
 * including them in the Dice comparison drives similarity below the threshold.
 * Gated as a constant so unit tests can verify deterministic behaviour.
 */
export const COLLECTIBLE_STOPWORDS = new Set([
  "holo", "holographic", "foil", "prism", "reverse",
  "rare", "uncommon", "common", "ultra", "secret",
  "edition", "1st", "first", "second", "third", "limited", "special",
  "shadowless", "unlimited", "reprint",
  "psa", "bgs", "cgc", "graded", "mint", "nm", "lp", "mp", "hp", "dmg",
]);

/**
 * Lowercase + collapse whitespace + drop punctuation so titles like
 * "Pokémon — Charizard, holo!" and "pokemon charizard holo" compare equal.
 * Also strips common collectible stopwords so "Charizard Holo 1st Edition"
 * and "Charizard" converge to the same normalised form.
 */
export function normalizeTitle(title: string, stopwordsOverride?: string[]): string {
  const stopwords = stopwordsOverride
    ? new Set(stopwordsOverride.map((w) => w.toLowerCase()))
    : COLLECTIBLE_STOPWORDS;
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base
    .split(" ")
    .filter((w) => !stopwords.has(w))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dice-coefficient similarity over character bigrams. Returns a value in
 * [0, 1]; 1.0 means identical normalized titles, 0 means no shared bigrams.
 * Picked over Levenshtein because it's robust to word reorderings ("Holo
 * Charizard" vs "Charizard Holo") which are common in collectible listings.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  const bigramsA = bigrams(na);
  const bigramsB = bigrams(nb);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const [bg, countA] of bigramsA.entries()) {
    const countB = bigramsB.get(bg);
    if (countB) intersection += Math.min(countA, countB);
  }
  const total = sumValues(bigramsA) + sumValues(bigramsB);
  return (2 * intersection) / total;
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    out.set(bg, (out.get(bg) ?? 0) + 1);
  }
  return out;
}

function sumValues(m: Map<string, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

export type PriceHistoryEntry = {
  listingId: string;
  itemId: string;
  ownerUserId: string;
  price: number;
  currency: string;
  mode: MarketplaceMode;
  recordedAt: string;
  similarity: number;
};

export const PRICE_HISTORY_SIMILARITY_THRESHOLD = 0.9;

/**
 * Returns up to `limit` price points (newest first) from listings whose
 * normalized title is at least 90% similar to `referenceTitle`. Only
 * priced listings are considered — pure-trade listings without a price
 * have nothing useful to plot. The reference listing itself is excluded.
 *
 * `getTitleForItemId` resolves a listing's `itemId` back to a human title;
 * the caller threads in their items lookup so this helper stays pure.
 */
export function priceHistoryForTitle(
  referenceTitle: string,
  listings: readonly MarketplaceListing[],
  getTitleForItemId: (itemId: string) => string | null,
  options: { excludeListingId?: string; limit?: number } = {},
): PriceHistoryEntry[] {
  const { excludeListingId, limit = 10 } = options;
  const out: PriceHistoryEntry[] = [];
  for (const l of listings) {
    if (excludeListingId && l.id === excludeListingId) continue;
    if (l.askingPrice == null) continue;
    const title = getTitleForItemId(l.itemId);
    if (!title) continue;
    const sim = titleSimilarity(referenceTitle, title);
    if (sim < PRICE_HISTORY_SIMILARITY_THRESHOLD) continue;
    out.push({
      listingId: l.id,
      itemId: l.itemId,
      ownerUserId: l.ownerUserId,
      price: l.askingPrice,
      currency: l.currency,
      mode: l.mode,
      recordedAt: l.soldAt ?? l.createdAt,
      similarity: sim,
    });
  }
  out.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  return out.slice(0, limit);
}
