import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Structural guards for `closeSharedRealtimeClient` — `lib/supabase-realtime.ts`
 * imports `@/lib/supabase` which pulls in react-native peers, so the actual
 * module can't run under node-tests. Same pattern as `realtime-kill-switch.test.ts`.
 */

describe("closeSharedRealtimeClient (lib/supabase-realtime.ts)", () => {
  const src = read("lib/supabase-realtime.ts");

  it("is exported with an async signature", () => {
    assert.match(
      src,
      /export\s+async\s+function\s+closeSharedRealtimeClient\(\s*\)\s*:\s*Promise<void>/,
    );
  });

  it("nulls the cached client BEFORE awaiting disconnect (re-entrancy safe)", () => {
    // If we awaited disconnect first, a concurrent `getSharedRealtimeClient`
    // call during the in-flight teardown would hand out the dying socket.
    // Clearing the slot up front means the next call constructs a fresh one.
    assert.match(
      src,
      /closeSharedRealtimeClient[\s\S]*?sharedRealtimeClient\s*=\s*null;\s*\n\s*try\s*\{\s*\n\s*await\s+client\.disconnect\(\)/,
    );
  });

  it("is a no-op when no client has been constructed yet", () => {
    // Without this guard, sign-out on a never-authenticated session would
    // throw on `null.disconnect()`.
    assert.match(
      src,
      /closeSharedRealtimeClient[\s\S]*?if\s*\(!client\)\s*return;/,
    );
  });

  it("swallows disconnect errors so sign-out is never blocked by network teardown", () => {
    // Best-effort: a flaky WebSocket close must not break the auth flow.
    assert.match(
      src,
      /closeSharedRealtimeClient[\s\S]*?try\s*\{[\s\S]*?await\s+client\.disconnect\(\)[\s\S]*?\}\s*catch\s*\{[\s\S]*?\}/,
    );
  });
});

describe("auth-context wires closeSharedRealtimeClient into signOut + deleteAccount", () => {
  const src = read("lib/auth-context.tsx");

  it("imports closeSharedRealtimeClient from supabase-realtime", () => {
    assert.match(
      src,
      /import\s*\{\s*closeSharedRealtimeClient\s*\}\s*from\s*"@\/lib\/supabase-realtime"/,
    );
  });

  it("calls closeSharedRealtimeClient after authClient.signOut() in signOut", () => {
    // Order matters: authClient.signOut() invalidates the access token, so
    // the disconnect runs against a guaranteed-stale session.
    assert.match(
      src,
      /signOut:\s*async[\s\S]*?await\s+authClient\.signOut\(\);\s*\n\s*await\s+closeSharedRealtimeClient\(\)/,
    );
  });

  it("calls closeSharedRealtimeClient after authClient.signOut() in deleteAccount", () => {
    // Same ordering invariant on the account-deletion path so the socket
    // doesn't outlive the user it was authenticated for.
    //
    // The deletion path's five steps moved into `lib/delete-account-flow.ts`
    // on 2026-10-19 (it was one `try … finally` with no `catch`, so any
    // rejection threw past this provider AND past `app/settings.tsx`). The
    // pair is now the provider's `signOut` STEP, and the local `client` is
    // `authClient` captured after the non-null check, because narrowing does
    // not survive into a callback. Same invariant, same order, one indirection
    // named here rather than a dropped case.
    assert.match(
      src,
      /const client = authClient;/,
      "the step must close over the checked authClient, not a re-read of it",
    );
    assert.match(
      src,
      /signOut:\s*async\s*\(\)\s*=>\s*\{\s*await\s+client\.signOut\(\);\s*await\s+closeSharedRealtimeClient\(\);\s*\}/,
    );
    assert.match(
      src,
      /await runDeleteAccount\(\{[\s\S]*?signOut:/,
      "the step must be the one runDeleteAccount runs",
    );
  });
});
