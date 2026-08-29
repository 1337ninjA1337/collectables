import { installNativeModuleStubs, mockModule } from "./render";

/**
 * One spy AsyncStorage, plus the Sentry shim every storage suite needs beside
 * it.
 *
 * ## Why this is a module now
 *
 * Three suites had written out the same twenty lines — `tombstones-storage`,
 * `sync-cursors-storage` and `locale-currency-storage` each declared a `store`
 * Map, a `readError`, a `writeError`, the two `mockModule` calls and the
 * `scopes()`/`keyspaces()` readers over the captured events, differing in
 * nothing. A fourth needed them, which is the rule this tree applied to
 * `lib/balanced-source.ts`: when a second reader needs the same thing it earns
 * a module, and by the fourth copy the question is why it took four.
 *
 * The copies had not drifted yet, which is the reason to extract them NOW
 * rather than the reason not to. The one place they could drift is the part
 * that matters: what a failing store DOES. A suite whose spy throws only on
 * `getItem` and one whose spy throws on both are asking different questions
 * while looking identical at the call site.
 *
 * ## What it deliberately does not do
 *
 * It does not mount anything (`use-persisted-blob.test.ts` needs a React
 * render and a spy that RECORDS writes in order, which is a different
 * fixture), and it does not stub `removeItem`, `multiSet` or `getAllKeys` —
 * an unused branch is an untested one, and the module that needs the first of
 * those can add it with the case that reads it.
 *
 * ## One per process
 *
 * `mockModule` writes into a process-wide registry, so two spies would fight
 * over one AsyncStorage and the second would win silently. A second call
 * throws instead.
 */

/** One `captureException` call, in the shape `reportStorageFailure` sends. */
export type CapturedReport = {
  readonly error: unknown;
  readonly context: { readonly scope: string; readonly extra: { readonly keyspace: string } };
};

export interface StorageSpy {
  /** What the store holds. Seed it directly to fixture a prior session. */
  readonly store: Map<string, string>;
  /** Every report this session, oldest first. */
  readonly captured: CapturedReport[];
  /** Non-null makes every `getItem` reject with it. */
  readError: Error | null;
  /** Non-null makes every `setItem` reject with it. */
  writeError: Error | null;
  /** Clears the store, both failures, the reports AND the session budget. */
  reset(): Promise<void>;
  /** The `scope` of each report, in order — a `deepEqual` subject. */
  scopes(): string[];
  /** The `extra.keyspace` of each report, in order. */
  keyspaces(): string[];
}

let installed = false;

/**
 * Register the spy. Call once, at suite module scope, BEFORE any lazy import
 * of the module under test — `mockModule` only takes effect for a module that
 * has not been evaluated yet.
 */
export function installStorageSpy(): StorageSpy {
  if (installed) {
    throw new Error(
      "installStorageSpy: already installed in this process — one spy per suite, and two would share one AsyncStorage registry with the second winning silently",
    );
  }
  installed = true;
  installNativeModuleStubs();

  const store = new Map<string, string>();
  const captured: CapturedReport[] = [];
  const spy: StorageSpy = {
    store,
    captured,
    readError: null,
    writeError: null,
    async reset() {
      store.clear();
      captured.length = 0;
      spy.readError = null;
      spy.writeError = null;
      // The budget is module scope in `report-storage-failure` and survives
      // between cases in one process, so a suite that did not clear it would
      // see its second case report nothing and read that as a passing bound.
      (await import("@/lib/report-storage-failure")).__resetStorageFailureReportsForTests();
    },
    scopes: () => captured.map((c) => c.context.scope),
    keyspaces: () => captured.map((c) => c.context.extra.keyspace),
  };

  mockModule("@react-native-async-storage/async-storage", {
    default: {
      getItem: async (key: string) => {
        if (spy.readError) throw spy.readError;
        return store.get(key) ?? null;
      },
      setItem: async (key: string, value: string) => {
        if (spy.writeError) throw spy.writeError;
        store.set(key, value);
      },
    },
  });

  mockModule("@/lib/sentry", {
    captureException: (error: unknown, context: unknown) =>
      captured.push({ error, context } as CapturedReport),
  });

  return spy;
}
