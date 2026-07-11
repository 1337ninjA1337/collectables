/**
 * Pure time predicates shared across "is X recent?" checks. Node-safe (no
 * react-native imports) so unit tests and other pure modules (auth-helpers,
 * premium-helpers) can import it without a metro shim.
 */

/**
 * Returns true when `iso` parses to a timestamp within the last `durationMs`
 * (inclusive) of `now`. Missing or unparseable timestamps are never "within"
 * the window, and neither are future timestamps (clock-skew guard) — a
 * device clock behind the server must not turn every server-stamped record
 * "recent forever".
 */
export function isWithinDuration(
  iso: string | null | undefined,
  durationMs: number,
  now: number = Date.now(),
): boolean {
  if (!iso) return false;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return false;
  const age = now - parsed;
  return age >= 0 && age <= durationMs;
}
