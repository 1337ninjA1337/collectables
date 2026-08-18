import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readRepoFile } from "./helpers/repo-file";
import { readSource, sourceFiles } from "./helpers/source-files";

/**
 * Hard requirement: the ~120 KB `@sentry/react-native` native bridge is only
 * ever loaded through `lib/sentry.ts`'s lazy `import()` path, which runs
 * strictly after the `config.enabled` gate — so dev/test/opted-out bundles
 * never pay for it at startup.
 *
 * The single sanctioned exception is `app/_layout.tsx`: `Sentry.wrap()` and
 * `<ErrorBoundary>` must wrap the root component at module scope (deferring
 * them would lose render-error coverage during boot), so its static import
 * is allowlisted. Everything else must go through `@/lib/sentry`.
 */

const sentrySource = readRepoFile("lib", "sentry.ts");

const STATIC_IMPORT = /import[^;]*from\s+["']@sentry\/react-native["']/;
const ALLOWLIST = ["app/_layout.tsx"];

/** The app-code directories a static SDK import would cost startup in. */
const APP_CODE_DIRS = ["app", "components", "lib", "data"] as const;

describe("sentry lazy-import invariant", () => {
  it("lib/sentry.ts loads the SDK via dynamic import only", () => {
    // Matches both the direct `await import(...)` shape and the
    // makeLazyLoader thunk shape `() => import(...)` — the invariant is a
    // dynamic import with a static string specifier, however it's awaited.
    assert.ok(
      sentrySource.includes('import("@sentry/react-native")'),
      "the lazy loader must dynamic-import the SDK",
    );
    assert.ok(
      !STATIC_IMPORT.test(sentrySource),
      "lib/sentry.ts must never gain a static @sentry/react-native import",
    );
  });

  it("the enabled gate runs before the loader can execute", () => {
    const gate = sentrySource.indexOf("if (!config.enabled)");
    const load = sentrySource.indexOf("options.loader ?? defaultLoader");
    assert.ok(gate !== -1, "runInit must gate on config.enabled");
    assert.ok(load !== -1, "runInit must resolve the loader");
    assert.ok(
      gate < load,
      "the config.enabled early-return must precede the loader call — a disabled config must never load the native bridge",
    );
  });

  it("no app code statically imports the SDK outside the allowlist", () => {
    const offenders = sourceFiles(...APP_CODE_DIRS)
      .filter((rel) => STATIC_IMPORT.test(readSource(rel)))
      .sort();
    assert.deepEqual(
      offenders,
      [...ALLOWLIST].sort(),
      "static @sentry/react-native imports are only sanctioned in app/_layout.tsx (Sentry.wrap + ErrorBoundary must wrap the root at module scope); route everything else through @/lib/sentry",
    );
  });

  it("the allowlisted layout uses the static import for wrap/boundary only", () => {
    const layout = readRepoFile("app", "_layout.tsx");
    assert.ok(layout.includes("Sentry.wrap("), "layout must use Sentry.wrap");
    assert.ok(layout.includes("<ErrorBoundary"), "layout must render the boundary");
    assert.ok(
      !layout.includes("Sentry.init("),
      "SDK initialisation must stay inside lib/sentry.ts's gated lazy path, never the static layout import",
    );
  });
});
