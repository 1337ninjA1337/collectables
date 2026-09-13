import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertOnlyTheseMatch } from "./helpers/offence-sweep";
import { readRepoFile } from "./helpers/repo-file";
import { readSource, sourceFiles } from "./helpers/source-files";

/**
 * Hard requirement: the `@sentry/react-native` SDK is only ever loaded through
 * `lib/sentry.ts`'s lazy `import()` path, which runs strictly after the
 * `config.enabled` gate — so dev/test/opted-out bundles never pay for it at
 * startup.
 *
 * The single sanctioned exception is `components/crash-boundary.tsx`, the
 * NATIVE half of the crash shell: `wrap()` and `<ErrorBoundary>` wrap the root
 * component at module scope there, and deferring them would lose render-error
 * coverage during boot on the platform whose bundle is downloaded once.
 *
 * **It used to be `app/_layout.tsx`, and the exemption was costing the web
 * build 838 KiB** — the doc block above said "~120 KB" and meant the native
 * bridge, while the import was pulling `@sentry/core`, `@sentry/browser`,
 * replay and feedback into every page load. `crash-boundary.web.tsx` is a
 * boundary with no SDK in it, so the web bundle now honours the invariant this
 * file has always described.
 */

const sentrySource = readRepoFile("lib", "sentry.ts");

const STATIC_IMPORT = /import[^;]*from\s+["']@sentry\/react-native["']/;
const ALLOWLIST = ["components/crash-boundary.tsx"];

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
    // Both directions, which the sorted deepEqual also gave and the shared
    // sweep now says out loud: an unsanctioned import is the failure everyone
    // expects, and an allowlist entry that stopped importing is the one that
    // leaves a hole nobody would notice — plus the refusals the hand-written
    // loop had no room for (a stateful rule, an empty walk, an allowlist entry
    // the walk never reaches).
    assertOnlyTheseMatch({
      rule: STATIC_IMPORT,
      files: sourceFiles(...APP_CODE_DIRS),
      read: readSource,
      expected: ALLOWLIST,
      subject: "modules",
      what: "statically import @sentry/react-native — sanctioned only in components/crash-boundary.tsx, the native half of the crash shell, where wrap + ErrorBoundary must wrap the root at module scope; everything else routes through @/lib/sentry",
    });
  });

  it("the allowlisted native half uses the static import for wrap/boundary only", () => {
    const native = readRepoFile("components", "crash-boundary.tsx");
    assert.ok(native.includes("wrap(RootComponent)"), "the native half must use Sentry's wrap");
    assert.ok(native.includes("<ErrorBoundary"), "the native half must render the SDK boundary");
    assert.ok(
      !native.includes("Sentry.init("),
      "SDK initialisation must stay inside lib/sentry.ts's gated lazy path, never the static crash-shell import",
    );
  });

  it("the web half of the crash shell imports no SDK at all", () => {
    // The whole point of the pair: a boundary on web that costs no bytes at
    // page load. A `Platform.OS` branch here would still import the module.
    const web = readRepoFile("components", "crash-boundary.web.tsx");
    // The IMPORTS, not the prose: the file's doc block names the packages it
    // took out of the bundle, which is the sentence a `includes("@sentry/")`
    // sweep would forbid it from writing down.
    assert.ok(
      !/(?:from|import|require)\s*\(?\s*["']@sentry\//.test(web),
      "crash-boundary.web.tsx must not reach the SDK",
    );
    assert.ok(
      web.includes('from "@/lib/sentry"'),
      "the web boundary must still report, through the module that owns the opt-out, the rate limit and scrubPII",
    );
  });
});
