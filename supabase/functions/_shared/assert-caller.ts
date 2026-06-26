/**
 * SEC-9 — shared caller-authentication gate for Edge Functions.
 *
 * Every privileged Edge Function (`delete-account`, `delete-image`,
 * `claim-listing`, `accept-friend-request`, `validate-premium`,
 * `export-data`) opens with the SAME two checks before it touches the
 * service-role key or any user data:
 *
 *   1. an `Authorization` header is present (else 401 "Missing authorization");
 *   2. that header resolves to a real Supabase session via `auth.getUser()`
 *      (else 401 "Invalid session").
 *
 * Copy-pasting that handshake into six functions is a latent security risk: a
 * single function that forgets the `getUser()` step, or trusts a body-supplied
 * id instead of `user.id`, becomes an auth-bypass. This module is the one place
 * the handshake lives, so "verify the caller before any service-role op" is a
 * single import and a single early-return — and is unit-testable in Node.
 *
 * The Edge Functions run under Deno, but this module stays PURE: it imports no
 * `esm.sh` Supabase client (the caller injects `auth.getUser()`), and uses only
 * the `Request`/`Response` Fetch globals available in both Deno and Node ≥18.
 * That lets the real function (Node test) exercise the 401-before-work contract
 * directly, while the Deno function imports it with the `.ts` extension.
 */

/** The narrow slice of a Supabase user the functions actually consume. */
export type AuthedUser = { id: string } & Record<string, unknown>;

/** The shape of `supabaseClient.auth.getUser()` — injected, never imported. */
export type GetUserResult = {
  data: { user: AuthedUser | null };
  error: unknown;
};

/**
 * Verifies the caller's bearer token. Implemented by each function as a thin
 * wrapper around an anon-key client carrying the caller's `Authorization`
 * header: `(authHeader) => createClient(url, anon, { global: { headers: {
 * Authorization: authHeader } } }).auth.getUser()`.
 */
export type VerifyToken = (
  authHeader: string,
) => Promise<GetUserResult> | GetUserResult;

/** Discriminated result: a verified caller, or the 401 to return verbatim. */
export type AssertCallerResult =
  | { ok: true; user: AuthedUser; authHeader: string }
  | { ok: false; response: Response };

/** Build a JSON error response with the function's CORS headers attached. */
export function jsonError(
  message: string,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Resolve and verify the caller BEFORE any service-role / privileged work.
 *
 * Returns `{ ok: true, user, authHeader }` only when an `Authorization` header
 * is present AND `verifyToken` resolves it to a real user. Otherwise returns
 * `{ ok: false, response }` carrying the exact 401 the function must return:
 *
 *   - missing/blank `Authorization`  → 401 "Missing authorization"
 *     (the privileged secret is never read, `verifyToken` is never called);
 *   - `getUser()` errors or yields no user (expired/forged/garbage token)
 *     → 401 "Invalid session";
 *   - `verifyToken` itself throws (network/SDK failure) → 401 "Invalid session"
 *     (fail closed — an unverifiable caller is never treated as authenticated).
 *
 * `user.id` is the ONLY trustworthy caller identity; functions must derive the
 * acting subject from it, never from the request body.
 */
export async function assertCaller(
  req: Request,
  corsHeaders: Record<string, string>,
  verifyToken: VerifyToken,
): Promise<AssertCallerResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader.trim() === "") {
    return {
      ok: false,
      response: jsonError("Missing authorization", 401, corsHeaders),
    };
  }

  let result: GetUserResult;
  try {
    result = await verifyToken(authHeader);
  } catch {
    // Fail closed: an unverifiable token must never pass as authenticated.
    return {
      ok: false,
      response: jsonError("Invalid session", 401, corsHeaders),
    };
  }

  const user = result?.data?.user ?? null;
  if (result?.error || !user) {
    return {
      ok: false,
      response: jsonError("Invalid session", 401, corsHeaders),
    };
  }

  return { ok: true, user, authHeader };
}
