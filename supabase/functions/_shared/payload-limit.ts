/**
 * Request-body size gate for webhook Edge Functions (today: analytics-mirror).
 *
 * PostHog can batch hundreds of events into one POST; without a bound we'd
 * buffer the whole body and attempt a giant insert, letting Postgres be the
 * one to reject it. Bounding up front is cheaper and more defensive against a
 * misconfigured destination. Two layers share the same limit:
 *
 *   1. `declaredContentLength` — a well-behaved client sends
 *      `Content-Length`, so an oversized payload is rejected before the body
 *      is ever read.
 *   2. `utf8ByteLength` over the read body — the authoritative check, since
 *      the header is client-controlled (absent on chunked encoding, or lying).
 *
 * The module is PURE — no imports, only the `TextEncoder` global available in
 * both Deno and Node ≥18 — so the real helper is unit-tested in Node while
 * the Deno functions import it with the `.ts` extension (same pattern as
 * `_shared/cors.ts` / `_shared/timing-safe-equal.ts`).
 */

/** Hard cap on a webhook request body: 256 KiB. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Parse a `Content-Length` header into a byte count. Returns null for a
 * missing/blank/non-numeric/negative header (chunked encoding sends none) —
 * callers must then fall back to measuring the read body.
 */
export function declaredContentLength(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return null;
  const bytes = Number(trimmed);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/** Byte length of a string's UTF-8 encoding (what actually crossed the wire). */
export function utf8ByteLength(body: string): number {
  return new TextEncoder().encode(body).byteLength;
}

/** True when a byte count exceeds the payload cap. */
export function exceedsPayloadLimit(
  bytes: number,
  limit: number = MAX_PAYLOAD_BYTES,
): boolean {
  return bytes > limit;
}
