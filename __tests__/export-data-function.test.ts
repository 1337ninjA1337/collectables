import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * BE-26 — structural assertions on the GDPR `export-data` Edge Function. It runs
 * under Deno (not Node), so we assert source-level invariants instead of
 * executing it: the caller is validated via `auth.getUser()`, reads go through
 * the service-role key (with the BE-23 self-check), every owned table is scoped
 * to the authenticated caller, and the response is the versioned JSON document.
 */

const FUNCTION_PATH = path.join(
  process.cwd(),
  "supabase",
  "functions",
  "export-data",
  "index.ts",
);

const SOURCE = readFileSync(FUNCTION_PATH, "utf8");

describe("export-data Edge Function (BE-26)", () => {
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

  it("self-checks the service-role key before privileged reads (BE-23)", () => {
    assert.match(SOURCE, /assertServiceRoleKey\(serviceRoleKey,\s*['"]export-data['"]\)/);
    assert.match(SOURCE, /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/);
  });

  it("subjects the export to the authenticated caller, never a body-supplied id", () => {
    assert.match(SOURCE, /const userId = auth\.user\.id/);
    assert.doesNotMatch(SOURCE, /userId\s*=\s*payload/);
  });

  it("reads under the service-role admin client", () => {
    assert.match(SOURCE, /createClient\(supabaseUrl,\s*serviceRoleKey\)/);
  });

  it("exports every user-owned table scoped to the caller", () => {
    // profile by id; collections/items/subscriptions by owner; friend_requests
    // + chat_messages by both directions.
    assert.match(SOURCE, /from\(['"]profiles['"]\)[\s\S]*?\.eq\(['"]id['"],\s*userId\)/);
    assert.match(SOURCE, /from\(['"]collections['"]\)[\s\S]*?\.eq\(['"]owner_user_id['"],\s*userId\)/);
    assert.match(SOURCE, /from\(['"]items['"]\)[\s\S]*?\.eq\(['"]created_by_user_id['"],\s*userId\)/);
    assert.match(SOURCE, /from\(['"]friend_requests['"]\)[\s\S]*?from_user_id\.eq\.\$\{userId\}/);
    assert.match(SOURCE, /from\(['"]chat_messages['"]\)[\s\S]*?to_user_id\.eq\.\$\{userId\}/);
    assert.match(SOURCE, /from\(['"]subscriptions['"]\)[\s\S]*?\.eq\(['"]user_id['"],\s*userId\)/);
  });

  it("fails the export (500) when any table read errors", () => {
    assert.match(SOURCE, /result\.error/);
    assert.match(SOURCE, /500/);
  });

  it("returns the versioned document with a download disposition", () => {
    assert.match(SOURCE, /version:\s*DATA_EXPORT_VERSION/);
    assert.match(SOURCE, /buildDocument\(/);
    assert.match(SOURCE, /Content-Disposition/);
    assert.match(SOURCE, /attachment; filename=/);
  });
});
