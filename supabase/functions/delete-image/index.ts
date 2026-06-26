import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  assertAnonKey,
  ServiceRoleClaimError,
} from "../../../lib/service-role-claim.ts";
import { assertCaller } from "../_shared/assert-caller.ts";

// SEC-1: the Cloudinary API secret must NEVER reach the client bundle.
// This function holds CLOUDINARY_API_SECRET in Supabase function secrets,
// verifies the caller's Supabase session (mirrors delete-account), and
// computes the destroy signature server-side. The client only ever sends
// the list of public IDs to delete + its own JWT.

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

async function cloudinarySignature(
  publicId: string,
  timestamp: string,
  apiSecret: string,
): Promise<string> {
  // Cloudinary destroy: SHA-1 of the alphabetically-sorted params
  // (public_id before timestamp) followed by the API secret.
  const signatureString = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const buffer = new TextEncoder().encode(signatureString);
  const hash = await crypto.subtle.digest("SHA-1", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // BE-23: fail loudly if the anon secret is missing or is actually the
    // service-role/secret key (a privileged key must never be wired to the
    // user-Authorization client used for session verification).
    try {
      assertAnonKey(anonKey, "delete-image");
    } catch (configErr) {
      if (configErr instanceof ServiceRoleClaimError) {
        console.error(configErr.message);
        return json({ error: "function misconfigured" }, 500);
      }
      throw configErr;
    }

    // SEC-9: verify the caller (Authorization header + auth.getUser()) BEFORE
    // signing any Cloudinary destroy with the server-only API secret.
    const auth = await assertCaller(req, corsHeaders, (authHeader) =>
      createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      }).auth.getUser(),
    );
    if (!auth.ok) return auth.response;

    const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
    const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
    const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
    if (!cloudName || !apiKey || !apiSecret) {
      return json({ error: "Cloudinary not configured" }, 500);
    }

    const body = (await req.json().catch(() => null)) as
      | { publicIds?: unknown }
      | null;
    const publicIds = Array.isArray(body?.publicIds)
      ? body!.publicIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (publicIds.length === 0) {
      return json({ error: "No publicIds" }, 400);
    }

    const destroyUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`;

    const results = await Promise.allSettled(
      publicIds.map(async (publicId) => {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = await cloudinarySignature(publicId, timestamp, apiSecret);
        const form = new FormData();
        form.append("public_id", publicId);
        form.append("timestamp", timestamp);
        form.append("api_key", apiKey);
        form.append("signature", signature);
        const res = await fetch(destroyUrl, { method: "POST", body: form });
        if (!res.ok) {
          throw new Error(`destroy failed: ${res.status}`);
        }
      }),
    );

    const deleted = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - deleted;
    return json({ success: true, deleted, failed }, 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
