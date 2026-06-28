import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  assertAnonKey,
  ServiceRoleClaimError,
} from "../../../lib/service-role-claim.ts";
import {
  cloudinaryUploadSignature,
  uploadFolderForUser,
} from "../../../lib/cloudinary-signed-upload.ts";
import { assertCaller } from "../_shared/assert-caller.ts";
import { evaluateCors, forbiddenOriginResponse } from "../_shared/cors.ts";

// SEC-5: the unsigned Cloudinary `upload_preset` is an open write endpoint —
// anyone with the public bundle can upload arbitrary media to the account.
// This function holds CLOUDINARY_API_SECRET in Supabase function secrets,
// verifies the caller's Supabase session (mirrors delete-image), and signs an
// upload scoped to the caller's OWN per-user folder server-side. The client
// receives only a short-lived signature + the params to echo back to Cloudinary
// — never the API secret, and never a folder it didn't authenticate into.

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
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // BE-23: fail loudly if the anon secret is missing or is actually the
    // service-role/secret key (a privileged key must never back the
    // user-Authorization client used for session verification).
    try {
      assertAnonKey(anonKey, "sign-upload");
    } catch (configErr) {
      if (configErr instanceof ServiceRoleClaimError) {
        console.error(configErr.message);
        return json({ error: "function misconfigured" }, 500);
      }
      throw configErr;
    }

    // SEC-9: verify the caller (Authorization header + auth.getUser()) BEFORE
    // signing anything with the server-only Cloudinary API secret.
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

    // Subject is the validated session user — never a body-supplied id — so the
    // caller can only ever obtain a signature for their own folder.
    const folder = uploadFolderForUser(auth.user.id);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await cloudinaryUploadSignature(
      { folder, timestamp },
      apiSecret,
    );

    return json({ cloudName, apiKey, timestamp, signature, folder }, 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
