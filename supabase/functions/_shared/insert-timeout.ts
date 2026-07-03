/**
 * Self-imposed timeout for the webhook → Postgres insert path (today:
 * analytics-mirror). Without one, a slow or hung database connection ties up
 * the Edge Function until the platform's hard timeout; a bounded wait lets
 * the function answer 504 so PostHog retries sooner with its standard
 * exponential backoff.
 *
 * Operators tune the ceiling per-deploy via the optional
 * `POSTHOG_WEBHOOK_TIMEOUT_MS` Edge Function secret (a plain server-side
 * secret, NOT `EXPO_PUBLIC_*` — that prefix is for values bundled into the
 * client). Missing/blank/malformed values fall back to the default.
 *
 * The module is PURE — no imports, only the `setTimeout`/`clearTimeout`
 * globals shared by Deno and Node — so the real helper is unit-tested in
 * Node while the Deno functions import it with the `.ts` extension (same
 * pattern as `_shared/cors.ts` / `payload-limit.ts`).
 */

/** Default ceiling on the insert: 5 seconds. */
export const DEFAULT_INSERT_TIMEOUT_MS = 5000;

/**
 * Parse a timeout override from an env/secret value. Returns `fallback` for
 * missing/blank/non-numeric/zero/negative/unsafe values — a misconfigured
 * knob must never disable the bound or make it zero (which would 504
 * everything).
 */
export function resolveInsertTimeoutMs(
  raw: string | null | undefined,
  fallback: number = DEFAULT_INSERT_TIMEOUT_MS,
): number {
  if (raw === null || raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return fallback;
  const ms = Number(trimmed);
  if (!Number.isSafeInteger(ms) || ms <= 0) return fallback;
  return ms;
}

export type TimeoutResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

/**
 * Race a promise against a deadline. Resolves `{timedOut: true}` when the
 * deadline wins — the underlying work is NOT cancelled (PostgREST offers no
 * abort here), but the response is unblocked so the caller can 504. The
 * timer is always cleared so a fast insert doesn't leak a pending timeout.
 * A rejected work-promise propagates as a rejection, never as a timeout.
 */
export async function withTimeout<T>(
  work: PromiseLike<T>,
  timeoutMs: number,
): Promise<TimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve(work).then((value) => ({ timedOut: false as const, value })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
