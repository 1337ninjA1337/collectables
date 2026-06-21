import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-22b — structural assertions on the `cloudValidatePremium` client wrapper
 * in `lib/supabase-subscriptions.ts`. The module imports the app's `@/` alias
 * (react-native / Supabase singletons) so it isn't executed in node; instead we
 * pin the composition contract: it POSTs to the `validate-premium` endpoint with
 * the user token, builds the body via the pure `validatePremiumPayload` shape,
 * coerces the response with `parseValidation`, and bails to `null` without a
 * real session.
 */

const WRAPPER_PATH = path.join(process.cwd(), "lib", "supabase-subscriptions.ts");

function readSrc(): string {
  return readFileSync(WRAPPER_PATH, "utf8");
}

describe("cloudValidatePremium — structural composition (BE-22b)", () => {
  it("declares cloudValidatePremium(action, ...) returning Promise<PremiumValidation | null>", () => {
    const src = readSrc();
    assert.match(
      src,
      /export\s+async\s+function\s+cloudValidatePremium\s*\(/,
      "cloudValidatePremium must be exported",
    );
    assert.match(src, /cloudValidatePremium[\s\S]*?Promise<PremiumValidation \| null>/);
  });

  it("POSTs to the validate-premium Edge Function endpoint", () => {
    const src = readSrc();
    assert.match(src, /validatePremiumUrl\s*\(\s*supabaseUrl!\s*\)/);
    assert.match(src, /method\s*:\s*["']POST["']/);
    assert.match(src, /body\s*:\s*JSON\.stringify\s*\(\s*validatePremiumPayload\s*\(\s*action\s*\)\s*\)/);
  });

  it("defaults the action to \"validate\"", () => {
    const src = readSrc();
    assert.match(src, /action[^=]*=\s*["']validate["']/);
  });

  it("requires a real user token — bails out (null) when none is available", () => {
    const src = readSrc();
    // The Edge Function calls auth.getUser(); the anon apikey fallback cannot
    // satisfy it, so an absent token must short-circuit to null.
    assert.match(src, /if\s*\(!token\)\s*return null/);
  });

  it("short-circuits to null when Supabase is not configured", () => {
    const src = readSrc();
    assert.match(src, /if\s*\(!isSupabaseConfigured\)\s*return null/);
  });

  it("coerces the response through parseValidation and never throws", () => {
    const src = readSrc();
    assert.match(src, /return parseValidation\(await res\.json\(\)\)/);
    assert.match(src, /if\s*\(!res\.ok\)\s*return null/);
    // A network error is swallowed (caller keeps its cache) and reported.
    assert.match(src, /catch\s*\(err\)\s*\{[\s\S]*captureException[\s\S]*return null/);
  });

  it("threads the optional fetcher + tokenProvider injection", () => {
    const src = readSrc();
    assert.match(
      src,
      /fetcher\s*=\s*fetch\s+as\s+FetchFn[\s\S]*?tokenProvider\s*=\s*getAccessToken/,
      "cloudValidatePremium must accept overridable fetcher + tokenProvider",
    );
  });

  it("reuses the BE-22a pure shape helpers (single source of truth)", () => {
    const src = readSrc();
    assert.match(src, /from "@\/lib\/subscriptions"/);
    assert.match(src, /validatePremiumUrl/);
    assert.match(src, /validatePremiumPayload/);
    assert.match(src, /parseValidation/);
  });
});
