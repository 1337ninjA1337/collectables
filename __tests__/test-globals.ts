import { beforeEach } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { __resetSentryForTests } from "../lib/sentry";

/**
 * Global test bootstrap, preloaded via `--import` from `package.json`'s `test`
 * script. Resets module-scope caches that would otherwise leak between tests.
 *
 * Two module-scope caches are reset before every test:
 *
 *  - `lib/sentry.ts`'s lazily-imported SDK + init state (`sdk`, `initialised`,
 *    `activeConfig`, opt-out, rate limiter) — every Sentry suite used to open
 *    with its own `beforeEach(() => __resetSentryForTests())`; that invocation
 *    now lives here so a future direct test of the Sentry path starts clean
 *    without each suite re-rolling the call. `lib/sentry.ts` only *lazily*
 *    imports the react-native `@sentry/react-native` bridge (inside
 *    `initSentry`), so its module graph is peer-dep-free at load time and this
 *    bootstrap can import the reset helper statically — a direct call that
 *    always fires, independent of module-loader quirks.
 *  - `lib/supabase-realtime.ts`'s `sharedRealtimeClient` — lazily built inside
 *    `getSharedRealtimeClient` and kept for the lifetime of the process, so a
 *    test that constructs it once (today none — all realtime tests are
 *    structural; tomorrow inevitable) would silently hand the cached instance
 *    to the next suite and hide kill-switch / env-override regressions. Unlike
 *    Sentry, this module imports `@/lib/supabase` which pulls react-native
 *    peers transitively, so the bootstrap CANNOT statically import its reset —
 *    node-tests can't resolve the react-native bundle at preload time. Instead
 *    we peek `require.cache` for the module's resolved path: if a downstream
 *    test (with the right mocks) has already loaded it, we invoke the exported
 *    reset; if not, we skip silently. Zero overhead in the "not loaded" case.
 *
 * Add future module-cache resets here once they outgrow per-file `beforeEach`
 * (e.g. `__resetAnalyticsForTests`): a direct static import when the module is
 * peer-dep-free, or the `require.cache` peek when it pulls react-native.
 */
const require = createRequire(import.meta.url);

/**
 * Invoke a named reset export on a module IF a downstream test has already
 * loaded it into `require.cache`. Silent no-op otherwise — a missing cache
 * entry, a missing export, or a throwing `require.cache` access must never
 * break the many structural tests that don't touch the module. Reserved for
 * modules that pull react-native peers and so can't be statically imported
 * here (currently only `lib/supabase-realtime.ts`).
 */
function tryInvokeCachedReset(modulePath: string, exportName: string): void {
  let cached: NodeJS.Require["cache"][string] | undefined;
  try {
    cached = require.cache[modulePath];
  } catch {
    // require.cache can throw in unusual loader environments; skip silently.
    return;
  }
  const reset = (cached?.exports as Record<string, unknown> | undefined)?.[
    exportName
  ];
  if (typeof reset === "function") {
    (reset as () => void)();
  }
}

const REALTIME_MODULE_PATH = path.join(
  process.cwd(),
  "lib",
  "supabase-realtime.ts",
);

beforeEach(() => {
  __resetSentryForTests();
  tryInvokeCachedReset(
    REALTIME_MODULE_PATH,
    "__resetSharedRealtimeClientForTests",
  );
});
