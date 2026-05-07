import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("shared realtime client", () => {
  it("lib/supabase-realtime.ts exposes getSharedRealtimeClient", () => {
    const src = read("lib/supabase-realtime.ts");
    assert.match(src, /export\s+function\s+getSharedRealtimeClient/);
    assert.match(src, /sharedRealtimeClient/);
    // The client must short-circuit when Supabase isn't configured.
    assert.match(src, /isSupabaseConfigured/);
  });

  it("memoises the client so repeat calls reuse the same WebSocket", () => {
    const src = read("lib/supabase-realtime.ts");
    // Memoisation pattern: cache the instance + return early on subsequent calls.
    assert.match(src, /if\s*\(\s*sharedRealtimeClient\s*\)\s*return\s+sharedRealtimeClient/);
  });

  it("supabase-chat.ts uses the shared helper instead of constructing its own RealtimeClient", () => {
    const src = read("lib/supabase-chat.ts");
    assert.match(src, /from\s+"@\/lib\/supabase-realtime"/);
    assert.match(src, /getSharedRealtimeClient/);
    // The bespoke `new RealtimeClient(realtimeEndpoint(...), ...)` block should be gone.
    assert.doesNotMatch(src, /new\s+RealtimeClient\(realtimeEndpoint/);
  });

  it("supabase-marketplace.ts uses the shared helper instead of constructing its own RealtimeClient", () => {
    const src = read("lib/supabase-marketplace.ts");
    assert.match(src, /from\s+"@\/lib\/supabase-realtime"/);
    assert.match(src, /getSharedRealtimeClient/);
    assert.doesNotMatch(src, /new\s+RealtimeClient\(realtimeEndpoint/);
  });
});
