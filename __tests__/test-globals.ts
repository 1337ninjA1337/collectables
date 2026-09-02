import { beforeEach } from "node:test";
import { createRequire } from "node:module";
import { __resetSentryForTests } from "../lib/sentry";

import { repoPath } from "./helpers/repo-file";

/**
 * Global test bootstrap, preloaded via `--import` from `package.json`'s `test`
 * script. Resets module-scope caches that would otherwise leak between tests.
 *
 * Two kinds of module state are reset here:
 *
 * 1. `lib/sentry.ts` caches the lazily-loaded SDK, the `initialised` flag, the
 *    active config, the opt-out flag and the rate-limiter window at module
 *    scope. Every Sentry suite used to open with its own
 *    `beforeEach(() => __resetSentryForTests())`; a direct test that forgot the
 *    call would inherit the previous suite's `sdk`/`initialised` state and hide
 *    init/opt-out regressions. `lib/sentry.ts` is node-safe (its only imports
 *    are `@/lib/sentry-config` + `@/lib/sliding-window-limiter`; the
 *    `@sentry/react-native` bridge is lazy-loaded inside `initSentry`), so we
 *    can statically import the reset and run it in the global `beforeEach`.
 *
 * 2. The realtime path's `sharedRealtimeClient` is lazily built inside
 *    `getSharedRealtimeClient` and kept for the lifetime of the process, so a
 *    test that constructs it once (today none — all realtime tests are
 *    structural; tomorrow inevitable) would silently hand the cached instance
 *    to the next suite and hide kill-switch / env-override regressions.
 *    `lib/supabase-realtime.ts` imports `@/lib/supabase` which pulls in
 *    react-native peers, so this bootstrap CANNOT statically import that reset
 *    helper — node-tests can't resolve the react-native bundle. Instead, every
 *    tick we peek at `require.cache` for the realtime module's resolved path:
 *    if a downstream test (with the right mocks) has already loaded it, we
 *    invoke the exported reset; if not, we skip silently. Zero overhead in the
 *    "no test loaded the realtime path" case, automatic in the "did load" case.
 *
 * Add future module-cache resets here once they outgrow per-file `beforeEach`
 * (e.g. `__resetAnalyticsForTests`): prefer the static-import path when the
 * module is node-safe, fall back to the `require.cache` peek when it drags in
 * react-native peers.
 */
const require = createRequire(import.meta.url);

/**
 * `npm test` may not reach the network, and this is what enforces it.
 *
 * The audit gate's failure note tells every contributor that it is "the one
 * check here whose answer can change while the repository does not", and
 * `verify-gate-script.test.ts` measures that by scanning the gate's 27 CLI
 * wrappers for a remote read. The suites were the hole in it: `npm test` runs
 * 1420 files, they stub `fetch` by name in dozens of places, and a marker scan
 * cannot tell a stub from a call — so the leg most likely to acquire a real
 * request was the one leg nothing looked at.
 *
 * A scan was never going to answer this. Whether a call goes out is a runtime
 * question, so it is answered at runtime: the global is replaced before any
 * suite loads, and a request that reaches it throws instead of leaving.
 *
 * STUBBING STILL WORKS, and that is the design rather than a leak. A suite
 * that assigns its own `globalThis.fetch` has said what the response is; what
 * this refuses is the call NOBODY stubbed, which is the one that would go out
 * to a real host. A suite that saves and restores the global puts this back.
 *
 * The honest limit: `node:http`, `node:https` and anything spawning `curl` are
 * untouched. Nothing here uses them and the same runtime argument would apply
 * if something did — this is the shape a second refusal would take, not a
 * claim that one is unnecessary.
 */
function refuseNetwork(input: unknown): never {
  const target =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : ((input as { url?: string } | null)?.url ?? "an unnamed request");
  throw new Error(
    `A test tried to fetch ${target}. The suites are a leg of \`npm run verify\` and every leg but the audit gate answers the same for the same commit next year — a real request breaks that, and makes this suite fail on somebody else's outage. Stub \`globalThis.fetch\` for the case that needs a response; __tests__/test-globals.ts installed this refusal.`,
  );
}

globalThis.fetch = refuseNetwork as unknown as typeof globalThis.fetch;

const REALTIME_MODULE_PATH = repoPath("lib", "supabase-realtime.ts");

interface RealtimeModuleExports {
  __resetSharedRealtimeClientForTests?: () => void;
}

function tryResetSharedRealtimeClient(): void {
  let cached: NodeJS.Require["cache"][string] | undefined;
  try {
    cached = require.cache[REALTIME_MODULE_PATH];
  } catch {
    // require.cache can throw in unusual loader environments; skip silently.
    return;
  }
  const reset = (cached?.exports as RealtimeModuleExports | undefined)
    ?.__resetSharedRealtimeClientForTests;
  if (typeof reset === "function") {
    reset();
  }
}

beforeEach(() => {
  __resetSentryForTests();
  tryResetSharedRealtimeClient();
});
