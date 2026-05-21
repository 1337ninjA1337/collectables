import { beforeEach } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Global test bootstrap, preloaded via `--import` from `package.json`'s `test`
 * script. Resets module-scope caches that would otherwise leak between tests.
 *
 * The realtime path's `sharedRealtimeClient` is the canonical case: lazily
 * built inside `getSharedRealtimeClient` and kept for the lifetime of the
 * process, so a test that constructs it once (today none — all realtime
 * tests are structural; tomorrow inevitable) would silently hand the cached
 * instance to the next suite and hide kill-switch / env-override regressions.
 *
 * `lib/supabase-realtime.ts` imports `@/lib/supabase` which pulls in
 * react-native peers, so this bootstrap CANNOT statically import the reset
 * helper — node-tests can't resolve the react-native bundle. Instead, every
 * tick we peek at `require.cache` for the realtime module's resolved path:
 * if a downstream test (with the right mocks) has already loaded it, we
 * invoke the exported reset; if not, we skip silently. Zero overhead in the
 * "no test loaded the realtime path" case, automatic in the "did load" case.
 *
 * Add future module-cache resets here once they outgrow per-file `beforeEach`
 * (e.g. `__resetSentryForTests`, `__resetAnalyticsForTests`).
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
  tryResetSharedRealtimeClient();
});
