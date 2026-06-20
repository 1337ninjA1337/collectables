import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * BE-20 — structural assertions on the `claim-listing` Edge Function. It runs
 * under Deno (not Node), so we assert source-level invariants instead of
 * executing it: the atomic conditional UPDATE (active + buyer≠seller), the
 * service-role self-check, the precise double-claim rejection, auth gating,
 * and CORS handling.
 */

const FUNCTION_PATH = path.join(
  process.cwd(),
  "supabase",
  "functions",
  "claim-listing",
  "index.ts",
);

const SOURCE = readFileSync(FUNCTION_PATH, "utf8");

describe("claim-listing Edge Function", () => {
  it("exists at the documented path", () => {
    assert.ok(statSync(FUNCTION_PATH).isFile());
  });

  it("uses Deno.serve as the entrypoint (Edge Function convention)", () => {
    assert.match(SOURCE, /Deno\.serve\s*\(/);
  });

  it("handles CORS preflight (OPTIONS)", () => {
    assert.match(SOURCE, /req\.method\s*===\s*['"]OPTIONS['"]/);
    assert.match(SOURCE, /Access-Control-Allow-Methods/);
  });

  it("rejects non-POST methods with 405", () => {
    assert.match(SOURCE, /method not allowed/);
    assert.match(SOURCE, /405/);
  });

  it("returns 401 when the Authorization header is missing", () => {
    assert.match(SOURCE, /Missing authorization/);
    assert.match(SOURCE, /401/);
  });

  it("verifies the caller's session via auth.getUser()", () => {
    assert.match(SOURCE, /auth\.getUser\(\)/);
    assert.match(SOURCE, /Invalid session/);
  });

  it("self-checks the service-role key before privileged writes (BE-23)", () => {
    assert.match(SOURCE, /assertServiceRoleKey\(serviceRoleKey,\s*['"]claim-listing['"]\)/);
    assert.match(SOURCE, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  });

  it("returns 400 on invalid JSON or a missing listing id", () => {
    assert.match(SOURCE, /invalid json/);
    assert.match(SOURCE, /missing listing id/);
    assert.match(SOURCE, /400/);
  });

  it("claims atomically: conditional UPDATE on active + buyer≠seller", () => {
    // The update must be gated by `sold_at IS NULL` and `owner != buyer` so a
    // double-claim or a self-claim updates zero rows (PostgreSQL row-locks the
    // target and re-checks the predicate under the lock).
    assert.match(SOURCE, /\.update\(\s*\{\s*buyer_user_id:[\s\S]*sold_at:/);
    assert.match(SOURCE, /\.is\(['"]sold_at['"],\s*null\)/);
    assert.match(SOURCE, /\.neq\(['"]owner_user_id['"],\s*buyerUserId\)/);
    assert.match(SOURCE, /marketplace_listings/);
  });

  it("sets the buyer to the authenticated caller, never a body-supplied id", () => {
    assert.match(SOURCE, /const buyerUserId = user\.id/);
    // The id used in the update must come from the session, not the payload.
    assert.doesNotMatch(SOURCE, /buyer_user_id:\s*payload/);
  });

  it("returns 200 with the listing only when a row was actually claimed", () => {
    assert.match(SOURCE, /claimed && claimed\.length > 0/);
    assert.match(SOURCE, /success:\s*true/);
  });

  it("returns 404 when the listing does not exist", () => {
    assert.match(SOURCE, /listing not found/);
    assert.match(SOURCE, /404/);
  });

  it("rejects a self-claim with 409 (cannot claim your own listing)", () => {
    assert.match(SOURCE, /cannot claim your own listing/);
  });

  it("rejects a double-claim with 409 (listing already claimed)", () => {
    assert.match(SOURCE, /listing already claimed/);
    assert.match(SOURCE, /409/);
  });
});
