/**
 * Generic lazy SDK loader factory shared by `lib/sentry.ts` and
 * `lib/analytics.ts` (and any future telemetry wrapper — Clarity,
 * Crashlytics…).
 *
 * Both wrappers hand-rolled the same shape: a `defaultLoader` that
 * dynamic-imports the SDK (so dev/test bundles never pay the native-bridge
 * cost) plus an `InitOptions.loader` override for tests. This factory
 * centralises it and adds memoisation: the module promise is cached at the
 * loader level, so a re-init after shutdown (e.g. diagnostics toggle
 * off→on, or a future runtime config refresh) reuses the already-resolved
 * module instead of re-resolving it from disk — mirroring how
 * `getSharedRealtimeClient` memoises the WebSocket client. A FAILED import
 * is not cached, so a transient loader error (native bridge racing startup)
 * can retry on the next init.
 *
 * Keep the `import("literal-specifier")` inside the `importModule` thunk —
 * Metro only code-splits dynamic imports with static string specifiers.
 *
 * Pure module: no React Native imports, unit-testable under `node --test`.
 */
export function makeLazyLoader<TModule, TExport>(
  importModule: () => Promise<TModule>,
  pickExport: (mod: TModule) => TExport,
): () => Promise<TExport> {
  let cached: Promise<TExport> | null = null;
  return () => {
    if (!cached) {
      cached = importModule().then(pickExport);
      cached.catch(() => {
        // Reset so the next call retries instead of replaying the rejection.
        cached = null;
      });
    }
    return cached;
  };
}
