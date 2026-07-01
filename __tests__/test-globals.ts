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
 * (e.g. `__resetAnalyticsForTests`).
 *
 * `lib/sentry.ts` is the first such graduation: its module-scope `sdk` /
 * `initialised` / `activeConfig` / rate-limiter cache leaked between suites
 * unless every sentry test file re-declared `beforeEach(() =>
 * __resetSentryForTests())`. It reaches its config via the `@/` alias, so —
 * exactly like the realtime module — it can't be statically imported at
 * preload time; we peek `require.cache` for its resolved path and invoke the
 * exported reset only once a downstream test has loaded it (silent no-op
 * otherwise, zero overhead for the non-sentry test files).
 */
const require = createRequire(import.meta.url);

function tryInvokeCachedReset<K extends string>(
  moduleRelPath: readonly string[],
  exportName: K,
): void {
  const modulePath = path.join(process.cwd(), ...moduleRelPath);
  let cached: NodeJS.Require["cache"][string] | undefined;
  try {
    cached = require.cache[modulePath];
  } catch {
    // require.cache can throw in unusual loader environments; skip silently.
    return;
  }
  const exports = cached?.exports as Record<K, unknown> | undefined;
  const reset = exports?.[exportName];
  if (typeof reset === "function") {
    reset();
  }
}

function tryResetSharedRealtimeClient(): void {
  tryInvokeCachedReset(
    ["lib", "supabase-realtime.ts"],
    "__resetSharedRealtimeClientForTests",
  );
}

function tryResetSentry(): void {
  tryInvokeCachedReset(["lib", "sentry.ts"], "__resetSentryForTests");
}

beforeEach(() => {
  tryResetSharedRealtimeClient();
  tryResetSentry();
});
