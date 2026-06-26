import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  assertServiceRoleKey,
  ServiceRoleClaimError,
} from "../../../lib/service-role-claim.ts";
import { assertCaller } from "../_shared/assert-caller.ts";
import { evaluateCors, forbiddenOriginResponse } from "../_shared/cors.ts";

/**
 * BE-22b — `validate-premium` Edge Function.
 *
 * Premium entitlement used to live purely in AsyncStorage, so any client could
 * grant itself paid features by writing the local flag. The `subscriptions`
 * table (BE-22a) is the server-authoritative source of truth — but RLS grants
 * the end-user only SELECT on their own row; all writes are service_role-only.
 *
 * This function is that service_role writer. It validates the caller via
 * `auth.getUser()` (the subject is always the authenticated caller, never a
 * body-supplied id), then under the service-role key:
 *
 *   - action "validate" (default): reads the caller's row and lazily expires a
 *     lapsed period (`status='active'` whose `current_period_end` is in the
 *     past becomes `status='expired'`) so a churned subscription stops gating
 *     paid features even if the client never calls again;
 *   - action "activate": upserts the caller's row to a fresh active period
 *     (`status='active'`, `activated_at=now`, `current_period_end=now+30d`),
 *     idempotent against an already-active period (it returns the existing
 *     entitlement unchanged rather than resetting the clock).
 *
 * It returns the narrow server-validated entitlement `{ isPremium,
 * activatedAt, expiresAt }`. The client wrapper `cloudValidatePremium()` in
 * `lib/supabase-subscriptions.ts` consumes it; BE-22c LWW-merges it over the
 * local cache so paid features gate on the server row, not local storage.
 *
 * The premium period length mirrors `PREMIUM_PERIOD_DAYS` in
 * `lib/premium-helpers.ts`; the active-check mirrors `isSubscriptionActive` in
 * `lib/subscriptions.ts` (re-declared here because the Deno runtime can't
 * resolve the app's `@/` path alias).
 */

const PREMIUM_PERIOD_DAYS = 30;
const MS_PER_DAY = 86_400_000;

type SubscriptionRow = {
  user_id: string;
  status: string;
  activated_at: string | null;
  current_period_end: string | null;
  deleted_at: string | null;
};

type PremiumValidation = {
  isPremium: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
};

function parsableTime(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Mirrors `isSubscriptionActive` (lib/subscriptions.ts). */
function isActive(row: SubscriptionRow | null | undefined, nowMs: number): boolean {
  if (!row) return false;
  if (row.deleted_at) return false;
  if (row.status !== "active") return false;
  const end = parsableTime(row.current_period_end);
  if (end === null) return true;
  return end > nowMs;
}

/** Mirrors `rowToValidation` (lib/subscriptions.ts). */
function toValidation(row: SubscriptionRow | null | undefined, nowMs: number): PremiumValidation {
  const active = isActive(row, nowMs);
  return {
    isPremium: active,
    activatedAt:
      active && typeof row?.activated_at === "string" && row.activated_at.length > 0
        ? row.activated_at
        : null,
    expiresAt:
      active && typeof row?.current_period_end === "string" && row.current_period_end.length > 0
        ? row.current_period_end
        : null,
  };
}

Deno.serve(async (req) => {
  // SEC-10: centralised CORS — reflect only allow-listed origins, reject other
  // browser origins outright before any work.
  const cors = evaluateCors(req, { allowedOriginsEnv: Deno.env.get("ALLOWED_ORIGINS") });
  const corsHeaders = cors.headers;
  if (!cors.allowed) return forbiddenOriginResponse(corsHeaders);

  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    // SEC-9: verify the caller (Authorization header + auth.getUser()) BEFORE
    // reading the service-role secret or running the privileged upsert.
    const auth = await assertCaller(req, corsHeaders, (authHeader) =>
      createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      }).auth.getUser(),
    );
    if (!auth.ok) return auth.response;

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // BE-23: fail loudly if the service-role secret is missing or is actually
    // the anon/publishable key — otherwise the privileged upsert below runs
    // under RLS (which forbids client writes) and silently does nothing.
    try {
      assertServiceRoleKey(serviceRoleKey, "validate-premium");
    } catch (configErr) {
      if (configErr instanceof ServiceRoleClaimError) {
        console.error(configErr.message);
        return json({ error: "function misconfigured" }, 500);
      }
      throw configErr;
    }

    const user = auth.user;

    let payload: { action?: unknown };
    try {
      payload = await req.json();
    } catch {
      // An empty/absent body is allowed — default to "validate".
      payload = {};
    }

    const action = payload.action === undefined ? "validate" : payload.action;
    if (action !== "validate" && action !== "activate") {
      return json({ error: "invalid action" }, 400);
    }

    // The subject is always the authenticated caller, never a body value.
    const userId = user.id;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const { data: existing, error: readError } = await adminClient
      .from("subscriptions")
      .select("user_id, status, activated_at, current_period_end, deleted_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    const current = existing as SubscriptionRow | null;

    if (action === "activate") {
      // Idempotent: an already-active period is returned as-is (don't reset the
      // clock on a repeated activate), mirroring `activatePremiumState`.
      if (isActive(current, nowMs)) {
        return json(toValidation(current, nowMs), 200);
      }
      const periodEnd = new Date(nowMs + PREMIUM_PERIOD_DAYS * MS_PER_DAY).toISOString();
      const { data: upserted, error: upsertError } = await adminClient
        .from("subscriptions")
        .upsert(
          {
            user_id: userId,
            status: "active",
            activated_at: nowIso,
            current_period_end: periodEnd,
            deleted_at: null,
          },
          { onConflict: "user_id" },
        )
        .select("user_id, status, activated_at, current_period_end, deleted_at")
        .maybeSingle();

      if (upsertError) {
        return json({ error: upsertError.message }, 500);
      }
      return json(toValidation(upserted as SubscriptionRow | null, nowMs), 200);
    }

    // action === "validate": lazily expire a lapsed active period so a churned
    // subscription stops gating paid features even without a fresh activate.
    if (current && current.status === "active" && !isActive(current, nowMs)) {
      const { error: expireError } = await adminClient
        .from("subscriptions")
        .update({ status: "expired" })
        .eq("user_id", userId);
      if (expireError) {
        return json({ error: expireError.message }, 500);
      }
    }

    return json(toValidation(current, nowMs), 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
