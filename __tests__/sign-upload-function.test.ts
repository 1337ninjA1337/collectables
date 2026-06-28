import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * SEC-5a — structural assertions on the `sign-upload` Edge Function. It runs
 * under Deno (not Node), so we assert source-level invariants instead of
 * executing it: CORS/405, the BE-23 anon-key self-check, the SEC-9 assertCaller
 * gate, that the per-user folder is derived from the validated session user
 * (never a body id), and that the API secret is used to sign but never returned.
 */

const FUNCTION_PATH = path.join(
  process.cwd(),
  "supabase",
  "functions",
  "sign-upload",
  "index.ts",
);

const SOURCE = readFileSync(FUNCTION_PATH, "utf8");

describe("sign-upload Edge Function", () => {
  it("exists at the documented path", () => {
    assert.ok(statSync(FUNCTION_PATH).isFile());
  });

  it("uses Deno.serve as the entrypoint", () => {
    assert.match(SOURCE, /Deno\.serve\s*\(/);
  });

  it("handles CORS preflight via the shared gate (SEC-10)", () => {
    assert.match(SOURCE, /req\.method\s*===\s*['"]OPTIONS['"]/);
    assert.match(SOURCE, /evaluateCors\(\s*req,/);
    assert.match(SOURCE, /forbiddenOriginResponse\(corsHeaders\)/);
  });

  it("rejects non-POST methods with 405", () => {
    assert.match(SOURCE, /Method not allowed/);
    assert.match(SOURCE, /405/);
  });

  it("self-checks the anon key before any privileged work (BE-23)", () => {
    assert.match(SOURCE, /assertAnonKey\(anonKey,\s*['"]sign-upload['"]\)/);
    assert.match(SOURCE, /function misconfigured/);
  });

  it("delegates the auth handshake to the shared assertCaller gate (SEC-9)", () => {
    assert.match(SOURCE, /import \{ assertCaller \} from ["']\.\.\/_shared\/assert-caller\.ts["']/);
    assert.match(SOURCE, /await assertCaller\(\s*req,\s*corsHeaders,/);
    assert.match(SOURCE, /if \(!auth\.ok\) return auth\.response/);
  });

  it("verifies the caller's session via auth.getUser() before signing", () => {
    assert.match(SOURCE, /auth\.getUser\(\)/);
  });

  it("derives the per-user folder from the validated session user, never a body id", () => {
    assert.match(SOURCE, /uploadFolderForUser\(auth\.user\.id\)/);
    assert.doesNotMatch(SOURCE, /req\.json\(\)/);
  });

  it("reuses the shared pure signature helper (single source of truth)", () => {
    assert.match(
      SOURCE,
      /import \{[\s\S]*cloudinaryUploadSignature[\s\S]*\} from ["']\.\.\/\.\.\/\.\.\/lib\/cloudinary-signed-upload\.ts["']/,
    );
    assert.match(SOURCE, /await cloudinaryUploadSignature\(\s*\{\s*folder,\s*timestamp\s*\}/);
  });

  it("reads CLOUDINARY_API_SECRET from function secrets and never returns it", () => {
    assert.match(SOURCE, /Deno\.env\.get\(['"]CLOUDINARY_API_SECRET['"]\)/);
    // The secret signs the payload but must never appear in any JSON response.
    assert.doesNotMatch(SOURCE, /json\(\{[^}]*apiSecret/);
    assert.doesNotMatch(SOURCE, /apiSecret:/);
  });

  it("returns the narrow { cloudName, apiKey, timestamp, signature, folder } payload", () => {
    assert.match(SOURCE, /json\(\{\s*cloudName,\s*apiKey,\s*timestamp,\s*signature,\s*folder\s*\}/);
  });
});
