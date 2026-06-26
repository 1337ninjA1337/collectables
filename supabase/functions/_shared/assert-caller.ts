import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  assertAnonKey,
  ServiceRoleClaimError,
} from "../../../lib/service-role-claim.ts";

/**
 * SEC-9 — shared caller-authentication gate for Edge Functions.
 *
 * Every privileged Edge Function (`delete-account`, `delete-image`,
 * `claim-listing`, `accept-friend-request`, `validate-premium`,
 * `export-data`) must prove the caller holds a valid Supabase session BEFORE
 * it touches the service-role client. That gate was previously copy-pasted
 * into every function — read the `Authorization` header, build a user-scoped
 * anon client, call `auth.getUser()`, 401 on a missing header or invalid
 * session. Copy-paste invites drift: one function could silently lose the
 * header check, or run a privileged op before `getUser()` resolves.
 *
 * This module centralises that gate. {@link assertCaller} returns the
 * authenticated user (and the resolved `SUPABASE_URL`) or throws a typed
 * {@link CallerAuthError} carrying the HTTP status the function should
 * return. It also runs the BE-23 anon-key self-check (the user client must
 * never be wired with a privileged key), surfacing a misconfig as the
 * existing {@link ServiceRoleClaimError} so callers keep mapping it to a 500.
 *
 * The function runs under Deno (it imports `createClient` from esm.sh and
 * reads `Deno.env`), so it is covered by source-level structural tests like
 * the rest of the Edge Functions rather than executed in Node.
 */

/** Re-exported so call sites can map an anon-key misconfig in one `catch`. */
export { ServiceRoleClaimError };

/** A caller-authentication failure carrying the HTTP status to return. */
export class CallerAuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CallerAuthError";
    this.status = status;
  }
}

export type AuthenticatedCaller = {
  /** The authenticated Supabase user. `id` is the trusted `auth.uid()`. */
  user: { id: string } & Record<string, unknown>;
  /** The resolved `SUPABASE_URL`, so callers can build their admin client. */
  supabaseUrl: string;
  /** The verified `Authorization` header, for callers that re-use it. */
  authHeader: string;
};

/**
 * Verify the request carries a valid Supabase session before any
 * service-role op. Throws {@link CallerAuthError} (401) on a missing
 * `Authorization` header or an invalid/expired session, and
 * {@link ServiceRoleClaimError} if the function's anon key is misconfigured.
 * On success returns the authenticated {@link AuthenticatedCaller}.
 *
 * `functionName` is woven into the misconfig message so the logs name the
 * offending function.
 */
export async function assertCaller(
  req: Request,
  functionName: string,
): Promise<AuthenticatedCaller> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new CallerAuthError(401, "Missing authorization");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // The user-Authorization client must never hold a privileged key — if the
  // anon slot was filled with a service-role/secret key, fail loudly (500).
  assertAnonKey(anonKey, functionName);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();
  if (error || !user) {
    throw new CallerAuthError(401, "Invalid session");
  }

  return { user: user as AuthenticatedCaller["user"], supabaseUrl, authHeader };
}
