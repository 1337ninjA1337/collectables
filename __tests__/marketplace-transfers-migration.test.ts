import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the marketplace_transfers migration. The actual
 * SQL is executed against Supabase out-of-band; this test guards against
 * accidental regressions in the schema/RLS shape — most importantly the
 * "audit log survives a deleted listing" promise (no FK on listing_id) and
 * the append-only-by-RLS contract (no UPDATE / DELETE policies).
 */

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260527023036_marketplace_transfers.sql",
);

const MANUAL_TASKS_PATH = path.join(process.cwd(), "MANUAL-TASKS.md");

const SOURCE = readFileSync(MIGRATION_PATH, "utf8");
const MANUAL_TASKS = readFileSync(MANUAL_TASKS_PATH, "utf8");

describe("marketplace_transfers migration", () => {
  it("creates the marketplace_transfers table with the documented columns", () => {
    assert.match(SOURCE, /CREATE TABLE IF NOT EXISTS public\.marketplace_transfers/);
    for (const column of [
      "id",
      "listing_id",
      "item_id",
      "owner_user_id",
      "buyer_user_id",
      "mode",
      "asking_price",
      "currency",
      "transferred_at",
    ]) {
      assert.match(
        SOURCE,
        new RegExp(`\\b${column}\\b`),
        `missing column declaration for '${column}'`,
      );
    }
  });

  it("uses gen_random_uuid as the id default", () => {
    assert.match(SOURCE, /id[\s\S]*uuid[\s\S]*DEFAULT gen_random_uuid\(\)/);
  });

  it("uses timestamptz with a default of now() for transferred_at", () => {
    assert.match(SOURCE, /transferred_at[\s\S]*timestamptz[\s\S]*DEFAULT now\(\)/);
  });

  it("constrains mode to ('sell', 'trade') to mirror marketplace_listings", () => {
    assert.match(SOURCE, /CHECK\s*\(\s*mode\s+IN\s*\(\s*'sell'\s*,\s*'trade'\s*\)/);
  });

  it("does NOT create a FK on listing_id (audit log must survive listing deletion)", () => {
    // Catches the regression where someone "tightens" the schema by adding
    // `REFERENCES public.marketplace_listings(id)` on the listing_id column —
    // doing so would defeat the entire purpose of this audit log (the seller
    // deleting their listing would cascade-delete the audit row).
    const listingIdLine = SOURCE.match(/listing_id\s+text[^,\n]*/);
    assert.ok(listingIdLine, "could not locate listing_id column declaration");
    assert.doesNotMatch(
      listingIdLine![0],
      /REFERENCES/i,
      "listing_id must remain a plain text reference — adding a FK would cascade-delete audit rows when the listing is removed",
    );
  });

  it("references auth.users with ON DELETE SET NULL for both party columns", () => {
    // Account deletion must scrub PII (the auth uid) without nuking the
    // sale's price/mode/timestamp. ON DELETE SET NULL is the right call.
    assert.match(
      SOURCE,
      /owner_user_id\s+uuid[\s\S]*REFERENCES auth\.users[\s\S]*ON DELETE SET NULL/,
    );
    assert.match(
      SOURCE,
      /buyer_user_id\s+uuid[\s\S]*REFERENCES auth\.users[\s\S]*ON DELETE SET NULL/,
    );
  });

  it("creates a unique index on listing_id so a retry / cross-device race collapses to one row", () => {
    assert.match(
      SOURCE,
      /CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transfers_listing_uniq[\s\S]*\(listing_id\)/,
    );
  });

  it("creates per-party indexes for the future profile-history surfaces", () => {
    assert.match(
      SOURCE,
      /CREATE INDEX IF NOT EXISTS marketplace_transfers_buyer_idx[\s\S]*\(buyer_user_id,\s*transferred_at\s+DESC\)/,
    );
    assert.match(
      SOURCE,
      /CREATE INDEX IF NOT EXISTS marketplace_transfers_owner_idx[\s\S]*\(owner_user_id,\s*transferred_at\s+DESC\)/,
    );
  });

  it("enables row-level security on the table", () => {
    assert.match(
      SOURCE,
      /ALTER TABLE public\.marketplace_transfers ENABLE ROW LEVEL SECURITY/,
    );
  });

  it("declares a SELECT policy restricted to the two parties", () => {
    assert.match(
      SOURCE,
      /CREATE POLICY[\s\S]+ON public\.marketplace_transfers\s+FOR SELECT[\s\S]+USING[\s\S]+buyer_user_id[\s\S]+owner_user_id/,
    );
  });

  it("declares an INSERT policy that only the buyer can satisfy", () => {
    assert.match(
      SOURCE,
      /CREATE POLICY[\s\S]+ON public\.marketplace_transfers\s+FOR INSERT[\s\S]+WITH CHECK[\s\S]+auth\.uid\(\)\s*=\s*buyer_user_id/,
    );
  });

  it("each CREATE POLICY is paired with a preceding DROP POLICY IF EXISTS for re-run safety", () => {
    // PostgreSQL ≤16 has no `CREATE POLICY IF NOT EXISTS`. Supabase Preview
    // re-runs migrations against branch DBs where the policies may already
    // exist; without the DROP-then-CREATE pattern the apply step errors
    // with SQLSTATE 42710 (duplicate_object) and the workflow turns red.
    const createPolicyMatches = SOURCE.match(/CREATE POLICY\s+"([^"]+)"/g) ?? [];
    assert.ok(createPolicyMatches.length > 0, "expected at least one CREATE POLICY in the migration");
    for (const m of createPolicyMatches) {
      const name = m.match(/"([^"]+)"/)![1];
      const pattern = new RegExp(
        `DROP POLICY IF EXISTS\\s+"${name}"\\s+ON public\\.marketplace_transfers[\\s\\S]*?CREATE POLICY\\s+"${name}"`,
      );
      assert.match(
        SOURCE,
        pattern,
        `policy "${name}" must be guarded by a preceding DROP POLICY IF EXISTS on public.marketplace_transfers`,
      );
    }
  });

  it("does NOT declare an UPDATE or DELETE policy (append-only by RLS)", () => {
    // Catches the regression where a future PR adds an UPDATE/DELETE policy
    // and accidentally lets users rewrite history.
    assert.doesNotMatch(
      SOURCE,
      /CREATE POLICY[^;]*FOR UPDATE/,
      "marketplace_transfers must remain append-only — no UPDATE policy",
    );
    assert.doesNotMatch(
      SOURCE,
      /CREATE POLICY[^;]*FOR DELETE/,
      "marketplace_transfers must remain append-only — no DELETE policy",
    );
  });
});

describe("MANUAL-TASKS.md", () => {
  it("documents the marketplace_transfers migration", () => {
    assert.match(MANUAL_TASKS, /## 20260527023036_marketplace_transfers\.sql/);
    assert.match(MANUAL_TASKS, /marketplace_transfers/);
  });

  it("calls out the no-FK / no-mutate contract so operators don't 'fix' it later", () => {
    // If someone reading the docs decides to add a FK on listing_id during
    // a "tidy up" pass, they'd silently break the audit log. The MANUAL-
    // TASKS entry should explain the choice.
    const entry = MANUAL_TASKS.match(
      /## 20260527023036_marketplace_transfers\.sql[\s\S]+?(?=\n##\s|$)/,
    );
    assert.ok(entry, "could not locate marketplace_transfers section in MANUAL-TASKS.md");
    assert.match(entry![0], /append-only|No UPDATE|append/i);
    assert.match(entry![0], /listing_id is text|NOT a FK|survives/i);
  });
});
