import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * BE-22b — structural assertions on the `validate-premium` Edge Function. It
 * runs under Deno (not Node), so we assert source-level invariants instead of
 * executing it: the caller is validated via `auth.getUser()`, writes go through
 * the service-role key (with the BE-23 self-check), a lapsed period is lazily
 * expired on "validate", "activate" upserts a fresh idempotent period, and the
 * response is the narrow `{ isPremium, activatedAt, expiresAt }` entitlement.
 */

const FUNCTION_PATH = path.join(
  process.cwd(),
  "supabase",
  "functions",
  "validate-premium",
  "index.ts",
);

const SOURCE = readFileSync(FUNCTION_PATH, "utf8");

describe("validate-premium Edge Function", () => {
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

  it("delegates caller authentication to the shared assertCaller helper (SEC-9)", () => {
    assert.match(SOURCE, /from ["']\.\.\/_shared\/assert-caller\.ts["']/);
    assert.match(SOURCE, /assertCaller\(req,\s*["']validate-premium["']\)/);
  });

  it("maps a missing/invalid session to 401 and an anon-key misconfig to 500", () => {
    // The literal "Missing authorization"/"Invalid session"/401 now live in the
    // shared helper; the function maps CallerAuthError to its carried status.
    assert.match(SOURCE, /authErr instanceof CallerAuthError/);
    assert.match(SOURCE, /authErr\.status/);
    assert.match(SOURCE, /function misconfigured/);
  });

  it("self-checks the service-role key before privileged writes (BE-23)", () => {
    assert.match(SOURCE, /assertServiceRoleKey\(serviceRoleKey,\s*['"]validate-premium['"]\)/);
    assert.match(SOURCE, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  });

  it("rejects an unknown action with 400", () => {
    assert.match(SOURCE, /invalid action/);
    assert.match(SOURCE, /400/);
    // Only "validate" and "activate" are accepted.
    assert.match(SOURCE, /action\s*!==\s*['"]validate['"]\s*&&\s*action\s*!==\s*['"]activate['"]/);
  });

  it("subjects the entitlement to the authenticated caller, never a body-supplied id", () => {
    assert.match(SOURCE, /const userId = caller\.user\.id/);
    // The user_id written must come from the session, not the payload.
    assert.doesNotMatch(SOURCE, /user_id:\s*payload/);
  });

  it("reads the caller's subscriptions row under the service-role admin client", () => {
    assert.match(SOURCE, /createClient\(supabaseUrl,\s*serviceRoleKey\)/);
    assert.match(SOURCE, /from\(['"]subscriptions['"]\)/);
    assert.match(SOURCE, /\.eq\(['"]user_id['"],\s*userId\)/);
  });

  it("activate upserts a fresh active period idempotently", () => {
    // An already-active period is returned unchanged (no clock reset).
    assert.match(SOURCE, /isActive\(current,\s*nowMs\)/);
    assert.match(SOURCE, /\.upsert\(\s*\{[\s\S]*status:\s*['"]active['"]/);
    assert.match(SOURCE, /onConflict:\s*['"]user_id['"]/);
    assert.match(SOURCE, /PREMIUM_PERIOD_DAYS/);
  });

  it("validate lazily expires a lapsed active period", () => {
    assert.match(SOURCE, /\.update\(\s*\{\s*status:\s*['"]expired['"]\s*\}\s*\)/);
  });

  it("returns the narrow { isPremium, activatedAt, expiresAt } entitlement", () => {
    assert.match(SOURCE, /isPremium:/);
    assert.match(SOURCE, /activatedAt:/);
    assert.match(SOURCE, /expiresAt:/);
    assert.match(SOURCE, /toValidation\(/);
  });
});
