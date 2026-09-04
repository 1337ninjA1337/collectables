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

/**
 * Every refusal this bootstrap installed, and how to read what is there NOW.
 *
 * `bootstrapInstances()` answers how many times this module body ran, which is
 * a different question from how deep a refusal is stacked. Anything that wraps
 * a patch point after this — a second bootstrap, or a helper that saves and
 * restores wrongly — leaves the count at one and puts a layer between a caller
 * and the refusal. That layer still refuses, so nothing goes red; it also gets
 * to see, change or drop the call first.
 *
 * EVERY POINT THIS BODY PATCHES, not only the spawn methods. `globalThis.fetch`
 * and the http client methods are installed by this same body and were
 * remembered by nothing, so a wrapper around the fetch refusal was exactly as
 * invisible as a spawn wrapper was before any of this was written. The suites
 * stub `fetch` constantly, which is what makes it the likeliest point to acquire
 * a layer and the hardest one to have left unwatched.
 *
 * The population is not written down here, in a number that would go stale the
 * day a method joins {@link SPAWN_METHODS}. {@link refusalPoints} is compared
 * against the lists this body patches from, in `network-refusal.test.ts`.
 *
 * What is remembered per point is a value and a CLOSURE that reads the current
 * one, because the three surfaces are not the same shape: `fetch` is a property
 * of `globalThis`, the clients are properties of two module objects, and the
 * spawn methods of a third. A caller reads whichever one it names at call time,
 * and that read is what a comparison here has to be against.
 *
 * The VERB is remembered too — the word this point's refusal puts after "A test
 * tried to". All four refusals share that prefix, so a reader matching it learns
 * that SOME refusal fired and not that it was this surface's: a point registered
 * against another surface's wrapper reads identically. The verb is passed to
 * `refuseNetwork` and to this in one expression, so the two cannot drift.
 */
interface InstalledRefusal {
  readonly refusal: unknown;
  readonly current: () => unknown;
  readonly verb: string;
}

const installedRefusals = new Map<string, InstalledRefusal>();

/**
 * Registers one point, and refuses to register a second under the same name.
 *
 * A `Map.set` on a name already in the map keeps the LAST entry, which is the
 * one failure this registry exists to catch, reproduced inside it: the wrapper
 * the first call installed is still on the surface, still between a caller and
 * the refusal, and no longer remembered by anything — so
 * {@link rewrappedRefusals} compares the second wrapper against itself, finds
 * them equal, and reports a clean process. Silently keeping one of two is the
 * shape that reads as green.
 *
 * A throw, and it happens while this module body is running: the bootstrap is
 * loaded by `--import` before any suite, so a duplicate address fails the
 * process at load rather than turning one case red somewhere downstream of a
 * registry that has already lied.
 */
function installRefusal(
  point: string,
  verb: string,
  refusal: unknown,
  current: () => unknown,
): void {
  if (installedRefusals.has(point)) {
    throw new Error(
      `test-globals: \`${point}\` was registered twice. The registry holds one entry per address, so the second registration forgets the first wrapper while leaving it installed — which is precisely the invisible layer rewrappedRefusals() exists to notice.`,
    );
  }
  installedRefusals.set(point, { refusal, current, verb });
}

const FETCH_VERB = "fetch";
const fetchRefusal = ((input: unknown) =>
  refuseNetwork(FETCH_VERB, requested(input))) as unknown as typeof globalThis.fetch;
globalThis.fetch = fetchRefusal;
installRefusal("globalThis.fetch", FETCH_VERB, fetchRefusal, () => globalThis.fetch);

/**
 * `http.request`, `http.get` and their https twins.
 *
 * Patched on the module object rather than replaced by a loader hook: node's
 * own runner and `tsx` load these too, and a refusal that took the module out
 * from under them would fail the run for a reason that is not a test's.
 */
const HTTP_VERB = "open an http connection to";

/**
 * The client surfaces patched, and the methods patched on each.
 *
 * Exported so the registry's population has ONE source. The point names are
 * built from these in the loop below, and `network-refusal.test.ts` builds the
 * set it expects from the same lists — where writing the eleven names out a
 * second time would be a copy that agrees with the bootstrap on the day it is
 * written and never again.
 */
const HTTP_CLIENTS: Readonly<Record<string, unknown>> = { http, https };
export const HTTP_SURFACES: readonly string[] = Object.keys(HTTP_CLIENTS);
export const HTTP_METHODS = ["request", "get"] as const;

for (const surface of HTTP_SURFACES) {
  for (const method of HTTP_METHODS) {
    const mutable = HTTP_CLIENTS[surface] as Record<string, unknown>;
    const refusal = (input: unknown) => refuseNetwork(HTTP_VERB, requested(input));
    mutable[method] = refusal;
    installRefusal(`${surface}.${method}`, HTTP_VERB, refusal, () => mutable[method]);
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

const SPAWN_VERB = "spawn";

/**
 * The `node:child_process` methods wrapped.
 *
 * `fork` is deliberately absent: it starts a node process with a module path
 * rather than a command line, so `networkTool` has nothing to read off its first
 * argument and no suite reaches a registry through it. That the module knows
 * SEVEN lowercase functions and this list names six is the one place the two
 * populations are meant to differ — see the `SPAWN_NAMES` derivation in
 * `network-refusal.test.ts`, which reads the module rather than this list.
 *
 * Exported for the same reason as {@link HTTP_METHODS}: the point names below
 * are built from it, so the case that pins the registry's population reads this
 * list rather than a second copy of it.
 */
export const SPAWN_METHODS = [
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
] as const;

for (const method of SPAWN_METHODS) {
  const mutable = childProcess as unknown as Record<string, unknown>;
  const real = mutable[method] as (...args: unknown[]) => unknown;
  const wrapper = (...args: unknown[]) => {
    const tool = networkTool(args[0]);
    if (tool !== undefined) refuseNetwork(SPAWN_VERB, tool);
    return real(...args);
  };
  mutable[method] = wrapper;
  installRefusal(`childProcess.${method}`, SPAWN_VERB, wrapper, () => mutable[method]);
}

/**
 * Every point this bootstrap installed a refusal at, in the order it did.
 *
 * Exported so the identity check below cannot be satisfied by remembering
 * nothing: an empty registry has no rewrapped points, and a point nothing
 * remembers is a point nothing can notice a layer over.
 *
 * The names are built from {@link HTTP_SURFACES}, {@link HTTP_METHODS} and
 * {@link SPAWN_METHODS}, plus one written by hand for `globalThis.fetch` — the
 * hand-written one is why a case compares this against those lists rather than
 * trusting that a registration exists for everything patched.
 */
export function refusalPoints(): readonly string[] {
  return [...installedRefusals.keys()];
}

/**
 * What a caller reaches at this point right now, or `undefined` if the point is
 * not one this bootstrap patched.
 *
 * The read is the point's own — `globalThis.fetch` off the global, a client
 * method off its module object — so a reader asking "does this still refuse?"
 * asks it of the value a call site would get, rather than rebuilding a second
 * copy of which surface each point lives on.
 */
export function refusalAt(point: string): unknown {
  return installedRefusals.get(point)?.current();
}

/**
 * The word this point's refusal puts after "A test tried to", or `undefined` if
 * the point is not one this bootstrap patched.
 *
 * Exported because the prefix is shared by all four refusals: a reader that
 * matched it would learn that SOME refusal fired, which is what the whole
 * `spawnToolOf` argument one file over is about. The verb is what tells a
 * spawn's refusal from a fetch's, and a point holding another surface's wrapper
 * is the fault that reads identically without it.
 */
export function refusalVerbAt(point: string): string | undefined {
  return installedRefusals.get(point)?.verb;
}

/**
 * The points whose current value is not the refusal this bootstrap installed —
 * empty while the refusal is what a caller reaches first.
 *
 * A suite that swaps a value and restores it (this repository has several, and
 * `fetch` is stubbed all over the tree) is invisible here, which is right: what
 * this answers is whether the swap is still in place, not whether one ever
 * happened. It answers for THIS process, which is the only one it can see.
 */
export function rewrappedRefusals(): readonly string[] {
  return [...installedRefusals]
    .filter(([, point]) => point.current() !== point.refusal)
    .map(([point]) => point);
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
