import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * SEC-9 — structural assertions on the shared `assertCaller` Edge-Function
 * gate. It runs under Deno (it imports `createClient` from esm.sh and reads
 * `Deno.env`), so — like every other Edge Function — it is covered by
 * source-level invariants rather than executed in Node:
 *   - it reads the `Authorization` header and 401s on a missing one;
 *   - it runs the BE-23 anon-key self-check before building the user client;
 *   - it verifies the session via `auth.getUser()` and 401s on an invalid one;
 *   - it throws a typed `CallerAuthError` carrying the HTTP status; and
 *   - every privileged function adopts it instead of re-implementing the gate.
 */

const SHARED_PATH = path.join(
  process.cwd(),
  "supabase",
  "functions",
  "_shared",
  "assert-caller.ts",
);

const SOURCE = readFileSync(SHARED_PATH, "utf8");

const ADOPTERS = [
  "delete-account",
  "delete-image",
  "claim-listing",
  "accept-friend-request",
  "validate-premium",
  "export-data",
];

describe("_shared/assert-caller helper", () => {
  it("exists at the documented shared path", () => {
    assert.ok(statSync(SHARED_PATH).isFile());
  });

  it("exports assertCaller, CallerAuthError and re-exports ServiceRoleClaimError", () => {
    assert.match(SOURCE, /export\s+async\s+function\s+assertCaller\s*\(/);
    assert.match(SOURCE, /export\s+class\s+CallerAuthError\s+extends\s+Error/);
    assert.match(SOURCE, /export\s*\{\s*ServiceRoleClaimError\s*\}/);
  });

  it("CallerAuthError carries an HTTP status", () => {
    assert.match(SOURCE, /readonly\s+status:\s*number/);
    assert.match(SOURCE, /new CallerAuthError\(401,/);
  });

  it("reads the Authorization header and 401s when it is missing", () => {
    assert.match(SOURCE, /req\.headers\.get\(["']Authorization["']\)/);
    assert.match(SOURCE, /new CallerAuthError\(401,\s*["']Missing authorization["']\)/);
  });

  it("runs the anon-key self-check before building the user client (BE-23)", () => {
    assert.match(SOURCE, /assertAnonKey\(anonKey,\s*functionName\)/);
    assert.ok(
      SOURCE.indexOf("assertAnonKey") < SOURCE.indexOf("createClient(supabaseUrl, anonKey"),
      "anon-key self-check must precede the user client construction",
    );
  });

  it("verifies the session via auth.getUser() and 401s on an invalid one", () => {
    assert.match(SOURCE, /auth\.getUser\(\)/);
    assert.match(SOURCE, /new CallerAuthError\(401,\s*["']Invalid session["']\)/);
  });

  it("verifies the session BEFORE returning the authenticated caller", () => {
    assert.ok(
      SOURCE.indexOf("auth.getUser()") < SOURCE.lastIndexOf("return {"),
      "getUser() must resolve before the caller is returned",
    );
  });

  it("never builds a service-role/admin client itself (auth only)", () => {
    // The gate proves identity; the privileged client stays in each function.
    assert.doesNotMatch(SOURCE, /SERVICE_ROLE_KEY/);
  });

  for (const name of ADOPTERS) {
    it(`${name} adopts the shared gate instead of re-implementing it`, () => {
      const src = readFileSync(
        path.join(process.cwd(), "supabase", "functions", name, "index.ts"),
        "utf8",
      );
      assert.match(src, /from ["']\.\.\/_shared\/assert-caller\.ts["']/);
      assert.match(src, new RegExp(`assertCaller\\(req,\\s*["']${name}["']\\)`));
      // The duplicated inline gate is gone: the function no longer reads the
      // Authorization header or builds its own user client + getUser() call
      // (docstrings may still *mention* `auth.getUser()`, so match the call).
      assert.doesNotMatch(src, /req\.headers\.get\(["']Authorization["']\)/);
      assert.doesNotMatch(src, /const userClient = createClient/);
      assert.doesNotMatch(src, /userClient\.auth\.getUser/);
    });
  }
});
