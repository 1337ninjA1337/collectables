import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// `lib/supabase-realtime.ts` imports the Supabase realtime SDK + the supabase
// client (which has react-native deps) at module scope so it can't run under
// the node test runner. Structural assertions guard the wiring instead — same
// pattern used by `supabase-realtime-shared.test.ts`.
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("EXPO_PUBLIC_REALTIME_DISABLED kill-switch (lib/supabase-realtime.ts)", () => {
  const src = read("lib/supabase-realtime.ts");

  it("exports an isRealtimeDisabledByEnv parser that accepts truthy literals", () => {
    // The signature mirrors `resolveNumericEnv` / `isBelowRecommendedNumericEnv`
    // in `lib/env.ts` — takes the raw value, not the var name, so Metro's
    // literal-only `process.env.X` inlining keeps working.
    assert.match(
      src,
      /export function isRealtimeDisabledByEnv\(\s*rawValue:\s*string\s*\|\s*undefined\s*,?\s*\):\s*boolean/,
    );
    // Truthy literal whitelist: 1 / true / yes (lower-cased + trimmed).
    assert.match(src, /normalised\s*===\s*"1"/);
    assert.match(src, /normalised\s*===\s*"true"/);
    assert.match(src, /normalised\s*===\s*"yes"/);
  });

  it("returns false on empty / missing values (no accidental opt-in)", () => {
    assert.match(src, /if\s*\(!rawValue\)\s*return\s+false/);
  });

  it("derives REALTIME_DISABLED via the literal env access (Metro-inlining)", () => {
    assert.match(
      src,
      /REALTIME_DISABLED\s*=\s*isRealtimeDisabledByEnv\(\s*process\.env\.EXPO_PUBLIC_REALTIME_DISABLED\s*\)/,
    );
  });

  it("getSharedRealtimeClient short-circuits to null when the kill-switch is on", () => {
    // The kill-switch check must come BEFORE the existing `isSupabaseConfigured`
    // gate — that's the whole point: drop traffic regardless of config.
    assert.match(
      src,
      /export function getSharedRealtimeClient[\s\S]*?if\s*\(REALTIME_DISABLED\)\s*return\s+null;\s*\n\s*if\s*\(!isSupabaseConfigured\)/,
    );
  });

  it("does not use the computed process.env[...] pattern (Metro foot-gun)", () => {
    assert.doesNotMatch(src, /process\.env\[/);
  });

  it("keeps the existing isSupabaseConfigured short-circuit downstream of the kill-switch", () => {
    // Both gates must remain — config-missing returns null AND kill-switch returns null.
    assert.match(src, /isSupabaseConfigured/);
    assert.match(src, /if\s*\(!isSupabaseConfigured\)\s*return\s+null/);
  });
});
