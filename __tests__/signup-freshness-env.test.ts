import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  FRESHLY_CREATED_WINDOW_MS,
  isFreshlyCreatedUser,
  shouldTrackSignupOnAuthEvent,
} from "../lib/auth-helpers";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

// EXPO_PUBLIC_SIGNUP_FRESHNESS_WINDOW_MS — env-tunable signup-freshness
// window. The env read lives in lib/auth-context.tsx (react module, mirrors
// EXPO_PUBLIC_PROFILE_CACHE_TTL_MS in lib/social-context.tsx) because
// lib/auth-helpers.ts must stay node-pure; the helpers take the resolved
// window as a parameter, which is what this suite exercises functionally.
describe("signup freshness window — windowMs parameter", () => {
  const now = Date.parse("2026-05-08T12:00:00.000Z");
  const thirtyMinAgo = new Date(now - 30 * 60 * 1000).toISOString();

  it("defaults to the 5-minute constant", () => {
    assert.equal(FRESHLY_CREATED_WINDOW_MS, 300_000);
    // 30-minute-old user is stale under the default window…
    assert.equal(isFreshlyCreatedUser({ created_at: thirtyMinAgo }, now), false);
  });

  it("a widened window accepts a user the default would reject", () => {
    const hour = 60 * 60 * 1000;
    assert.equal(
      isFreshlyCreatedUser({ created_at: thirtyMinAgo }, now, hour),
      true,
    );
  });

  it("a narrowed window rejects a user the default would accept", () => {
    const fourMinAgo = new Date(now - 4 * 60 * 1000).toISOString();
    assert.equal(isFreshlyCreatedUser({ created_at: fourMinAgo }, now), true);
    assert.equal(
      isFreshlyCreatedUser({ created_at: fourMinAgo }, now, 60_000),
      false,
    );
  });

  it("shouldTrackSignupOnAuthEvent forwards the window to the freshness check", () => {
    const hour = 60 * 60 * 1000;
    const user = { id: "user-1", created_at: thirtyMinAgo };
    assert.equal(
      shouldTrackSignupOnAuthEvent("SIGNED_IN", user, new Set(), now),
      false,
      "stale under the default window",
    );
    assert.equal(
      shouldTrackSignupOnAuthEvent("SIGNED_IN", user, new Set(), now, hour),
      true,
      "fresh under a widened window",
    );
  });
});

describe("EXPO_PUBLIC_SIGNUP_FRESHNESS_WINDOW_MS — auth-context wiring", () => {
  const src = read("lib/auth-context.tsx");

  it("reads the env var via a literal member access (Metro inlining rule)", () => {
    assert.match(src, /process\.env\.EXPO_PUBLIC_SIGNUP_FRESHNESS_WINDOW_MS/);
    assert.doesNotMatch(src, /process\.env\[/);
  });

  it("resolves via resolveNumericEnv with the helpers' constant as default", () => {
    assert.match(
      src,
      /SIGNUP_FRESHNESS_WINDOW_MS\s*=\s*resolveNumericEnv\(\s*process\.env\.EXPO_PUBLIC_SIGNUP_FRESHNESS_WINDOW_MS\s*,\s*FRESHLY_CREATED_WINDOW_MS\s*,?\s*\)/,
      "the window must fall back to FRESHLY_CREATED_WINDOW_MS so unset env keeps today's behaviour",
    );
  });

  it("threads the resolved window into both signup detection call sites", () => {
    const detectorCalls = src.match(/SIGNUP_FRESHNESS_WINDOW_MS/g) ?? [];
    // 1 declaration + the onAuthStateChange detector + the verifyEmailOtp gate.
    assert.ok(
      detectorCalls.length >= 3,
      "both isFreshlyCreatedUser and shouldTrackSignupOnAuthEvent call sites must receive the resolved window",
    );
    assert.match(
      src,
      /isFreshlyCreatedUser\(freshUser, Date\.now\(\), SIGNUP_FRESHNESS_WINDOW_MS\)/,
      "verifyEmailOtp must pass the resolved window",
    );
  });
});

describe("EXPO_PUBLIC_SIGNUP_FRESHNESS_WINDOW_MS is discoverable in operator docs", () => {
  it("README-DEPLOY.md lists the variable with default + staging guidance", () => {
    const src = read("README-DEPLOY.md");
    assert.match(src, /`EXPO_PUBLIC_SIGNUP_FRESHNESS_WINDOW_MS`/);
    assert.match(src, /300000/);
    assert.match(src, /signup_completed/);
  });

  it(".env.example includes the variable with the default documented", () => {
    const src = read(".env.example");
    assert.match(src, /^EXPO_PUBLIC_SIGNUP_FRESHNESS_WINDOW_MS=/m);
    assert.match(src, /300000|5 minutes?/i);
  });
});
