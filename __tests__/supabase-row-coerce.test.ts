import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  coerceBoolean,
  coerceCollectionRow,
  coerceItemRow,
  coerceNumberOrNull,
  coerceProfileRow,
  coerceReactionRow,
  coerceString,
  coerceStringArray,
} from "@/lib/supabase-row-coerce";

/**
 * BE-10 — the `coerce*` read-path validators must turn any malformed Supabase
 * row (legacy NULLs, RLS-narrowed selects, hand-edited dashboard rows) into a
 * fully-typed domain object with safe defaults, never propagating a `null`
 * into a field typed as a plain `string`/`string[]`.
 */

describe("scalar coercers", () => {
  it("coerceString falls back for non-strings", () => {
    assert.equal(coerceString("hi"), "hi");
    assert.equal(coerceString(null), "");
    assert.equal(coerceString(undefined), "");
    assert.equal(coerceString(42), "");
    assert.equal(coerceString(null, "fallback"), "fallback");
  });

  it("coerceNumberOrNull keeps finite numbers, nulls everything else", () => {
    assert.equal(coerceNumberOrNull(12.5), 12.5);
    assert.equal(coerceNumberOrNull(0), 0);
    assert.equal(coerceNumberOrNull(null), null);
    assert.equal(coerceNumberOrNull("12"), null);
    assert.equal(coerceNumberOrNull(NaN), null);
    assert.equal(coerceNumberOrNull(Infinity), null);
  });

  it("coerceBoolean keeps booleans, otherwise the fallback", () => {
    assert.equal(coerceBoolean(true), true);
    assert.equal(coerceBoolean(false), false);
    assert.equal(coerceBoolean(undefined), false);
    assert.equal(coerceBoolean("true"), false);
    assert.equal(coerceBoolean(null, true), true);
  });

  it("coerceStringArray drops non-string entries and non-arrays", () => {
    assert.deepEqual(coerceStringArray(["a", "b"]), ["a", "b"]);
    assert.deepEqual(coerceStringArray(["a", 1, null, "b"]), ["a", "b"]);
    assert.deepEqual(coerceStringArray(null), []);
    assert.deepEqual(coerceStringArray("a"), []);
  });
});

describe("coerceProfileRow", () => {
  it("maps a well-formed row", () => {
    const p = coerceProfileRow({
      id: "u1",
      email: "a@b.c",
      display_name: "Ann",
      username: "ann",
      public_id: "ann-1",
      bio: "hi",
      avatar: "http://x",
      display_currency: "EUR",
      is_admin: true,
    });
    assert.deepEqual(p, {
      id: "u1",
      email: "a@b.c",
      displayName: "Ann",
      username: "ann",
      publicId: "ann-1",
      bio: "hi",
      avatar: "http://x",
      displayCurrency: "EUR",
      isAdmin: true,
    });
  });

  it("defaults every missing/null required field to a safe value", () => {
    const p = coerceProfileRow({ id: "u1" });
    assert.equal(p.id, "u1");
    assert.equal(p.email, "");
    assert.equal(p.displayName, "");
    assert.equal(p.username, "");
    assert.equal(p.bio, "");
    assert.equal(p.avatar, "");
    assert.equal(p.displayCurrency, null);
    assert.equal(p.isAdmin, false);
  });

  it("never throws on a fully malformed input", () => {
    assert.doesNotThrow(() => coerceProfileRow(null));
    assert.doesNotThrow(() => coerceProfileRow(undefined));
    assert.doesNotThrow(() => coerceProfileRow("nope"));
    assert.equal(coerceProfileRow(null).username, "");
  });

  it("only `true` is admin (NULL/missing/'true' string → false)", () => {
    assert.equal(coerceProfileRow({ is_admin: null }).isAdmin, false);
    assert.equal(coerceProfileRow({ is_admin: "true" }).isAdmin, false);
    assert.equal(coerceProfileRow({ is_admin: 1 }).isAdmin, false);
  });
});

describe("coerceCollectionRow", () => {
  it("maps a well-formed row", () => {
    const c = coerceCollectionRow({
      id: "c1",
      name: "Coins",
      cover_photo: "http://x",
      description: "d",
      owner_name: "Ann",
      owner_user_id: "u1",
      shared_with_user_ids: ["u2"],
      sort_order: 3,
      visibility: "public",
      currency: "USD",
    });
    assert.equal(c.name, "Coins");
    assert.equal(c.visibility, "public");
    assert.deepEqual(c.sharedWithUserIds, ["u2"]);
    assert.equal(c.sortOrder, 3);
    assert.equal(c.currency, "USD");
    assert.equal(c.role, "viewer");
  });

  it("defaults nulls: visibility→private, arrays→[], currency→null", () => {
    const c = coerceCollectionRow({ id: "c1", name: null, shared_with_user_ids: null });
    assert.equal(c.name, "");
    assert.equal(c.visibility, "private");
    assert.deepEqual(c.sharedWithUserIds, []);
    assert.equal(c.currency, null);
    assert.equal(c.sortOrder, undefined);
  });

  it("rejects an unknown visibility string → private", () => {
    assert.equal(coerceCollectionRow({ visibility: "hidden" }).visibility, "private");
  });
});

describe("coerceItemRow", () => {
  it("maps a well-formed row", () => {
    const it = coerceItemRow({
      id: "i1",
      collection_id: "c1",
      title: "Penny",
      acquired_at: "2020",
      acquired_from: "shop",
      description: "d",
      variants: "v",
      photos: ["p1", "p2"],
      created_by: "Ann",
      created_by_user_id: "u1",
      created_at: "2020-01-01",
      cost: 9.5,
      cost_currency: "USD",
      sort_order: 2,
      is_wishlist: true,
      condition: "good",
      tags: [{ label: "rare", color: "#fff" }],
      archived_at: "2021-01-01",
    });
    assert.equal(it.title, "Penny");
    assert.deepEqual(it.photos, ["p1", "p2"]);
    assert.equal(it.cost, 9.5);
    assert.equal(it.costCurrency, "USD");
    assert.equal(it.isWishlist, true);
    assert.equal(it.condition, "good");
    assert.deepEqual(it.tags, [{ label: "rare", color: "#fff" }]);
    assert.equal(it.archivedAt, "2021-01-01");
  });

  it("defaults nulls: strings→'', photos→[], cost→null, isWishlist→false", () => {
    const it = coerceItemRow({ id: "i1", title: null, photos: null, cost: null });
    assert.equal(it.title, "");
    assert.deepEqual(it.photos, []);
    assert.equal(it.cost, null);
    assert.equal(it.costCurrency, undefined);
    assert.equal(it.isWishlist, false);
    assert.equal(it.condition, undefined);
    assert.equal(it.tags, undefined);
    assert.equal(it.archivedAt, null);
  });

  it("rejects an unknown condition and malformed tags", () => {
    assert.equal(coerceItemRow({ condition: "mint" }).condition, undefined);
    assert.equal(coerceItemRow({ tags: [{ label: "x" }, 5] }).tags, undefined);
  });

  it("never throws on null/garbage input", () => {
    assert.doesNotThrow(() => coerceItemRow(null));
    assert.deepEqual(coerceItemRow(null).photos, []);
  });
});

describe("coerceReactionRow", () => {
  it("maps a well-formed row", () => {
    const r = coerceReactionRow({
      id: "r1",
      user_id: "u1",
      target_type: "collection",
      target_id: "c1",
      emoji: "fire",
      created_at: "2020",
    });
    assert.deepEqual(r, {
      id: "r1",
      userId: "u1",
      targetType: "collection",
      targetId: "c1",
      emoji: "fire",
      createdAt: "2020",
    });
  });

  it("defaults unknown target_type→item and unknown emoji→heart", () => {
    const r = coerceReactionRow({ id: "r1", target_type: "bogus", emoji: "bogus" });
    assert.equal(r.targetType, "item");
    assert.equal(r.emoji, "heart");
  });
});
