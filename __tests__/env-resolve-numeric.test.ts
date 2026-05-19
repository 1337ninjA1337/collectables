import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// `lib/env.ts` imports react-native (`Platform`) at module scope, so it can't
// be imported in the node test runner. Mirrors the structural-test pattern
// already used by `sentry-env-inlining.test.ts` / `viewer-profile-ttl.test.ts`.
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("resolveNumericEnv (lib/env.ts)", () => {
  const src = read("lib/env.ts");

  it("is exported with a (rawValue, defaultValue) signature", () => {
    assert.match(
      src,
      /export function resolveNumericEnv\(\s*rawValue:\s*string\s*\|\s*undefined\s*,\s*defaultValue:\s*number\s*\):\s*number/,
    );
  });

  it("takes the raw value, not a var name (Metro can only inline literal process.env.X)", () => {
    // A `process.env[varName]` computed lookup would not be inlined by
    // Metro/babel and would read undefined in the web bundle — the same
    // foot-gun guarded by sentry-env-inlining.test.ts.
    assert.doesNotMatch(src, /process\.env\[/);
  });

  it("falls back to the default for empty / missing values", () => {
    assert.match(src, /if\s*\(!rawValue\)\s*return\s+defaultValue/);
  });

  it("falls back to the default for non-finite / non-positive numbers", () => {
    assert.match(src, /Number\(rawValue\)/);
    assert.match(src, /!Number\.isFinite\(parsed\)\s*\|\|\s*parsed\s*<=\s*0/);
    assert.match(src, /return\s+defaultValue/);
  });

  it("returns the parsed number on the happy path", () => {
    assert.match(src, /return\s+parsed;/);
  });
});
