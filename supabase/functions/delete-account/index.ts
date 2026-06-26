import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { assertServiceRoleKey } from "../../../lib/service-role-claim.ts";
import {
  assertCaller,
  CallerAuthError,
  ServiceRoleClaimError,
} from "../_shared/assert-caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // SEC-9: verify the caller holds a valid session before any service-role op.
    let caller;
    try {
      caller = await assertCaller(req, "delete-account");
    } catch (authErr) {
      if (authErr instanceof CallerAuthError) {
        return new Response(JSON.stringify({ error: authErr.message }), {
          status: authErr.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (authErr instanceof ServiceRoleClaimError) {
        console.error(authErr.message);
        return new Response(JSON.stringify({ error: "function misconfigured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw authErr;
    }

    const supabaseUrl = caller.supabaseUrl;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // BE-23: fail loudly if the service-role secret is missing or is actually
    // the anon/publishable key — otherwise the admin deletes below silently
    // run without RLS-bypass and fail in confusing ways.
    try {
      assertServiceRoleKey(serviceRoleKey, "delete-account");
    } catch (configErr) {
      if (configErr instanceof ServiceRoleClaimError) {
        console.error(configErr.message);
        return new Response(JSON.stringify({ error: "function misconfigured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw configErr;
    }

    const userId = caller.user.id;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    await adminClient.from("reactions").delete().eq("user_id", userId);
    await adminClient.from("items").delete().eq("created_by_user_id", userId);
    await adminClient.from("collection_follows").delete().eq("user_id", userId);
    await adminClient.from("collections").delete().eq("owner_user_id", userId);
    await adminClient.from("friend_requests").delete().or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);
    await adminClient.from("profiles").delete().eq("id", userId);

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
