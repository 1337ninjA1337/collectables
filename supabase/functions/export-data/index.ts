import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { assertServiceRoleKey } from "../../../lib/service-role-claim.ts";
import {
  assertCaller,
  CallerAuthError,
  ServiceRoleClaimError,
} from "../_shared/assert-caller.ts";

/**
 * BE-26 — GDPR `export-data` Edge Function.
 *
 * Implements the user's right to data portability (GDPR Art. 20): it streams
 * back, as a single downloadable JSON document, everything the app stores keyed
 * on the caller's `auth.uid()`:
 *
 *   - their `profiles` row,
 *   - the `collections` they own (`owner_user_id`),
 *   - the `items` they authored (`created_by_user_id`),
 *   - their `friend_requests` (both directions),
 *   - their `chat_messages` (sent + received),
 *   - their `subscriptions` history.
 *
 * The caller is always validated via `auth.getUser()` and the export is subject
 * to that authenticated user — never a body-supplied id. Reads run under the
 * service-role key (with the BE-23 self-check) so the export sees every row
 * regardless of the end-user's RLS read scope, while still being scoped to the
 * caller by the explicit `.eq()`/`.or()` filters below.
 *
 * The response is built as a JSON document by the local `buildDocument` helper,
 * which mirrors `buildDataExport` in `lib/data-export.ts` (re-declared here
 * because the Deno runtime can't resolve the app's `@/` path alias). The client
 * wrapper `cloudExportData()` in `lib/supabase-data-export.ts` consumes it.
 */

const DATA_EXPORT_VERSION = 1;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Row => typeof row === "object" && row !== null);
}

/** Mirrors `buildDataExport` (lib/data-export.ts). */
function buildDocument(parts: {
  userId: string;
  profile: unknown;
  collections: unknown;
  items: unknown;
  friendRequests: unknown;
  chatMessages: unknown;
  subscriptions: unknown;
}): Row {
  const profile =
    typeof parts.profile === "object" && parts.profile !== null ? (parts.profile as Row) : null;
  return {
    version: DATA_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    userId: parts.userId,
    profile,
    collections: asRows(parts.collections),
    items: asRows(parts.items),
    friendRequests: asRows(parts.friendRequests),
    chatMessages: asRows(parts.chatMessages),
    subscriptions: asRows(parts.subscriptions),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  try {
    // SEC-9: verify the caller holds a valid session before any service-role op.
    let caller;
    try {
      caller = await assertCaller(req, "export-data");
    } catch (authErr) {
      if (authErr instanceof CallerAuthError) {
        return json({ error: authErr.message }, authErr.status);
      }
      if (authErr instanceof ServiceRoleClaimError) {
        console.error(authErr.message);
        return json({ error: "function misconfigured" }, 500);
      }
      throw authErr;
    }

    const supabaseUrl = caller.supabaseUrl;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // BE-23: fail loudly if the service-role secret is missing or is actually
    // the anon/publishable key — otherwise the reads below run under RLS and the
    // export silently omits rows the end-user can't see directly.
    try {
      assertServiceRoleKey(serviceRoleKey, "export-data");
    } catch (configErr) {
      if (configErr instanceof ServiceRoleClaimError) {
        console.error(configErr.message);
        return json({ error: "function misconfigured" }, 500);
      }
      throw configErr;
    }

    // The subject is always the authenticated caller, never a body value.
    const userId = caller.user.id;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const [profile, collections, items, friendRequests, chatMessages, subscriptions] =
      await Promise.all([
        adminClient.from("profiles").select("*").eq("id", userId).maybeSingle(),
        adminClient.from("collections").select("*").eq("owner_user_id", userId),
        adminClient.from("items").select("*").eq("created_by_user_id", userId),
        adminClient
          .from("friend_requests")
          .select("*")
          .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`),
        adminClient
          .from("chat_messages")
          .select("*")
          .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`),
        adminClient.from("subscriptions").select("*").eq("user_id", userId),
      ]);

    for (const result of [profile, collections, items, friendRequests, chatMessages, subscriptions]) {
      if (result.error) {
        return json({ error: result.error.message }, 500);
      }
    }

    const document = buildDocument({
      userId,
      profile: profile.data,
      collections: collections.data,
      items: items.data,
      friendRequests: friendRequests.data,
      chatMessages: chatMessages.data,
      subscriptions: subscriptions.data,
    });

    const fileName = `collectables-export-${new Date().toISOString().slice(0, 10)}.json`;
    return json(document, 200, {
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
