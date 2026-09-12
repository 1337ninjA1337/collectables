import { MarketplaceListing, MarketplaceMode } from "@/lib/types";
import { byCreatedAtDescThenId, compareIsoDesc, tieBreakById } from "@/lib/sort-helpers";

/**
 * Pure helpers for the marketplace feature so they're testable without
 * pulling in React Native peers.
 */

export const FREE_LISTING_CAP = 1;

/**
 * Newest sale first, falling back to `createdAt` for a listing whose `soldAt`
 * is missing — a legacy row, or one whose sale was recorded before the column
 * existed. Five surfaces sort this way (recently-sold, purchases, awaiting
 * arrival, sales, price history), so the fallback lives here rather than being
 * re-derived; a site that forgot it would sort those rows to one end as if
 * they were the oldest in the list.
 *
 * Ties break on `id` so the order is total: `recentlySoldListings` cuts a top-12
 * off this sort, and two sales closed in the same millisecond would otherwise
 * decide the twelfth slot by whatever order the last cloud delta returned them.
 */
const bySoldAtDesc = tieBreakById(
  (a: MarketplaceListing, b: MarketplaceListing) =>
    compareIsoDesc(a.soldAt ?? a.createdAt, b.soldAt ?? b.createdAt),
  (listing) => listing.id,
);

/**
 * Ensures every `MarketplaceListing` shape has the optional `buyerUserId`
 * field explicitly coalesced to `null`. Older AsyncStorage payloads (and
 * legacy cloud rows) may omit the field entirely; downstream code that
 * checks `listing.buyerUserId === userId` needs `null` rather than
 * `undefined` to match the typed contract.
 *
 * Lives here (not inside `MarketplaceContext`) so any future code path that
 * hydrates listings from JSON — push notifications, deep-link previews,
 * server-rendered routes — can reuse the same defensive-default logic.
 */
export function normalizeListing(raw: MarketplaceListing): MarketplaceListing {
  return {
    ...raw,
    buyerUserId: raw.buyerUserId ?? null,
    arrivedAt: raw.arrivedAt ?? null,
  };
}

/**
 * Validates an arbitrary value against the `MarketplaceListing` shape and
 * returns a normalized listing or `null` on any structural mismatch. Use to
 * harden any JSON-hydration path (AsyncStorage cache, push payload,
 * deep-link preview) against corrupt rows that would otherwise crash
 * downstream rendering when fields like `mode` come back undefined.
 */
export function coerceListing(raw: unknown): MarketplaceListing | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  if (typeof r.itemId !== "string" || r.itemId === "") return null;
  if (typeof r.ownerUserId !== "string" || r.ownerUserId === "") return null;
  if (r.mode !== "trade" && r.mode !== "sell") return null;
  if (r.askingPrice !== null && typeof r.askingPrice !== "number") return null;
  if (typeof r.currency !== "string") return null;
  if (typeof r.notes !== "string") return null;
  if (typeof r.createdAt !== "string") return null;
  if (r.soldAt !== null && typeof r.soldAt !== "string") return null;
  if (r.buyerUserId !== undefined && r.buyerUserId !== null && typeof r.buyerUserId !== "string") {
    return null;
  }
  if (r.arrivedAt !== undefined && r.arrivedAt !== null && typeof r.arrivedAt !== "string") {
    return null;
  }
  return normalizeListing({
    id: r.id,
    itemId: r.itemId,
    ownerUserId: r.ownerUserId,
    mode: r.mode,
    askingPrice: (r.askingPrice ?? null) as number | null,
    currency: r.currency,
    notes: r.notes,
    createdAt: r.createdAt,
    soldAt: (r.soldAt ?? null) as string | null,
    buyerUserId: (r.buyerUserId ?? null) as string | null,
    arrivedAt: (r.arrivedAt ?? null) as string | null,
  });
}

/**
 * Validate + filter a JSON-hydrated array of listings. Drops malformed
 * entries silently — the caller can compare lengths if they want to surface
 * "we dropped N corrupt rows" telemetry.
 */
export function coerceListings(raw: unknown): MarketplaceListing[] {
  if (!Array.isArray(raw)) return [];
  const out: MarketplaceListing[] = [];
  for (const entry of raw) {
    const coerced = coerceListing(entry);
    if (coerced) out.push(coerced);
  }
  return out;
}

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

/**
 * Detect whether a realtime UPDATE payload represents the *moment* a buyer
 * just claimed `userId`'s active listing. Returns `true` only when:
 *   - the existing local row was previously unsold (`soldAt === null`),
 *   - the incoming row is now sold (`soldAt !== null`) with a buyer set,
 *   - the listing is owned by `userId`,
 *   - and the buyer is someone other than `userId` (so the seller's own
 *     edge-case `markListingSold` from another tab can't fire the prompt).
 *
 * Lives next to {@link upsertListing} so the MarketplaceProvider's realtime
 * callback can reduce diff-detection to a single pure call and unit-test the
 * boundary conditions exhaustively.
 */
export function isListingClaimedFromOwner(
  existing: MarketplaceListing | undefined,
  incoming: MarketplaceListing,
  userId: string,
): boolean {
  if (!existing) return false;
  if (existing.soldAt !== null) return false;
  if (incoming.soldAt === null) return false;
  if (!incoming.buyerUserId) return false;
  if (incoming.ownerUserId !== userId) return false;
  if (incoming.buyerUserId === userId) return false;
  return true;
}

export function removeListingById(
  listings: readonly MarketplaceListing[],
  id: string,
): MarketplaceListing[] {
  return listings.filter((l) => l.id !== id);
}

/**
 * Is there a listing for this item, and is it still open?
 *
 * The question every "the item is going away" path has to ask before it lets
 * the item go. An open listing is a standing offer to strangers: it sits in
 * {@link activeListings} on every buyer's device, and nothing about archiving
 * or deleting the item on the seller's device reaches it. So an item could be
 * archived — its own screen saying, under a banner, that the owner no longer
 * has it — while still being offered for sale; and it could be DELETED, which
 * is worse, because the buyer who claims it then gets a row pointing at
 * nothing the seller can even open.
 *
 * **A sold listing is not open, and must survive both.** The sold-listing
 * prompt archives an item as the final step of a sale that already happened,
 * and the listing is that sale's record — the buyer's purchase list, the
 * transfer log and "recently sold" all read it. Removing it would delete the
 * history the archive exists to keep, which is the argument `archivedAt`
 * itself is built on; and a delete does not un-sell a thing that was sold.
 *
 * The same answer serves both callers, which is why this is named for the
 * LISTING's state rather than for one of the two acts. It shipped an hour
 * earlier as `shouldRetireListingOnArchive`, and the delete path is what made
 * the narrower name wrong: the two callers differ in what they do next (an
 * archive is reversible and a delete is not, so they warn differently), not in
 * what they need to know.
 *
 * `soldAt` and not `buyerUserId`: a listing can be claimed before the transfer
 * completes, and `soldAt` is the field {@link activeListings} filters the
 * browse feed on. Asking anything else here would let the two disagree about
 * what "still open" means.
 */
export function isOpenListing(
  listing: MarketplaceListing | undefined | null,
): boolean {
  if (!listing) return false;
  return !listing.soldAt;
}

/**
 * Every provider mutation that acts on an item, and whether it has to ask
 * {@link isOpenListing} first.
 *
 * Two bugs this week were the same bug: a path that touches an item and does
 * not ask the question the others ask. The archive round did not think about
 * listings; the round that fixed listings did not think about delete. Both
 * were found by writing a suggestion afterwards rather than by anything in the
 * tree, and the thing that catches that class is a list — because the failure
 * is always a path nobody remembered, and a rule stated only in the paths that
 * follow it cannot name the one that does not.
 *
 * `item-departure-paths.test.ts` reads this record against every provider
 * mutation that WRITES the item list, so a fifteenth is red until somebody
 * decides which kind it is. The reasons are here rather than there because
 * they are about the marketplace, and a reader asking "why does moving not
 * retire a listing?" arrives at this file.
 *
 * **The derivation is the load-bearing part, and its first version was wrong
 * in the way this record exists to catch.** It read mutations whose PARAMETER
 * was an item id, which is the shape of the paths that were already known, and
 * so it found eight and missed six — among them `deleteCollection`, which
 * removes a collection and every item in it and is the largest departure path
 * in the app. A sweep written to the shape of the known cases is the same
 * blind spot one level up. It asks "does this write `setLocalItems`?" now,
 * which is a question about what a mutation DOES.
 */
export const LISTING_RULE_BY_ITEM_PATH: Readonly<Record<string, string>> = {
  addItem:
    "EXEMPT — an arrival. A brand-new item has no listing by construction, and the add form offers no way to create one",
  addWishlistItem:
    "EXEMPT — an arrival, and a want rather than a holding: you cannot list a thing you do not own",
  archiveItem:
    "retires — an open listing outlives the archive otherwise and stays in activeListings for every buyer, under an item its owner has said they no longer have. The sold-listing prompt is the exception INSIDE this path: it archives as the last step of a sale that already happened, and the listing is that sale's record",
  archiveItems:
    "retires — the same act done to a selection, and the scale at which nobody would have noticed: thirty rows leave storage and thirty standing offers stay",
  deleteItem:
    "retires — the worse half. The item leaves storage entirely, so the buyer who claims the surviving listing gets a purchase pointing at nothing the seller can even open",
  deleteCollection:
    "retires — the largest departure path in the app, and the one the first version of this record could not see: it removes the collection AND every item in it, so deleting a collection of thirty left thirty standing offers pointing at items that no longer exist anywhere",
  deleteUserContent:
    "EXEMPT — an admin dropping another user's collections and items from THIS device. The listings belong to that user's account and are not the viewer's to withdraw; removing them here would be one device deciding what another person is selling",
  deleteItems:
    "retires — the bulk version of the above, and the one the confirm has to count, because a seller deleting thirty is told about the thirty and not the four listings",
  moveItems:
    "EXEMPT — a listing carries `itemId` and nothing about the collection, and `app/listing/[id].tsx` resolves its item with `getItemById(listing.itemId)` alone. Moving an item between collections is invisible to the marketplace, so retiring a listing here would withdraw a live offer for no reason. This is a decision and not an omission: four rounds carried it as an open question, and the answer is that the data shape makes it a non-event",
  unarchiveItem:
    "EXEMPT — the item is coming BACK, which is the one direction that cannot orphan an offer. Its listing was either retired on the way in or is sold, and re-creating one would put a thing up for sale that nobody asked to sell",
  reorderItemsInCollection:
    "EXEMPT — it writes `sortOrder` and nothing else. The item stays where it is and stays for sale; a listing has no notion of position",
  transferItemToBuyer:
    "EXEMPT — the only entry here that is an ARRIVAL on the buyer's device: it creates their copy of a thing they just bought. The seller's side of that sale is the sold-listing prompt, which archives and deliberately keeps the listing as the sale's record",
  updateItem:
    "EXEMPT — the item stays where it is and stays for sale; editing a title is not a departure. A listing shows the item's current title by design, which is the point of resolving it by id",
  promoteWishlistItem:
    "EXEMPT — a want becoming a holding is an arrival. It could not have had a listing: you cannot sell a thing you do not own, and the wishlist screen offers no way to list one",
};

/**
 * The open listings among `itemIds` — {@link isOpenListing} asked of a
 * selection instead of of one row.
 *
 * The single-item archive and the single-item delete both retire an open
 * listing before letting the item go. The BULK delete did not ask once: a
 * thirty-row selection took thirty items out of storage and left thirty
 * standing offers on every buyer's device, and the confirm said nothing about
 * it. That is the same bug at the scale where nobody would notice.
 *
 * Returns the listings rather than a count or a boolean, because both callers
 * need all three answers: how many to warn about, which ids to remove, and
 * whether to bother. A caller that only wants the number takes `.length`.
 *
 * Order follows `itemIds`, not the listing store, so the warning a user reads
 * and the removals that follow walk the selection in the order it was made.
 */
export function openListingsForItems(
  listings: readonly MarketplaceListing[],
  itemIds: readonly string[],
): MarketplaceListing[] {
  const byItemId = new Map<string, MarketplaceListing>();
  for (const listing of listings) {
    if (!isOpenListing(listing)) continue;
    // First wins: `findListingByItemId` answers the first match too, so a
    // duplicate pair resolves the same way here as it does on the item screen.
    if (!byItemId.has(listing.itemId)) byItemId.set(listing.itemId, listing);
  }
  const found: MarketplaceListing[] = [];
  for (const itemId of itemIds) {
    const listing = byItemId.get(itemId);
    if (listing) found.push(listing);
  }
  return found;
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
    .sort(byCreatedAtDescThenId);
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
    .sort(byCreatedAtDescThenId);
}

/**
 * Listings that have been sold AND transferred (have a buyer). Sorted by
 * `soldAt` descending so the most recent sales appear first. Used by the
 * marketplace "Recently sold" surface that gives sellers pricing context
 * without exposing them in the active feed.
 */
export const RECENTLY_SOLD_DEFAULT_LIMIT = 12;

export function recentlySoldListings(
  listings: readonly MarketplaceListing[],
  limit: number = RECENTLY_SOLD_DEFAULT_LIMIT,
): MarketplaceListing[] {
  return listings
    .filter((l) => l.soldAt != null && l.buyerUserId != null)
    .slice()
    .sort(bySoldAtDesc)
    .slice(0, limit);
}

/**
 * Listings the user has bought (claimed via the marketplace transfer flow).
 * Sorted by `soldAt` descending so the most recent purchases appear first.
 *
 * Pass `since` to cap the result to purchases closed on or after that instant
 * (e.g. "purchases this month") so callers don't re-filter the returned array.
 * The bound is compared against each listing's `soldAt`; entries with an
 * unparseable `soldAt` are dropped when `since` is supplied.
 */
export function purchasesForUser(
  listings: readonly MarketplaceListing[],
  userId: string,
  since?: Date,
): MarketplaceListing[] {
  const sinceMs = since ? since.getTime() : null;
  return listings
    .filter((l) => {
      if (l.buyerUserId !== userId || !l.soldAt) return false;
      if (sinceMs !== null) {
        const soldMs = Date.parse(l.soldAt);
        if (Number.isNaN(soldMs) || soldMs < sinceMs) return false;
      }
      return true;
    })
    .slice()
    .sort(bySoldAtDesc);
}

/**
 * Marks a purchased listing as physically received by stamping `arrivedAt`.
 * Idempotent: once a listing carries an `arrivedAt`, the original confirmation
 * timestamp is preserved (a re-tap doesn't reset the clock). Pure — returns a
 * new listing object and never mutates the input.
 */
export function markListingArrived(
  listing: MarketplaceListing,
  when: string,
): MarketplaceListing {
  if (listing.arrivedAt) return listing;
  return { ...listing, arrivedAt: when };
}

/**
 * Purchases the user has made but not yet confirmed as received:
 * `buyerUserId === userId && soldAt != null && arrivedAt == null`. Sorted by
 * `soldAt` descending so the most recent (most likely in-transit) purchases
 * surface first. Drives the "Mark as received" CTA list.
 */
export function purchasesAwaitingArrival(
  listings: readonly MarketplaceListing[],
  userId: string,
): MarketplaceListing[] {
  return listings
    .filter((l) => l.buyerUserId === userId && l.soldAt != null && l.arrivedAt == null)
    .slice()
    .sort(bySoldAtDesc);
}

/**
 * Listings the user has *acquired* via the marketplace — same filter as
 * {@link purchasesForUser} (`buyerUserId === userId && soldAt != null`) but
 * sorted by `createdAt` to mirror the shape of {@link listingsForUser}. Use
 * this in profile-screen "Trades & Transfers" surfaces where the chronology
 * tracks when the listing first appeared, not when the sale closed.
 */
export function listingsAcquiredByUser(
  listings: readonly MarketplaceListing[],
  userId: string,
): MarketplaceListing[] {
  return listings
    .filter((l) => l.buyerUserId === userId && l.soldAt != null)
    .slice()
    .sort(byCreatedAtDescThenId);
}

/**
 * Listings the user has *sold* — `ownerUserId === userId && soldAt != null`.
 * Sorted by `soldAt` descending so the most recent sales appear first. Pairs
 * with {@link purchasesForUser} on the profile "Marketplace history" surface
 * to give users a complete personal trading audit.
 */
export function salesForUser(
  listings: readonly MarketplaceListing[],
  userId: string,
): MarketplaceListing[] {
  return listings
    .filter((l) => l.ownerUserId === userId && l.soldAt != null)
    .slice()
    .sort(bySoldAtDesc);
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
  // Total order, not just a consistent one: the `.slice(0, limit)` below cuts a
  // top-N, so same-`recordedAt` entries at the boundary would otherwise decide
  // which price point makes the chart by listing-array order alone.
  out.sort(
    tieBreakById(
      (a: PriceHistoryEntry, b: PriceHistoryEntry) =>
        compareIsoDesc(a.recordedAt, b.recordedAt),
      (entry) => entry.listingId,
    ),
  );
  return out.slice(0, limit);
}
