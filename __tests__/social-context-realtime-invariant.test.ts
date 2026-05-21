import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guardrail for the "one socket per app" invariant in `lib/social-context.tsx`.
 *
 * The social context does not subscribe to any realtime channels today, but
 * once presence / profile-update streams ship they MUST route through the
 * shared `getSharedRealtimeClient()` and the fan-out registry — otherwise
 * each open tab would re-open another WebSocket to the same endpoint, which
 * was the exact problem the `lib/supabase-realtime.ts` rework solved.
 *
 * The structural assertion below forbids:
 *   - `new RealtimeClient(...)` constructions in social-context (only
 *     `lib/supabase-realtime.ts` should construct the singleton).
 *   - Direct `@supabase/realtime-js` imports for client construction
 *     (importing `RealtimeChannel`-only TYPES is allowed; what we ban is the
 *     value-side `RealtimeClient` import).
 *   - Direct `client.channel(topic).subscribe(...)` calls — those belong in
 *     `subscribeShared` so the topic appears in `RealtimeStatusProvider`.
 *
 * Today every regex either trivially passes (because the file is currently
 * realtime-free) or stays passing as long as future subscriptions go through
 * the documented shared path. A future contributor who adds the wrong shape
 * trips this test and gets pointed at the right helper in the assertion
 * message instead of debugging a duplicated-channel bug in production.
 */

describe("social-context realtime invariant", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib", "social-context.tsx"),
    "utf8",
  );

  it("must not construct a RealtimeClient directly", () => {
    assert.doesNotMatch(
      source,
      /new\s+RealtimeClient\s*\(/,
      "social-context must use getSharedRealtimeClient() from @/lib/supabase-realtime",
    );
  });

  it("must not value-import RealtimeClient from @supabase/realtime-js", () => {
    // Forbid `import { RealtimeClient } from "@supabase/realtime-js"` (value
    // import). A pure `import type { … }` of channel/payload types is fine.
    const valueImport = /import\s*\{[^}]*\bRealtimeClient\b[^}]*\}\s*from\s*"@supabase\/realtime-js"/;
    assert.doesNotMatch(
      source,
      valueImport,
      "social-context must consume the shared RealtimeClient via @/lib/supabase-realtime, not construct its own",
    );
  });

  it("must not call client.channel(...).subscribe(...) directly", () => {
    // Direct subscriptions bypass the fan-out registry, which is what
    // surfaces topics in RealtimeStatusProvider. If the future presence /
    // profile-update streams need a channel, they must route through
    // subscribeShared so a) the channel is ref-counted and b) the connection
    // pill picks up its connecting/online transitions automatically.
    assert.doesNotMatch(
      source,
      /\.channel\s*\(\s*[^)]+\)\s*[\s\S]{0,200}\.subscribe\s*\(/,
      "social-context must use subscribeShared from @/lib/realtime-channel-registry",
    );
  });

  it("if it imports the shared client, it must come from @/lib/supabase-realtime", () => {
    // Future-proofing: when subscriptions ship, the only acceptable source
    // of the realtime client is `@/lib/supabase-realtime`. If the import
    // appears, it MUST be from that path; any other import path would be a
    // bug worth catching at CI time.
    const hasGetShared = /getSharedRealtimeClient/.test(source);
    if (!hasGetShared) {
      // No subscriptions yet — invariant trivially holds.
      return;
    }
    assert.match(
      source,
      /from\s+"@\/lib\/supabase-realtime"/,
      "getSharedRealtimeClient must be imported from @/lib/supabase-realtime",
    );
  });

  it("if it adds subscriptions, they must thread through subscribeShared", () => {
    // Same shape as the previous test but for the registry: if any
    // subscription is added, it has to go through the fan-out helper so
    // status events propagate into RealtimeStatusProvider.
    const hasSubscribe = /\bsubscribe\w*Shared\b/.test(source);
    if (!hasSubscribe) {
      return;
    }
    assert.match(
      source,
      /from\s+"@\/lib\/realtime-channel-registry"/,
      "subscribeShared must be imported from @/lib/realtime-channel-registry",
    );
  });
});
