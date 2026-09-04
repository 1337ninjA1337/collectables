import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
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
 * ALL FOUR MARKERS, because the audit gate's scan names four ways a script
 * here reaches outside the tree and a refusal that covered one of them would
 * leave the other three exactly as invisible as `fetch` was: a `fetch` call,
 * an http/https client, and a spawned network tool. The fourth — `npm audit`
 * itself — is the gate that is allowed to.
 *
 * PATCHED ON THE MODULE OBJECT, and a named import is covered too — which is
 * a fact about this runner rather than about JavaScript. `tsx` transpiles the
 * suites to CommonJS, so `import { request } from "node:https"` compiles to a
 * property read at CALL time and sees the patch; under a native-ESM runner it
 * would be a binding made when the builtin was first evaluated, and would not.
 * A case pins the named-import shape, so the day that changes it goes red
 * rather than going quiet.
 */
function refuseNetwork(what: string, target: string): never {
  throw new Error(
    `A test tried to ${what} ${target}. The suites are a leg of \`npm run verify\` and every leg but the audit gate answers the same for the same commit next year — a real request breaks that, and makes this suite fail on somebody else's outage. Stub the call for the case that needs a response; __tests__/test-globals.ts installed this refusal.`,
  );
}

/** The URL out of all three shapes `fetch` takes, for a message worth reading. */
function requested(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as { url?: string } | null)?.url ?? "an unnamed request";
}

globalThis.fetch = ((input: unknown) =>
  refuseNetwork("fetch", requested(input))) as unknown as typeof globalThis.fetch;

/**
 * `http.request`, `http.get` and their https twins.
 *
 * Patched on the module object rather than replaced by a loader hook: node's
 * own runner and `tsx` load these too, and a refusal that took the module out
 * from under them would fail the run for a reason that is not a test's.
 */
for (const client of [http, https] as const) {
  for (const method of ["request", "get"] as const) {
    const mutable = client as unknown as Record<string, unknown>;
    mutable[method] = (input: unknown) =>
      refuseNetwork(`open an http connection to`, requested(input));
  }
}

/**
 * How many times this module body has run in this process.
 *
 * The refusal is installed by side effect: `globalThis.fetch` is replaced and
 * every spawn method is wrapped around the one it found. Running the body twice
 * wraps the wrappers — the refusal still fires, every identity check in
 * `network-refusal.test.ts` compares against whatever it found at import, and
 * nothing anywhere goes red. A suite imports this module now (for
 * `networkTool`), so "the same instance the `--import` loaded" went from a
 * property nobody could break to one a specifier could, proved by hand once.
 *
 * The count lives on `globalThis` under a REGISTERED symbol rather than in a
 * module-scope `let`: two instances of this module would each have their own
 * `let` and each answer one, which is the answer that hides the problem.
 */
const INSTANCES = Symbol.for("collectables/test-globals#instances");
const globalCounts = globalThis as unknown as Record<symbol, number | undefined>;
globalCounts[INSTANCES] = (globalCounts[INSTANCES] ?? 0) + 1;

/** How many times this bootstrap has been evaluated in this process. */
export function bootstrapInstances(): number {
  return globalCounts[INSTANCES] ?? 0;
}

/**
 * A spawned tool that reaches a remote, which is how code gets out of the tree
 * without importing anything at all.
 *
 * `curl` and `wget` are the obvious two. `npm` and `npx` are here because the
 * scan's other two markers are exactly those spawns — `npm audit` asking the
 * registry about advisories, `npx expo install --check` asking it about
 * versions — and a refusal that covered two of the scan's four shapes would
 * leave the same hole one level down. No suite spawns either; the guard
 * fixtures run `node --import tsx` directly, which is a read of this tree.
 *
 * The tool NAME only. Refusing spawning outright would break those fixtures,
 * which run `node`, `tsx` and `git` dozens of times.
 */
const NETWORK_TOOLS = new Set(["curl", "wget", "npm", "npx"]);

/**
 * The tool a spawn's first argument names, or `undefined` if it is not one the
 * refusal covers.
 *
 * Exported because `network-refusal.test.ts` asks the same question of a probe's
 * recorded call — which refusal a spawn should have earned — and had written its
 * own reduction to answer it. Two copies of "a path or a command line reduces to
 * a tool name" agreeing is the only thing that made that case mean anything.
 */
export function networkTool(command: unknown): string | undefined {
  if (typeof command !== "string") return undefined;
  // `exec` takes a whole command line, `execFile`/`spawn` take a path.
  const first = command.trim().split(/\s+/)[0] ?? "";
  const name = first.split(/[\\/]/).pop() ?? "";
  return NETWORK_TOOLS.has(name) ? name : undefined;
}

/**
 * The wrapper this bootstrap put on each spawn method, kept so it can be asked
 * later whether it is still the one there.
 *
 * `bootstrapInstances()` answers how many times this module body ran, which is
 * not the same question as how deep the refusal is stacked. Anything that wraps
 * a spawn method AFTER this — a second bootstrap, or a helper saving and
 * restoring wrongly — leaves the count at one and puts a layer between a caller
 * and this refusal. A wrapper around this one still refuses, so nothing goes
 * red; it also gets to see, change or drop the call first.
 */
const installedSpawnPatches = new Map<string, unknown>();

for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"] as const) {
  const mutable = childProcess as unknown as Record<string, unknown>;
  const real = mutable[method] as (...args: unknown[]) => unknown;
  const wrapper = (...args: unknown[]) => {
    const tool = networkTool(args[0]);
    if (tool !== undefined) refuseNetwork("spawn", tool);
    return real(...args);
  };
  mutable[method] = wrapper;
  installedSpawnPatches.set(method, wrapper);
}

/**
 * The spawn methods whose current value is not the wrapper this bootstrap
 * installed — empty while the refusal is what a caller reaches first.
 *
 * A suite that swaps a method and restores it (this repository has one) is
 * invisible here, which is right: what this answers is whether the swap is
 * still in place, not whether one ever happened.
 */
export function rewrappedSpawnMethods(): readonly string[] {
  const mutable = childProcess as unknown as Record<string, unknown>;
  return [...installedSpawnPatches]
    .filter(([method, wrapper]) => mutable[method] !== wrapper)
    .map(([method]) => method);
}

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
