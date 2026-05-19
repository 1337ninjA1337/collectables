import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("VIEWER_PROFILE_TTL_MS env override", () => {
  const src = read("lib/social-context.tsx");

  it("keeps the historical 10-minute default", () => {
    assert.match(src, /DEFAULT_VIEWER_PROFILE_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  });

  it("reads the EXPO_PUBLIC_PROFILE_CACHE_TTL_MS env var via a literal member access", () => {
    // Must stay a literal `process.env.EXPO_PUBLIC_*` so Metro/babel inlines it
    // into the web bundle. A computed lookup would read undefined in production.
    assert.match(src, /process\.env\.EXPO_PUBLIC_PROFILE_CACHE_TTL_MS/);
  });

  it("derives VIEWER_PROFILE_TTL_MS via the shared resolveNumericEnv helper", () => {
    assert.match(
      src,
      /VIEWER_PROFILE_TTL_MS\s*=\s*resolveNumericEnv\(\s*process\.env\.EXPO_PUBLIC_PROFILE_CACHE_TTL_MS\s*,\s*DEFAULT_VIEWER_PROFILE_TTL_MS\s*,?\s*\)/,
    );
  });

  it("imports resolveNumericEnv from the centralised env helper", () => {
    assert.match(src, /import\s*\{\s*resolveNumericEnv\s*\}\s*from\s*"@\/lib\/env"/);
  });

  it("no longer re-implements the parse-and-guard dance locally", () => {
    assert.doesNotMatch(src, /function\s+resolveViewerProfileTtlMs/);
    assert.doesNotMatch(src, /Number\.isFinite/);
  });
});
