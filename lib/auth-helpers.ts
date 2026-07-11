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

/**
 * Subset of the Supabase `User` object the signup detectors read.
 * `app_metadata.provider` is "email" for OTP accounts and the OAuth provider
 * slug ("google", "apple") otherwise.
 */
export type SignupAuthUser = {
  id?: string;
  created_at?: string;
  app_metadata?: { provider?: string };
};

/**
 * Returns true when a SIGNED_IN auth event represents a signup this session
 * has not yet tracked: a freshly-created user (5-minute window) whose id is
 * not in `seenUserIds`. Pure predicate — the caller adds the id to the set
 * after firing, so the OAuth-path SIGNED_IN and the verifyOtp resolution of
 * the same signup collapse into exactly one `signup_completed` event
 * regardless of which lands first.
 */
export function shouldTrackSignupOnAuthEvent(
  event: string,
  user: SignupAuthUser | null,
  seenUserIds: ReadonlySet<string>,
  now: number = Date.now(),
): boolean {
  if (event !== "SIGNED_IN") return false;
  if (!user?.id || seenUserIds.has(user.id)) return false;
  return isFreshlyCreatedUser(user, now);
}

/**
 * `signup_completed` props derived from the auth provider: email accounts
 * sign up via the OTP flow, everything else is OAuth.
 */
export function signupEventProps(user: SignupAuthUser | null): {
  method: "otp" | "oauth";
  provider: string;
} {
  const provider = user?.app_metadata?.provider ?? "unknown";
  return { method: provider === "email" ? "otp" : "oauth", provider };
}
