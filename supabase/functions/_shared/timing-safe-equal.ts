/**
 * Constant-time shared-secret comparison for webhook-authenticated Edge
 * Functions (today: analytics-mirror's `x-posthog-webhook-secret` check).
 *
 * Before this module the function hand-rolled an XOR-accumulator loop over
 * `charCodeAt` — correct, but it compared UTF-16 code units, so a secret with
 * multi-byte characters was compared against a different byte sequence than
 * the one the operator actually configured over the wire. Here both inputs
 * are encoded to UTF-8 via `TextEncoder` first and handed to the runtime's
 * primitive `timingSafeEqual`.
 *
 * The module is PURE apart from `node:crypto`, which resolves in Node ≥18 AND
 * in the Supabase Edge runtime (Deno supports `node:` specifiers), so the
 * real helper is unit-tested in Node while the Deno functions import it with
 * the `.ts` extension — same pattern as `_shared/cors.ts` / `assert-caller.ts`.
 */

import { timingSafeEqual } from "node:crypto";

/** Encode a secret string to the UTF-8 bytes that travel over the wire. */
export function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * Constant-time equality over the UTF-8 encodings of two strings.
 *
 * `timingSafeEqual` throws on unequal buffer lengths, so a byte-length
 * mismatch short-circuits to `false` — length is the one property an
 * attacker may learn, which the old hand-rolled loop leaked too.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = encodeUtf8(a);
  const right = encodeUtf8(b);
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}
