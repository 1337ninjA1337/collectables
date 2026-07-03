/**
 * Constant-time string comparison shared by the Edge Functions.
 *
 * Compares the UTF-8 **bytes** of both strings with an XOR accumulator so a
 * timing channel can't probe a shared secret byte-by-byte. Encoding first
 * (rather than XOR-ing `charCodeAt` results) avoids the UTF-16 quirk where a
 * multi-byte secret is compared per code unit: two strings can agree on
 * every low byte of their code units while differing in the high byte, and
 * the byte-length of the secret (the only thing the early length guard
 * leaks) matches what an attacker already learns from the wire.
 *
 * `crypto.timingSafeEqual` is not a stable cross-runtime global (Node keeps
 * it in `node:crypto`, Deno moved it to `std`), so this stays a hand-rolled
 * XOR loop — but over bytes, not UTF-16 code units. The module is pure and
 * uses only `TextEncoder` (available in both Deno and Node ≥11), so it is
 * unit-tested in Node and imported by the Deno functions with the `.ts`
 * extension — same pattern as `lib/service-role-claim.ts`.
 */

const encoder = new TextEncoder();

/**
 * Constant-time equality over the UTF-8 encodings of `a` and `b`. Branches
 * only on byte length (already-known public info); every byte of equal-length
 * inputs is visited regardless of where the first mismatch occurs.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
