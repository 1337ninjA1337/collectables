import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * BE-21 — structural assertions on the `accept-friend-request` Edge Function.
 * It runs under Deno (not Node), so we assert source-level invariants instead
 * of executing it: the caller-as-acceptor rule, the service-role self-check,
 * the transactional flip via the `accept_friend_request` RPC, the precise
 * "no pending request" rejection, auth gating, and CORS handling.
 */

const FUNCTION_PATH = path.join(
  process.cwd(),
  "supabase",
  "functions",
  "accept-friend-request",
  "index.ts",
);

const SOURCE = readFileSync(FUNCTION_PATH, "utf8");

describe("accept-friend-request Edge Function", () => {
  it("exists at the documented path", () => {
    assert.ok(statSync(FUNCTION_PATH).isFile());
  });

  it("uses Deno.serve as the entrypoint (Edge Function convention)", () => {
    assert.match(SOURCE, /Deno\.serve\s*\(/);
  });

  it("handles CORS preflight (OPTIONS)", () => {
    assert.match(SOURCE, /req\.method\s*===\s*['"]OPTIONS['"]/);
    // SEC-10: CORS now comes from the shared gate (no inline header literal).
    assert.match(SOURCE, /evaluateCors\(\s*req,/);
  });

  it("rejects non-POST methods with 405", () => {
    assert.match(SOURCE, /method not allowed/);
    assert.match(SOURCE, /405/);
  });

  it("delegates the auth handshake to the shared assertCaller gate (SEC-9)", () => {
    assert.match(SOURCE, /import \{ assertCaller \} from ["']\.\.\/_shared\/assert-caller\.ts["']/);
    assert.match(SOURCE, /await assertCaller\(\s*req,\s*corsHeaders,/);
    // The gate returns the 401 (Missing authorization / Invalid session) itself.
    assert.match(SOURCE, /if \(!auth\.ok\) return auth\.response/);
  });

  it("verifies the caller's session via auth.getUser() before any privileged op", () => {
    assert.match(SOURCE, /auth\.getUser\(\)/);
    // The acting subject is the verified caller, never a body-supplied id.
    assert.match(SOURCE, /auth\.user/);
  });

  it("self-checks the service-role key before privileged writes (BE-23)", () => {
    assert.match(SOURCE, /assertServiceRoleKey\(serviceRoleKey,\s*['"]accept-friend-request['"]\)/);
    assert.match(SOURCE, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  });

  it("returns 400 on invalid JSON or a missing fromUserId", () => {
    assert.match(SOURCE, /invalid json/);
    assert.match(SOURCE, /missing fromUserId/);
    assert.match(SOURCE, /400/);
  });

  it("sets the acceptor to the authenticated caller, never a body-supplied id", () => {
    assert.match(SOURCE, /const toUserId = user\.id/);
    // The acceptor id used must come from the session, not the payload.
    assert.doesNotMatch(SOURCE, /p_to_user_id:\s*payload/);
  });

  it("rejects accepting your own request with 400", () => {
    assert.match(SOURCE, /fromUserId === toUserId/);
    assert.match(SOURCE, /cannot accept your own request/);
  });

  it("flips both directions transactionally via the accept_friend_request RPC", () => {
    assert.match(SOURCE, /\.rpc\(\s*['"]accept_friend_request['"]/);
    assert.match(SOURCE, /p_from_user_id:\s*fromUserId/);
    assert.match(SOURCE, /p_to_user_id:\s*toUserId/);
  });

  it("maps a withdrawn inbound request (P0002) to a precise 409", () => {
    assert.match(SOURCE, /P0002/);
    assert.match(SOURCE, /no pending friend request/);
    assert.match(SOURCE, /409/);
  });

  it("returns 200 with success only when the RPC resolved without error", () => {
    assert.match(SOURCE, /success:\s*true/);
    assert.match(SOURCE, /friendRequests:/);
  });
});
