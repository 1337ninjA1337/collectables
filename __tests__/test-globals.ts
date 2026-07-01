import { beforeEach } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Global test bootstrap, preloaded via `--import` from `package.json`'s `test`
 * script. Resets module-scope caches that would otherwise leak between tests.
 *
 * Two module-scope caches are reset before every test:
 *
 *  - `lib/supabase-realtime.ts`'s `sharedRealtimeClient` — lazily built inside
 *    `getSharedRealtimeClient` and kept for the lifetime of the process, so a
 *    test that constructs it once (today none — all realtime tests are
 *    structural; tomorrow inevitable) would silently hand the cached instance
 *    to the next suite and hide kill-switch / env-override regressions.
 *  - `lib/sentry.ts`'s lazily-imported SDK + init state (`sdk`, `initialised`,
 *    `activeConfig`, opt-out, rate limiter) — every Sentry suite used to open
 *    with its own `beforeEach(() => __resetSentryForTests())`; that invocation
 *    now lives here so a future direct test of the Sentry path starts clean
 *    without each suite re-rolling the call.
 *
 * Both modules pull react-native peers transitively (`@/lib/supabase` for the
 * realtime module; the lazy `@sentry/react-native` bridge for Sentry), so this
 * bootstrap CANNOT statically import their reset helpers — node-tests can't
 * resolve the react-native bundle at preload time. Instead, every tick we peek
 * at `require.cache` for the module's resolved path: if a downstream test (with
 * the right mocks) has already loaded it, we invoke the exported reset; if not,
 * we skip silently. Zero overhead in the "no test loaded the module" case,
 * automatic in the "did load" case.
 *
 * Add future module-cache resets here once they outgrow per-file `beforeEach`
 * (e.g. `__resetAnalyticsForTests`).
 */
const require = createRequire(import.meta.url);

/**
 * Invoke a named reset export on a module IF a downstream test has already
 * loaded it into `require.cache`. Silent no-op otherwise — a missing cache
 * entry, a missing export, or a throwing `require.cache` access must never
 * break the many structural tests that don't touch the module.
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

const SENTRY_MODULE_PATH = path.join(process.cwd(), "lib", "sentry.ts");

beforeEach(() => {
  tryInvokeCachedReset(
    REALTIME_MODULE_PATH,
    "__resetSharedRealtimeClientForTests",
  );
  tryInvokeCachedReset(SENTRY_MODULE_PATH, "__resetSentryForTests");
});
