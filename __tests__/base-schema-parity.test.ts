import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  collectionByIdUrl,
  collectionsByUserUrl,
  friendRequestsUrl,
  itemByIdUrl,
  itemsByCollectionUrl,
  profileByIdUrl,
  profilesPageUrl,
  publicCollectionsByUserUrl,
  removeFriendRequestUrl,
  sendFriendRequestBody,
  updateProfileDisplayCurrencyBody,
  upsertCollectionBody,
  upsertItemBody,
  upsertProfileBody,
} from "@/lib/supabase-profiles-shapes";
import {
  chatReadsUrl,
  chatReadUpsertBody,
  fetchMessagesUrl,
  friendCheckUrl,
  messageToInsertPayload,
} from "@/lib/supabase-chat-shapes";
import {
  fetchListingByIdUrl,
  fetchListingsUrl,
  listingToInsertPayload,
  markSoldPayload,
  markSoldUrl,
} from "@/lib/supabase-marketplace-shapes";
import type {
  CollectableItem,
  Collection,
  MarketplaceListing,
  UserProfile,
} from "@/lib/types";

/**
 * BE-3 / BE-37 — schema-parity guard across EVERY `*-shapes.ts` module.
 *
 * Rather than hardcoding a column list (the BE-1 structural test does that),
 * this derives the columns the client actually reads/writes straight from the
 * REST URL/body builders in `lib/supabase-*-shapes.ts`, then asserts every one
 * of them exists in the committed migrations. If a new field is added to a
 * builder without a matching column in a migration, this fails — closing the
 * drift that produces "column does not exist" prod errors.
 *
 * BE-37 extends the original profiles-only coverage to the chat
 * (`chat_messages`, `chat_reads`) and marketplace (`marketplace_listings`)
 * builders, so the same guard now spans all three shape modules and all of
 * their backing tables.
 */

const ROOT = process.cwd();

// Every committed migration, comment-stripped so prose mentioning a column
// name can't satisfy an assertion the executable SQL doesn't actually back.
// Tables/columns live across many migration files (base schema, the chat /
// marketplace creates, and later `ALTER … ADD COLUMN` additions like
// `is_admin` / `updated_at` / `deleted_at` / `buyer_user_id`), so the parity
// check works against the full concatenation rather than a single file.
const ALL_MIGRATIONS_SQL = readdirSync(path.join(ROOT, "supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) =>
    readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8").replace(/--.*$/gm, ""),
  )
  .join("\n");

const BASE = "https://demo.supabase.co";

// Fully-populated domain objects so every optional field is exercised by the
// body builders (a builder may omit a column when its source field is absent).
const PROFILE: UserProfile = {
  id: "u1",
  email: "a@b.c",
  displayName: "Ann",
  username: "ann",
  publicId: "ann-1",
  bio: "hi",
  avatar: "http://x/a.png",
  displayCurrency: "USD",
};

const COLLECTION: Collection = {
  id: "c1",
  name: "Coins",
  coverPhoto: "http://x/c.png",
  description: "d",
  ownerName: "Ann",
  ownerUserId: "u1",
  sharedWith: [],
  sharedWithUserIds: ["u2"],
  role: "owner",
  sortOrder: 1,
  visibility: "public",
  currency: "EUR",
};

const ITEM: CollectableItem = {
  id: "i1",
  collectionId: "c1",
  title: "Penny",
  acquiredAt: "2026-01-01",
  acquiredFrom: "shop",
  description: "d",
  variants: "v",
  photos: ["http://x/p.png"],
  createdBy: "Ann",
  createdByUserId: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  cost: 5,
  costCurrency: "USD",
  sortOrder: 1,
  isWishlist: true,
  condition: "new",
  tags: [{ label: "rare", color: "#fff" }],
  archivedAt: "2026-02-01T00:00:00Z",
};

const LISTING: MarketplaceListing = {
  id: "l1",
  itemId: "i1",
  ownerUserId: "u1",
  mode: "sell",
  askingPrice: 10,
  currency: "USD",
  notes: "mint",
  createdAt: "2026-01-01T00:00:00Z",
  soldAt: "2026-02-01T00:00:00Z",
  buyerUserId: "u2",
  arrivedAt: "2026-03-01T00:00:00Z",
};

/** Columns referenced in a REST URL via filters / order / select lists. */
function columnsFromUrl(url: string): string[] {
  const cols = new Set<string>();
  const query = url.split("?")[1] ?? "";
  for (const part of query.split("&")) {
    const [rawKey, rawVal] = part.split("=");
    const key = decodeURIComponent(rawKey ?? "");
    const val = decodeURIComponent(rawVal ?? "");
    if (key === "select") {
      for (const c of val.split(",")) if (c && c !== "*") cols.add(c);
    } else if (key === "order") {
      for (const c of val.split(",")) {
        const name = c.split(".")[0];
        if (name) cols.add(name);
      }
    } else if (key === "or") {
      // or=(from_user_id.eq.x,to_user_id.eq.y) and nested and(...) forms.
      for (const m of val.matchAll(/([a-z_]+)\.(?:eq|neq|gt|lt|gte|lte|cs)\./g)) {
        cols.add(m[1]);
      }
    } else if (/^[a-z_]+$/.test(key) && val.includes(".")) {
      // <col>=eq.x / neq / cs.{...} etc.
      cols.add(key);
    }
  }
  return [...cols];
}

const TABLES: Record<string, { columns: Set<string> }> = {
  profiles: { columns: new Set() },
  collections: { columns: new Set() },
  items: { columns: new Set() },
  friend_requests: { columns: new Set() },
  chat_messages: { columns: new Set() },
  chat_reads: { columns: new Set() },
  marketplace_listings: { columns: new Set() },
};

const addBody = (table: string, body: Record<string, unknown>) => {
  for (const k of Object.keys(body)) TABLES[table].columns.add(k);
};
const addUrl = (table: string, url: string) => {
  for (const c of columnsFromUrl(url)) TABLES[table].columns.add(c);
};

// --- profiles-shapes.ts -----------------------------------------------------
// Body builders → the columns the client writes.
addBody("profiles", upsertProfileBody(PROFILE));
addBody("profiles", updateProfileDisplayCurrencyBody("USD"));
addBody("collections", upsertCollectionBody(COLLECTION));
addBody("items", upsertItemBody(ITEM, "c1"));
addBody("friend_requests", sendFriendRequestBody("u1", "u2"));
// URL builders → the columns the client filters / orders / selects on.
addUrl("profiles", profileByIdUrl(BASE, "u1"));
addUrl("profiles", profilesPageUrl(BASE, 1, 10));
addUrl("collections", collectionByIdUrl(BASE, "c1"));
addUrl("collections", collectionsByUserUrl(BASE, "u1"));
addUrl("collections", publicCollectionsByUserUrl(BASE, "u1"));
addUrl("items", itemByIdUrl(BASE, "i1"));
addUrl("items", itemsByCollectionUrl(BASE, "c1"));
addUrl("friend_requests", friendRequestsUrl(BASE, "u1"));
addUrl("friend_requests", removeFriendRequestUrl(BASE, "u1", "u2"));

// --- chat-shapes.ts (BE-37) -------------------------------------------------
addBody(
  "chat_messages",
  messageToInsertPayload({
    chatId: "c-1",
    fromUserId: "u1",
    toUserId: "u2",
    text: "hi",
    id: "m1",
    createdAt: "2026-01-01T00:00:00Z",
  }),
);
addBody("chat_reads", chatReadUpsertBody("u1", "c-1", "2026-01-01T00:00:00Z"));
addUrl("chat_messages", fetchMessagesUrl(BASE, "c-1"));
addUrl("chat_reads", chatReadsUrl(BASE, "u1"));
// friendCheckUrl lives in chat-shapes but reads the friend_requests table.
addUrl("friend_requests", friendCheckUrl(BASE, "u1", "u2"));

// --- marketplace-shapes.ts (BE-37) ------------------------------------------
addBody("marketplace_listings", listingToInsertPayload(LISTING));
addBody("marketplace_listings", markSoldPayload("2026-02-01T00:00:00Z", "u2"));
addUrl("marketplace_listings", fetchListingsUrl(BASE));
addUrl("marketplace_listings", fetchListingByIdUrl(BASE, "l1"));
addUrl("marketplace_listings", markSoldUrl(BASE, "l1"));

/**
 * Extract the body of a `CREATE TABLE [IF NOT EXISTS] public.<name> ( ... );`
 * block from the concatenated migrations. Anchored on the CREATE TABLE keyword
 * (not a bare `public.<name> (`) so an index/policy/ALTER line that also names
 * the table can never be mistaken for its definition.
 */
function tableBody(name: string): string {
  const re = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${name}\\s*\\(`,
    "i",
  );
  const m = re.exec(ALL_MIGRATIONS_SQL);
  assert.ok(m, `migrations are missing CREATE TABLE public.${name}`);
  const open = ALL_MIGRATIONS_SQL.indexOf("(", m.index);
  let depth = 0;
  for (let i = open; i < ALL_MIGRATIONS_SQL.length; i++) {
    if (ALL_MIGRATIONS_SQL[i] === "(") depth++;
    else if (ALL_MIGRATIONS_SQL[i] === ")") {
      depth--;
      if (depth === 0) return ALL_MIGRATIONS_SQL.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated CREATE TABLE for ${name}`);
}

describe("schema column parity with the REST builders (BE-3 / BE-37)", () => {
  for (const [table, { columns }] of Object.entries(TABLES)) {
    it(`${table} defines every column its builders reference`, () => {
      const body = tableBody(table);
      // a column is declared if `\b<name>\b` appears in the table body — strong
      // scoping given we already isolated the CREATE TABLE block.
      for (const col of columns) {
        const re = new RegExp(`\\b${col}\\b`);
        // Fast path: the CREATE TABLE block declares it (strong scoping).
        if (re.test(body)) continue;
        // Fallback: a later migration's ALTER … ADD COLUMN added it (e.g.
        // is_admin / updated_at / deleted_at / buyer_user_id / arrived_at).
        assert.match(
          ALL_MIGRATIONS_SQL,
          re,
          `public.${table} is missing column "${col}" referenced by a *-shapes.ts builder (not in its CREATE TABLE nor any later migration)`,
        );
      }
    });
  }

  it("derives a non-trivial column set per table (guards against a no-op test)", () => {
    assert.ok(TABLES.profiles.columns.size >= 7, "too few profile columns derived");
    assert.ok(TABLES.collections.columns.size >= 9, "too few collection columns derived");
    assert.ok(TABLES.items.columns.size >= 15, "too few item columns derived");
    assert.ok(TABLES.friend_requests.columns.size >= 2, "too few friend_request columns derived");
    assert.ok(TABLES.chat_messages.columns.size >= 5, "too few chat_message columns derived");
    assert.ok(TABLES.chat_reads.columns.size >= 3, "too few chat_read columns derived");
    assert.ok(
      TABLES.marketplace_listings.columns.size >= 10,
      "too few marketplace_listing columns derived",
    );
  });
});
