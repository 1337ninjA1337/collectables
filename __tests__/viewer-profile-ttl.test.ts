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

  it("reads the EXPO_PUBLIC_PROFILE_CACHE_TTL_MS env var to override", () => {
    assert.match(src, /process\.env\.EXPO_PUBLIC_PROFILE_CACHE_TTL_MS/);
  });

  it("falls back to the default for non-numeric / non-positive overrides", () => {
    assert.match(src, /Number\.isFinite\(parsed\)/);
    assert.match(src, /parsed\s*<=\s*0/);
  });

  it("derives VIEWER_PROFILE_TTL_MS via the resolver helper", () => {
    assert.match(src, /VIEWER_PROFILE_TTL_MS\s*=\s*resolveViewerProfileTtlMs\(\)/);
  });
});
