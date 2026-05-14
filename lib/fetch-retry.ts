// iOS Safari 18.x has a documented regression where the first cross-origin
// `fetch()` after a navigation occasionally rejects with
// `TypeError: Load failed` even when the server is fully reachable. A single
// short-delay retry clears it. Used by `lib/supabase-profiles.ts` and the
// `lib/supabase-chat.ts` helpers. Pure module — no `react-native` imports —
// so it can be exercised from plain Node tests.

const SAFARI_LOAD_FAILED_RE = /load failed/i;

export function isSafariLoadFailed(err: unknown): boolean {
  return err instanceof TypeError && SAFARI_LOAD_FAILED_RE.test(err.message);
}

type FetchLike = typeof fetch;

export interface FetchWithRetryOptions {
  retries?: number;
  delayMs?: number;
  fetcher?: FetchLike;
  shouldRetry?: (err: unknown) => boolean;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    retries = 1,
    delayMs = 400,
    fetcher = fetch,
    shouldRetry = isSafariLoadFailed,
  } = options;
  let attempt = 0;
  while (true) {
    try {
      return await fetcher(input, init);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      attempt++;
    }
  }
}
