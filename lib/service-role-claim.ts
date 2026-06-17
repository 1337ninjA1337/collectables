/**
 * BE-23 — service_role-claim self-check shared by every Edge Function.
 *
 * Every Edge Function that performs privileged work creates an admin client
 * with `SUPABASE_SERVICE_ROLE_KEY`. If that secret is misconfigured — empty,
 * or (the classic foot-gun) the **anon / publishable** key pasted in by
 * mistake — the admin client silently runs with end-user privileges instead
 * of bypassing RLS. The privileged writes then fail in confusing,
 * RLS-shaped ways (or, worse, partially succeed) rather than failing loudly.
 *
 * The legacy Supabase service-role key is a JWT whose payload carries a
 * `role` claim. The service key claims `"role": "service_role"`; the anon
 * key claims `"role": "anon"`. We decode that claim (NO signature
 * verification — we only own the secret, we're not validating a caller) and
 * assert it is `service_role`, so a swapped key is caught at function
 * boot/first-invocation rather than at the first failing query.
 *
 * Newer Supabase "secret keys" (`sb_secret_…`) and "publishable keys"
 * (`sb_publishable_…`) are opaque, not JWTs. We accept the `sb_secret_`
 * prefix (it is unambiguously a server-only key) and reject the
 * `sb_publishable_` prefix.
 *
 * The Edge Functions run under Deno but this module is pure and uses only
 * `atob` + `JSON` (available in both Deno and Node ≥16), so it is unit-tested
 * in Node and imported by the Deno functions with the `.ts` extension.
 */

export class ServiceRoleClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceRoleClaimError";
  }
}

/** Decode a base64url segment to a UTF-8 string (runtime-agnostic). */
function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  // `atob` yields a binary string; decode it as UTF-8 so multi-byte chars
  // in the (untrusted-to-us-but-self-owned) payload don't corrupt the parse.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Returns the `role` claim of a Supabase legacy JWT, or `null` when `key` is
 * not a decodable three-segment JWT with a JSON payload.
 */
export function decodeJwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Throws {@link ServiceRoleClaimError} unless `key` is a usable Supabase
 * service-role secret. `functionName` is woven into the message so the
 * Edge Function logs name the offender.
 */
export function assertServiceRoleKey(
  key: string | undefined | null,
  functionName: string,
): void {
  const prefix = `[${functionName}] SUPABASE_SERVICE_ROLE_KEY`;

  if (!key || key.trim() === "") {
    throw new ServiceRoleClaimError(`${prefix} is not set`);
  }

  if (key.startsWith("sb_publishable_")) {
    throw new ServiceRoleClaimError(
      `${prefix} carries a publishable key (sb_publishable_…) — you pasted the public/anon key; paste the secret (sb_secret_…) key instead`,
    );
  }
  if (key.startsWith("sb_secret_")) {
    // New-style server secret key: opaque, unambiguously server-only.
    return;
  }

  const role = decodeJwtRole(key);
  if (role === null) {
    throw new ServiceRoleClaimError(
      `${prefix} could not be parsed as a JWT or sb_secret_… key — it is malformed`,
    );
  }
  if (role !== "service_role") {
    throw new ServiceRoleClaimError(
      `${prefix} carries role "${role}" but must carry role "service_role" — you likely pasted the anon/publishable key`,
    );
  }
}

/**
 * Companion self-check for Edge Functions whose privileged secret is the
 * *anon* key (e.g. `delete-image`, which only verifies the caller's session
 * and must NOT hold a service-role key in that slot). Throws
 * {@link ServiceRoleClaimError} unless `key` is a usable Supabase anon key:
 * the legacy anon JWT (role `"anon"`) or a new-style publishable key
 * (`sb_publishable_…`). A pasted service-role key is rejected so a
 * privileged secret never ends up wired to the user-Authorization client.
 */
export function assertAnonKey(
  key: string | undefined | null,
  functionName: string,
): void {
  const prefix = `[${functionName}] SUPABASE_ANON_KEY`;

  if (!key || key.trim() === "") {
    throw new ServiceRoleClaimError(`${prefix} is not set`);
  }

  if (key.startsWith("sb_publishable_")) {
    return;
  }
  if (key.startsWith("sb_secret_")) {
    throw new ServiceRoleClaimError(
      `${prefix} carries a secret key (sb_secret_…) — paste the publishable/anon (sb_publishable_…) key here instead`,
    );
  }

  const role = decodeJwtRole(key);
  if (role === null) {
    throw new ServiceRoleClaimError(
      `${prefix} could not be parsed as a JWT or sb_publishable_… key — it is malformed`,
    );
  }
  if (role !== "anon") {
    throw new ServiceRoleClaimError(
      `${prefix} carries role "${role}" but must carry role "anon" — you likely pasted the service-role/secret key`,
    );
  }
}
