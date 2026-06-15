import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import type { CollectableItem, Collection, UserProfile } from "@/lib/types";

/**
 * BE-3 — schema-parity guard. Rather than hardcoding a column list (the BE-1
 * structural test does that), this derives the columns the client actually
 * reads/writes straight from the REST URL/body builders in
 * `lib/supabase-profiles-shapes.ts`, then asserts every one of them exists in
 * the base-schema migration. If a new field is added to a builder without a
 * matching column in the migration, this fails — closing the drift that
 * produces "column does not exist" prod errors. Mirrors the
 * builder-derived-expectation approach of supabase-profiles-shapes.test.ts.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260423_base_schema.sql"),
  "utf8",
);
// strip `-- ...` comments so prose mentioning a column name can't satisfy an
// assertion the executable SQL doesn't actually back.
const SQL = MIGRATION.replace(/--.*$/gm, "");

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
};

// Body builders → the columns the client writes.
for (const k of Object.keys(upsertProfileBody(PROFILE))) TABLES.profiles.columns.add(k);
for (const k of Object.keys(updateProfileDisplayCurrencyBody("USD"))) TABLES.profiles.columns.add(k);
for (const k of Object.keys(upsertCollectionBody(COLLECTION))) TABLES.collections.columns.add(k);
for (const k of Object.keys(upsertItemBody(ITEM, "c1"))) TABLES.items.columns.add(k);
for (const k of Object.keys(sendFriendRequestBody("u1", "u2"))) TABLES.friend_requests.columns.add(k);

// URL builders → the columns the client filters / orders / selects on.
for (const c of columnsFromUrl(profileByIdUrl(BASE, "u1"))) TABLES.profiles.columns.add(c);
for (const c of columnsFromUrl(profilesPageUrl(BASE, 1, 10))) TABLES.profiles.columns.add(c);
for (const c of columnsFromUrl(collectionByIdUrl(BASE, "c1"))) TABLES.collections.columns.add(c);
for (const c of columnsFromUrl(collectionsByUserUrl(BASE, "u1"))) TABLES.collections.columns.add(c);
for (const c of columnsFromUrl(publicCollectionsByUserUrl(BASE, "u1"))) TABLES.collections.columns.add(c);
for (const c of columnsFromUrl(itemByIdUrl(BASE, "i1"))) TABLES.items.columns.add(c);
for (const c of columnsFromUrl(itemsByCollectionUrl(BASE, "c1"))) TABLES.items.columns.add(c);
for (const c of columnsFromUrl(friendRequestsUrl(BASE, "u1"))) TABLES.friend_requests.columns.add(c);
for (const c of columnsFromUrl(removeFriendRequestUrl(BASE, "u1", "u2"))) TABLES.friend_requests.columns.add(c);

/** Extract the body of a `CREATE TABLE public.<name> ( ... );` block. */
function tableBody(name: string): string {
  const start = SQL.indexOf(`public.${name} (`);
  assert.notEqual(start, -1, `migration is missing CREATE TABLE public.${name}`);
  const open = SQL.indexOf("(", start);
  let depth = 0;
  for (let i = open; i < SQL.length; i++) {
    if (SQL[i] === "(") depth++;
    else if (SQL[i] === ")") {
      depth--;
      if (depth === 0) return SQL.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated CREATE TABLE for ${name}`);
}

describe("base schema column parity with the REST builders (BE-3)", () => {
  for (const [table, { columns }] of Object.entries(TABLES)) {
    it(`${table} defines every column its builders reference`, () => {
      const body = tableBody(table);
      // a column is declared if `<name> ` appears at a line start (after the
      // opening paren / a comma) — `\b<name>\b` is enough given the body scope.
      for (const col of columns) {
        assert.match(
          body,
          new RegExp(`\\b${col}\\b`),
          `public.${table} is missing column "${col}" referenced by a *-shapes.ts builder`,
        );
      }
    });
  }

  it("derives a non-trivial column set per table (guards against a no-op test)", () => {
    assert.ok(TABLES.profiles.columns.size >= 7, "too few profile columns derived");
    assert.ok(TABLES.collections.columns.size >= 9, "too few collection columns derived");
    assert.ok(TABLES.items.columns.size >= 15, "too few item columns derived");
    assert.ok(TABLES.friend_requests.columns.size >= 2, "too few friend_request columns derived");
  });
});
