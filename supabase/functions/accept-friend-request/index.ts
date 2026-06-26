import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  assertServiceRoleKey,
  ServiceRoleClaimError,
} from "../../../lib/service-role-claim.ts";
import { assertCaller } from "../_shared/assert-caller.ts";
import { evaluateCors, forbiddenOriginResponse } from "../_shared/cors.ts";

/**
 * BE-21 — `accept-friend-request` Edge Function.
 *
 * A friendship is mutual: it exists only when both directed `friend_requests`
 * rows are present (sender→acceptor AND acceptor→sender). Accepting an incoming
 * request is therefore inserting the reverse direction. Doing that purely
 * client-side has a gap: a plain INSERT of the acceptor→sender row never checks
 * that the inbound sender→acceptor request still exists, so if the sender
 * withdrew it concurrently the client leaves a dangling one-way row that looks
 * like a *new* outgoing request — the opposite of "accept".
 *
 * This function closes that gap server-side. It validates the caller via
 * `auth.getUser()` (the caller is always the acceptor — never a body-supplied
 * id), then runs the flip through the `accept_friend_request(p_from, p_to)` SQL
 * function under the service-role key. That function locks the inbound row
 * `FOR UPDATE`, raises `P0002` if it is gone, and inserts the reverse direction
 * idempotently — so both directions become present, or neither does, atomically.
 */

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
    // reading the service-role secret or running the privileged RPC.
    const auth = await assertCaller(req, corsHeaders, (authHeader) =>
      createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      }).auth.getUser(),
    );
    if (!auth.ok) return auth.response;

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // BE-23: fail loudly if the service-role secret is missing or is actually
    // the anon/publishable key — otherwise the privileged RPC below runs under
    // RLS and the transactional guarantee silently evaporates.
    try {
      assertServiceRoleKey(serviceRoleKey, "accept-friend-request");
    } catch (configErr) {
      if (configErr instanceof ServiceRoleClaimError) {
        console.error(configErr.message);
        return json({ error: "function misconfigured" }, 500);
      }
      throw configErr;
    }

    const user = auth.user;

    let payload: { fromUserId?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    const fromUserId = typeof payload.fromUserId === "string" ? payload.fromUserId.trim() : "";
    if (!fromUserId) {
      return json({ error: "missing fromUserId" }, 400);
    }

    // The acceptor is always the authenticated caller, never a body value.
    const toUserId = user.id;
    if (fromUserId === toUserId) {
      return json({ error: "cannot accept your own request" }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // The atomic flip: lock the inbound row, insert the reverse iff it exists.
    const { data: rows, error: rpcError } = await adminClient.rpc("accept_friend_request", {
      p_from_user_id: fromUserId,
      p_to_user_id: toUserId,
    });

    if (rpcError) {
      // P0002 (no_data_found) is raised when the inbound request is gone —
      // the sender withdrew it concurrently. Surface it as a precise 409.
      if (rpcError.code === "P0002" || /no pending friend request/.test(rpcError.message ?? "")) {
        return json({ error: "no pending friend request" }, 409);
      }
      return json({ error: rpcError.message }, 500);
    }

    return json({ success: true, friendRequests: rows ?? [] }, 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
