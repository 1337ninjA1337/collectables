import { beforeEach } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { __resetSentryForTests } from "../lib/sentry";

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

const REALTIME_MODULE_PATH = path.join(
  process.cwd(),
  "lib",
  "supabase-realtime.ts",
);

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
