export const FRESHLY_CREATED_WINDOW_MS = 5 * 60 * 1000;

/**
 * Returns true when the Supabase user object represents a freshly-created
 * account — `created_at` within the last 5 minutes. Used to fire the
 * `signup_completed` analytics event from the verifyOtp path so we don't
 * also fire it on every subsequent OTP login by the same user.
 *
 * Lives in this pure module (no react-native imports) so unit tests can
 * import it without needing a metro shim.
 */
export function isFreshlyCreatedUser(
  user: { created_at?: string } | null,
  now: number = Date.now(),
): boolean {
  const iso = user?.created_at;
  if (!iso) return false;
  const created = Date.parse(iso);
  if (!Number.isFinite(created)) return false;
  const age = now - created;
  return age >= 0 && age <= FRESHLY_CREATED_WINDOW_MS;
}
