/**
 * Shared harness for the BE-35 cloud-wrapper integration tests.
 *
 * The cloud wrappers (`lib/supabase-marketplace.ts`, `lib/supabase-chat.ts`)
 * each expose an injectable `{ fetcher, tokenProvider }` seam so the request
 * shape, idempotency headers, retry, and error→requeue behaviour can be
 * exercised without a live Supabase. The blocker — and the reason the older
 * `supabase-*-wiring.test.ts` files only assert on source text — is that the
 * wrappers transitively import `@/lib/supabase`, which pulls in `react-native`
 * (Flow-typed `index.js`, untransformable by esbuild) plus the auth-js /
 * realtime-js / async-storage native peers.
 *
 * `npm test` runs under tsx in CJS mode (see `test-globals.ts`'s use of
 * `createRequire`/`require.cache`), and node's test runner isolates each test
 * file in its own child process. That lets us seed `require.cache` with tiny
 * stubs for exactly those four bare native modules *before* the wrapper is
 * first `require()`d — the rest of the chain is pure TypeScript that loads
 * fine. The stubs are inert: the wrappers only touch `Platform.OS` and
 * `AuthClient.getSession()` at module-eval time, and never during a
 * fetcher-injected call.
 *
 * Because the seeding mutates process-global state (`require.cache` + the two
 * `EXPO_PUBLIC_SUPABASE_*` envs that `isSupabaseConfigured` reads at eval
 * time), this module MUST NOT be named `*.test.ts` — the `__tests__/*.test.ts`
 * glob would otherwise run it as a standalone suite in a process that also
 * loads unrelated files.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const TEST_SUPABASE_URL = "https://test.supabase.co";
export const TEST_ANON_KEY = "anon-test-key";

function seedModule(specifier: string, exports: unknown): void {
  const resolved = require.resolve(specifier);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: [],
  } as unknown as NodeJS.Module;
}

let seeded = false;

/**
 * Idempotently stub the native peers and configure Supabase via env so the
 * wrappers evaluate as "configured". Safe to call from every loader below.
 */
function seedNativeStubs(): void {
  if (seeded) return;
  // Must be set before `@/lib/supabase` is first evaluated — `supabaseUrl`,
  // `supabasePublishableKey` and `isSupabaseConfigured` are module-eval consts.
  process.env.EXPO_PUBLIC_SUPABASE_URL = TEST_SUPABASE_URL;
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = TEST_ANON_KEY;

  seedModule("react-native", { Platform: { OS: "web" } });
  seedModule("@react-native-async-storage/async-storage", {
    default: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
  });
  // The only call the wrappers make against AuthClient is the default
  // `getAccessToken`'s `getSession()`; every test injects its own
  // `tokenProvider`, so this never runs — but it keeps `new AuthClient(...)`
  // at module-eval time from throwing.
  seedModule("@supabase/auth-js", {
    AuthClient: class {
      async getSession() {
        return { data: { session: null } };
      }
    },
  });
  seedModule("@supabase/realtime-js", {
    RealtimeClient: class {},
    REALTIME_LISTEN_TYPES: { POSTGRES_CHANGES: "postgres_changes" },
    REALTIME_POSTGRES_CHANGES_LISTEN_EVENT: {
      INSERT: "INSERT",
      UPDATE: "UPDATE",
      DELETE: "DELETE",
    },
    REALTIME_SUBSCRIBE_STATES: { SUBSCRIBED: "SUBSCRIBED" },
  });
  seeded = true;
}

/* eslint-disable @typescript-eslint/no-require-imports */

export function loadMarketplaceWrappers(): typeof import("@/lib/supabase-marketplace") {
  seedNativeStubs();
  return require("@/lib/supabase-marketplace");
}

export function loadChatWrappers(): typeof import("@/lib/supabase-chat") {
  seedNativeStubs();
  return require("@/lib/supabase-chat");
}

/* eslint-enable @typescript-eslint/no-require-imports */

export interface FetchCall {
  url: string;
  init: RequestInit;
}

export interface FakeFetcherOptions {
  /** HTTP-ok flag the fake Response reports (drives the error→requeue path). */
  ok?: boolean;
  status?: number;
  /** JSON body the fake Response yields from `.json()`. */
  json?: unknown;
}

/**
 * A recording `fetch` stand-in. Captures every `(url, init)` and returns a
 * minimal Response-like with a configurable `ok`/`status`/`json()`.
 */
export function makeRecordingFetcher(options: FakeFetcherOptions = {}): {
  calls: FetchCall[];
  fetcher: typeof fetch;
} {
  const { ok = true, status = ok ? 200 : 500, json = [] } = options;
  const calls: FetchCall[] = [];
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok,
      status,
      async json() {
        return json;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

/** A `tokenProvider` that resolves to a fixed access token (or null). */
export function fakeTokenProvider(token: string | null): () => Promise<string | null> {
  return async () => token;
}

/** Pull the single recorded call, asserting exactly one happened. */
export function soleCall(calls: FetchCall[]): FetchCall {
  if (calls.length !== 1) {
    throw new Error(`expected exactly one fetch call, saw ${calls.length}`);
  }
  return calls[0];
}

export function headersOf(call: FetchCall): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>;
}

export function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}
