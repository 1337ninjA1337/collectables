import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural integration test pinning that `app/_layout.tsx` uses the new
 * `{ label, run }` shape when calling `registerDevMenu`, so the rendered
 * native DevMenu surfaces "Clear runtime Supabase config" instead of the
 * camelCase identifier.
 */
const LAYOUT_PATH = path.join(process.cwd(), "app", "_layout.tsx");

describe("registerDevMenu per-action labels — wiring", () => {
  it("declares clearRuntimeSupabaseConfig as a { label, run } pair", () => {
    const src = readFileSync(LAYOUT_PATH, "utf8");
    assert.match(
      src,
      /clearRuntimeSupabaseConfig\s*:\s*\{\s*label\s*:\s*"Clear runtime Supabase config"/,
      "must surface the human label to the DevMenu",
    );
    assert.match(
      src,
      /run\s*:\s*clearRuntimeSupabaseConfig/,
      "must thread the helper as `run` so the globalThis fallback key stays unchanged",
    );
  });
});
