import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * SEC-5a — structural assertions on the `cloudSignUpload` client wrapper in
 * `lib/supabase-cloudinary.ts`. The module imports the app's `@/` alias
 * (react-native / Supabase singletons) so it isn't executed in node; instead we
 * pin the composition contract: it POSTs to the `sign-upload` endpoint with the
 * user token, coerces the response with the pure `parseSignedUpload`, and bails
 * to `null` (so the caller can fall back to the unsigned preset) without a
 * session / when Supabase is unconfigured / on any error.
 */

const WRAPPER_PATH = path.join(process.cwd(), "lib", "supabase-cloudinary.ts");

function readSrc(): string {
  return readFileSync(WRAPPER_PATH, "utf8");
}

describe("cloudSignUpload — structural composition (SEC-5a)", () => {
  it("declares cloudSignUpload(...) returning Promise<SignedUploadParams | null>", () => {
    const src = readSrc();
    assert.match(src, /export\s+async\s+function\s+cloudSignUpload\s*\(/);
    assert.match(src, /cloudSignUpload[\s\S]*?Promise<SignedUploadParams \| null>/);
  });

  it("POSTs to the sign-upload Edge Function endpoint", () => {
    const src = readSrc();
    assert.match(src, /signUploadUrl\s*\(\s*supabaseUrl!\s*\)/);
    assert.match(src, /method\s*:\s*["']POST["']/);
  });

  it("requires a real user token — bails out (null) when none is available", () => {
    const src = readSrc();
    assert.match(src, /if\s*\(!token\)\s*return null/);
  });

  it("short-circuits to null when Supabase is not configured", () => {
    const src = readSrc();
    assert.match(src, /if\s*\(!isSupabaseConfigured\)\s*return null/);
  });

  it("coerces the response through parseSignedUpload and never throws", () => {
    const src = readSrc();
    assert.match(src, /return parseSignedUpload\(await res\.json\(\)\)/);
    assert.match(src, /if\s*\(!res\.ok\)\s*return null/);
    assert.match(src, /catch\s*\(err\)\s*\{[\s\S]*captureException[\s\S]*return null/);
  });

  it("threads the optional fetcher + tokenProvider injection", () => {
    const src = readSrc();
    assert.match(
      src,
      /fetcher\s*=\s*fetch\s+as\s+FetchFn[\s\S]*?tokenProvider\s*=\s*getAccessToken/,
    );
  });

  it("reuses the SEC-5a pure shape helpers (single source of truth)", () => {
    const src = readSrc();
    assert.match(src, /from "@\/lib\/cloudinary-signed-upload"/);
    assert.match(src, /signUploadUrl/);
    assert.match(src, /parseSignedUpload/);
  });
});
