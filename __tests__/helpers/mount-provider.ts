import { createElement, type ComponentType, type PropsWithChildren } from "react";

import { installNativeModuleStubs, mockModule, render, type RenderResult } from "./render";

/**
 * The twenty lines every mounted-provider suite was writing out by hand.
 *
 * ## What was duplicated
 *
 * Six providers are now mounted rather than source-scanned, and four of them
 * (`chat`, `premium`, `social`, `collections`) open with the same shape: a spy
 * `AsyncStorage` recording reads and writes into arrays a case can assert on, a
 * `Probe` component assigning the context value to a `let`, a `settle()` that
 * yields one macrotask, and a `mount()` that lazily imports the provider,
 * resets the storage-failure budget, renders and drains. Each copy was fifty
 * lines before its first assertion, and the copies had already diverged: two
 * supported a `writeError`, two did not.
 *
 * `helpers/spy-async-storage.ts` covers a different job — it refuses a second
 * install per process, which is right for the module-level singletons it was
 * written for and unusable here, where the store must be cleared per case.
 *
 * ## The fixed-count drain, and why it is gone
 *
 * Each suite drained its provider's async hydrate with a hard-coded number of
 * `settle()`/`rerender()` pairs — two for chat, four for collections — arrived
 * at by watching a case fail and adding one. That number is a claim about how
 * many awaits a hydrate holds, written nowhere near the hydrate, and its
 * failure mode is silent in the worst direction: a sixth await added to a
 * provider makes a "nothing was written under user B's key" case pass by not
 * having run yet. {@link drain} loops on `RenderResult.dirty` instead and
 * throws if the tree never settles, so the count is a property of the run.
 *
 * ## Ordering constraint
 *
 * {@link installSpyAsyncStorage} must be called at MODULE scope of the suite,
 * before anything imports the provider — it registers a module mock, and ESM
 * caches a module the first time it evaluates. See `./render.ts`.
 */

export type StorageWrite = { key: string; value: string };

export type SpyAsyncStorage = {
  /** Every key passed to `getItem`, in order, including repeats. */
  readonly reads: string[];
  /** Every successful `setItem`, in order. */
  readonly writes: StorageWrite[];
  /** The backing store. Seed a case by setting keys before `mount()`. */
  readonly store: Map<string, string>;
  /** Set to make every read reject — a device whose store is unavailable. */
  readError: Error | null;
  /** Set to make every write reject — a full device store. */
  writeError: Error | null;
  /** Clears the recordings, the store and both errors. Call from `beforeEach`. */
  reset(): void;
};

/**
 * Replaces `@react-native-async-storage/async-storage` with a recording double
 * and returns the recordings.
 *
 * Also installs the native-module stubs, because a suite that needs this needs
 * those; both are idempotent.
 */
export function installSpyAsyncStorage(): SpyAsyncStorage {
  installNativeModuleStubs();

  const spy: SpyAsyncStorage = {
    reads: [],
    writes: [],
    store: new Map<string, string>(),
    readError: null,
    writeError: null,
    reset() {
      spy.reads.length = 0;
      spy.writes.length = 0;
      spy.store.clear();
      spy.readError = null;
      spy.writeError = null;
    },
  };

  mockModule("@react-native-async-storage/async-storage", {
    default: {
      getItem: async (key: string) => {
        spy.reads.push(key);
        if (spy.readError) throw spy.readError;
        return spy.store.get(key) ?? null;
      },
      setItem: async (key: string, value: string) => {
        if (spy.writeError) throw spy.writeError;
        spy.writes.push({ key, value });
        spy.store.set(key, value);
        return undefined;
      },
      removeItem: async (key: string) => {
        spy.store.delete(key);
        return undefined;
      },
    },
  });

  return spy;
}

export type ToastRecord = {
  level: "success" | "error" | "info";
  message: string;
  title?: string;
};

/**
 * Replaces `@/lib/toast-context` with a recorder and returns what was raised.
 *
 * Every provider that holds a hydration gate now calls `useHydrationGateNotice`
 * (see `lib/hydration-gate-notice.ts`), so `useToast` is on the mount path of
 * all five — and the toast it raises is the only user-visible consequence of a
 * refused persist, which makes it a thing to assert rather than a thing to stub
 * into silence.
 */
export function installSpyToast(): ToastRecord[] {
  const toasts: ToastRecord[] = [];
  const record = (level: ToastRecord["level"]) => (message: string, title?: string) => {
    toasts.push({ level, message, title });
  };
  mockModule("@/lib/toast-context", {
    useToast: () => ({ success: record("success"), error: record("error"), info: record("info") }),
  });
  return toasts;
}

/**
 * Replaces `@/lib/i18n-context` with an identity `t()`.
 *
 * A key rather than a sentence, so a case asserts which STRING was chosen
 * without pinning its English wording — the wording is the translators' and
 * changes; the key is the contract.
 */
export function installStubI18n(language = "en"): void {
  mockModule("@/lib/i18n-context", {
    useI18n: () => ({ t: (key: string) => key, language }),
  });
}

/**
 * Clears the once-per-session latch in `lib/hydration-gate-notice.ts`.
 *
 * Module-level by design — the notice is about a DEVICE, so five providers
 * refusing raise one toast between them — which makes it state that survives
 * across cases in one process. Dynamic, because the module reaches i18n and the
 * toast host, and a static import would resolve both before a suite's mocks
 * registered.
 */
export async function resetHydrationGateNotice(): Promise<void> {
  const notice = await import("../../lib/hydration-gate-notice");
  notice.__resetHydrationGateNoticeForTests();
}

/** One macrotask, which is what a resolved `AsyncStorage` promise needs. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Yields to the event loop and re-renders until nothing changes any more.
 *
 * `dirty` is READ BEFORE the re-render, not after, and that distinction is the
 * whole correctness of this loop. A hydrate's `setState` calls arrive from a
 * promise chain BETWEEN two builds; a build resets the flag and then renders,
 * so a flag read afterwards describes the render that just consumed the change
 * rather than the change itself. Reading it first asks the right question —
 * "has anything moved since the last render?" — and a loop that asked it the
 * other way round stopped one macrotask early on a three-await chain, which is
 * exactly the class of silent early exit the fixed pass counts had.
 *
 * Two consecutive quiet passes rather than one, because a promise that resolves
 * on the next macrotask has not moved anything on this one. `maxPasses` is a
 * runaway guard, not a tuning knob: a tree that never settles is a bug (an
 * effect setting a value it also depends on), and throwing here names it
 * instead of letting the suite time out somewhere less informative.
 */
export async function drain(tree: RenderResult, maxPasses = 24): Promise<void> {
  let quiet = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    await settle();
    if (tree.dirty) {
      tree.rerender();
      quiet = 0;
      continue;
    }
    quiet += 1;
    if (quiet === 2) return;
  }
  throw new Error(
    `drain: the tree was still re-rendering after ${maxPasses} passes — an effect is probably setting a value it also depends on`,
  );
}

export type ProviderHarness<Value> = {
  /** Renders the provider around a probe and drains it. */
  mount(): Promise<RenderResult>;
  /** The context value from the most recent render pass, or null before one. */
  readonly seen: Value | null;
  /**
   * The context value, asserted non-null — for the common case where a mount
   * has happened and `seen!.x` would otherwise be written on every line.
   */
  value(): Value;
  /** Forgets the last seen value. Call from `beforeEach`. */
  reset(): void;
};

/**
 * Mounts one provider around a probe that captures its context value.
 *
 * The loader is a function rather than a module so the import stays LAZY: the
 * provider must not resolve until every `mockModule` call in the suite has
 * registered, and a static import at the top of a suite file would resolve the
 * whole graph first. See the ordering constraint in `./render.ts`.
 *
 * ```ts
 * const harness = providerHarness(async () => {
 *   const social = await import("../lib/social-context");
 *   return { Provider: social.SocialProvider, useValue: social.useSocial };
 * });
 * ```
 */
export function providerHarness<Value>(
  load: () => Promise<{
    Provider: ComponentType<PropsWithChildren>;
    useValue: () => Value;
  }>,
): ProviderHarness<Value> {
  let loaded: { Provider: ComponentType<PropsWithChildren>; useValue: () => Value } | null = null;
  let seen: Value | null = null;

  function Probe() {
    seen = loaded!.useValue();
    return createElement("View", null);
  }

  return {
    async mount() {
      loaded ??= await load();
      // Each case gets the whole once-per-keyspace budget: a suite whose first
      // case exhausts it would otherwise leave the rest asserting on silence.
      const reporting = await import("../../lib/report-storage-failure");
      reporting.__resetStorageFailureReportsForTests();
      const tree = render(createElement(loaded.Provider, null, createElement(Probe)));
      await drain(tree);
      return tree;
    },
    get seen() {
      return seen;
    },
    value() {
      if (seen === null) {
        throw new Error("providerHarness: no render has happened yet — call mount() first");
      }
      return seen;
    },
    reset() {
      seen = null;
    },
  };
}
