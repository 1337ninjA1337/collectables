import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// `lib/env.ts` and `lib/social-context.tsx` both import react-native at module
// scope (Platform / hooks) so they can't be imported by the node test runner.
// We mirror the structural test pattern used by `viewer-profile-ttl.test.ts`
// and `env-resolve-numeric.test.ts`.
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("EXPO_PUBLIC_PROFILE_CACHE_TTL_MS low-TTL helper (lib/env.ts)", () => {
  const src = read("lib/env.ts");

  it("exports the 30s soft-floor constant", () => {
    assert.match(
      src,
      /export const MINIMUM_RECOMMENDED_PROFILE_CACHE_TTL_MS\s*=\s*30_?000/,
    );
  });

  it("exports isBelowRecommendedNumericEnv with a (rawValue, minimum) signature", () => {
    assert.match(
      src,
      /export function isBelowRecommendedNumericEnv\(\s*rawValue:\s*string\s*\|\s*undefined\s*,\s*minimum:\s*number\s*,?\s*\):\s*boolean/,
    );
  });

  it("returns false when no override is set (no warning if unconfigured)", () => {
    assert.match(src, /if\s*\(!rawValue\)\s*return\s+false/);
  });

  it("returns false for non-finite / non-positive values (already filtered by resolver)", () => {
    assert.match(src, /!Number\.isFinite\(parsed\)\s*\|\|\s*parsed\s*<=\s*0/);
  });

  it("returns true only when the parsed value is strictly below the minimum", () => {
    assert.match(src, /return\s+parsed\s*<\s*minimum/);
  });

  it("takes the raw value, not a var name (Metro-inlining foot-gun)", () => {
    // Mirrors the same guarantee enforced for resolveNumericEnv.
    assert.doesNotMatch(src, /process\.env\[/);
  });
});

describe("Social context wires the low-TTL warning toast", () => {
  const src = read("lib/social-context.tsx");

  it("imports the low-TTL helper + minimum constant from @/lib/env", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bisBelowRecommendedNumericEnv\b[^}]*\}\s*from\s*"@\/lib\/env"/,
    );
    assert.match(
      src,
      /import\s*\{[^}]*\bMINIMUM_RECOMMENDED_PROFILE_CACHE_TTL_MS\b[^}]*\}\s*from\s*"@\/lib\/env"/,
    );
  });

  it("imports useToast / useI18n from their canonical providers", () => {
    assert.match(src, /import\s*\{\s*useToast\s*\}\s*from\s*"@\/lib\/toast-context"/);
    assert.match(src, /import\s*\{\s*useI18n\s*\}\s*from\s*"@\/lib\/i18n-context"/);
  });

  it("derives LOW_PROFILE_CACHE_TTL_OVERRIDE via the literal env access (Metro-inlining)", () => {
    assert.match(
      src,
      /LOW_PROFILE_CACHE_TTL_OVERRIDE\s*=\s*isBelowRecommendedNumericEnv\(\s*process\.env\.EXPO_PUBLIC_PROFILE_CACHE_TTL_MS\s*,\s*MINIMUM_RECOMMENDED_PROFILE_CACHE_TTL_MS\s*,?\s*\)/,
    );
  });

  it("guards the toast with a module-scope `shown once per JS-realm` flag", () => {
    // Strict-Mode double-mount / repeated provider remounts must not re-fire.
    assert.match(src, /let\s+lowProfileCacheTtlWarningShown\s*=\s*false/);
    assert.match(
      src,
      /if\s*\(!LOW_PROFILE_CACHE_TTL_OVERRIDE\s*\|\|\s*lowProfileCacheTtlWarningShown\)\s*return/,
    );
    assert.match(src, /lowProfileCacheTtlWarningShown\s*=\s*true/);
  });

  it("calls toast.info with the new profileCacheTtlLow* i18n keys", () => {
    assert.match(
      src,
      /toast\.info\(\s*t\("profileCacheTtlLowMessage"\)\s*,\s*t\("profileCacheTtlLowTitle"\)\s*\)/,
    );
  });

  it("exposes a test-only reset helper so suites can re-arm the warning", () => {
    assert.match(
      src,
      /export function __resetLowProfileCacheTtlWarningForTests\(\)\s*\{[^}]*lowProfileCacheTtlWarningShown\s*=\s*false[^}]*\}/,
    );
  });
});

describe("i18n keys for the low-TTL warning", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares profileCacheTtlLowTitle in the English source map", () => {
    assert.match(src, /profileCacheTtlLowTitle:\s*"Profile cache TTL too low"/);
  });

  it("declares profileCacheTtlLowMessage in the English source map", () => {
    assert.match(src, /profileCacheTtlLowMessage:[\s\S]*?EXPO_PUBLIC_PROFILE_CACHE_TTL_MS/);
  });

  it("each non-English language explicitly translates the title", () => {
    // ru, be, pl, de, es each carry their own override; English is the only
    // language that may rely on the `...en` spread for fallback.
    const matches = src.match(/profileCacheTtlLowTitle:/g) ?? [];
    assert.equal(matches.length, 6, "expected 6 profileCacheTtlLowTitle entries (en + 5 translations)");
  });

  it("each non-English language explicitly translates the message", () => {
    const matches = src.match(/profileCacheTtlLowMessage:/g) ?? [];
    assert.equal(matches.length, 6, "expected 6 profileCacheTtlLowMessage entries (en + 5 translations)");
  });
});
