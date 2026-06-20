import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  assertServiceRoleKey,
  ServiceRoleClaimError,
} from "../../../lib/service-role-claim.ts";

/**
 * BE-20 — `claim-listing` Edge Function.
 *
 * A buyer claims a marketplace listing (marks it sold to themselves). Doing
 * this purely client-side via the `marketplace_listings_update_buyer_claim`
 * RLS policy has two gaps:
 *   1. it is not atomic against a double-claim — two buyers can both read
 *      `sold_at IS NULL`, then both PATCH, and the last writer silently wins
 *      (or both "succeed" and one buyer is left believing they own it);
 *   2. it does not stop a seller from "buying" their own listing.
 *
 * This function closes both gaps server-side. It runs the claim as a single
 * conditional UPDATE under the service-role key:
 *
 *   UPDATE marketplace_listings
 *      SET buyer_user_id = <caller>, sold_at = now()
 *    WHERE id = <id> AND sold_at IS NULL AND owner_user_id <> <caller>
 *   RETURNING *
 *
 * PostgreSQL locks the target row for the duration of the UPDATE and
 * re-evaluates the `sold_at IS NULL` predicate after the lock is acquired, so
 * exactly one concurrent caller can win. Zero returned rows means the claim
 * was rejected; we then read the row back to return a precise reason
 * (404 not found, 409 already sold, 409 own listing).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // BE-23: fail loudly if the service-role secret is missing or is actually
    // the anon/publishable key — otherwise the conditional UPDATE below runs
    // under RLS and the atomicity guarantee silently evaporates.
    try {
      assertServiceRoleKey(serviceRoleKey, "claim-listing");
    } catch (configErr) {
      if (configErr instanceof ServiceRoleClaimError) {
        console.error(configErr.message);
        return json({ error: "function misconfigured" }, 500);
      }
      throw configErr;
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ error: "Invalid session" }, 401);
    }

    let payload: { id?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    if (!id) {
      return json({ error: "missing listing id" }, 400);
    }

    const buyerUserId = user.id;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // The atomic claim: only an active listing the caller does not own flips.
    const soldAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await adminClient
      .from("marketplace_listings")
      .update({ buyer_user_id: buyerUserId, sold_at: soldAt })
      .eq("id", id)
      .is("sold_at", null)
      .neq("owner_user_id", buyerUserId)
      .select();

    if (claimError) {
      return json({ error: claimError.message }, 500);
    }

    if (claimed && claimed.length > 0) {
      return json({ success: true, listing: claimed[0] }, 200);
    }

    // Zero rows updated — read the row back to return a precise reason.
    const { data: existing } = await adminClient
      .from("marketplace_listings")
      .select("id, owner_user_id, sold_at")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return json({ error: "listing not found" }, 404);
    }
    if (existing.owner_user_id === buyerUserId) {
      return json({ error: "cannot claim your own listing" }, 409);
    }
    if (existing.sold_at) {
      return json({ error: "listing already claimed" }, 409);
    }
    // Shouldn't happen, but never report a phantom success.
    return json({ error: "claim rejected" }, 409);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
