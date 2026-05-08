/**
 * analytics-mirror — Supabase Edge Function (Analytics #13).
 *
 * Receives PostHog webhook payloads and INSERTs them into
 * `public.analytics_events` (Analytics #12 schema). Lets us own a long-tail
 * event store independent of PostHog's free-tier retention so Power BI /
 * SQL queries can run over historical data even after we churn off PostHog.
 *
 * Auth model:
 *   - PostHog signs each webhook with a shared secret. We compare the
 *     `x-posthog-webhook-secret` header (configured in the PostHog UI) to
 *     the `POSTHOG_WEBHOOK_SECRET` Edge Function secret using a constant-time
 *     compare so a leaked timing channel can't probe the secret byte-by-byte.
 *   - Inserts use the Supabase `service_role` key (set as Edge Function
 *     secret) so they bypass the default-deny RLS on `analytics_events`.
 *
 * Payload handling:
 *   - PostHog can send a single event `{event, ...}` or a batch
 *     `{batch: [{event, ...}, ...]}`. Both are accepted.
 *   - Each event is normalised via `buildAnalyticsEventRow` (see
 *     `lib/analytics-mirror-payload.ts`), which strips `$`-prefixed PostHog
 *     meta-properties and coerces `distinct_id` to a UUID `user_id` (or NULL
 *     for anonymous distinct_ids so the FK doesn't reject the row).
 *   - We respond 207 with per-event statuses if some rows fail validation,
 *     200 if all succeed, 4xx for whole-payload errors. Never 5xx for a
 *     malformed individual event so PostHog doesn't keep retrying.
 *
 * Configure the webhook in PostHog (manual step, see MANUAL-TASKS.md):
 *   1. Project → Apps → Webhook destination
 *   2. URL: https://<project>.supabase.co/functions/v1/analytics-mirror
 *   3. Header: `x-posthog-webhook-secret: <POSTHOG_WEBHOOK_SECRET>`
 *   4. Filter: all events (or restrict to the typed-union event names).
 */

// @ts-nocheck — file runs under Deno, not Node; the relative import resolves
// the typed transformer at deploy time via supabase/functions/_shared linking
// (see comment below) and the ambient `Deno` global is provided by the runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  buildAnalyticsEventRow,
  AnalyticsMirrorPayloadError,
  type PostHogWebhookEvent,
  type AnalyticsEventRow,
} from "../../../lib/analytics-mirror-payload.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-posthog-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Constant-time string compare to defeat timing-channel probes against the
 * shared webhook secret. Branches only on length (already-known public info).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function extractEvents(payload: unknown): PostHogWebhookEvent[] {
  if (payload && typeof payload === "object" && Array.isArray((payload as { batch?: unknown }).batch)) {
    return (payload as { batch: PostHogWebhookEvent[] }).batch;
  }
  if (payload && typeof payload === "object") {
    return [payload as PostHogWebhookEvent];
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("POSTHOG_WEBHOOK_SECRET");
  if (!expectedSecret) {
    return jsonResponse({ error: "function not configured" }, 500);
  }

  const providedSecret = req.headers.get("x-posthog-webhook-secret") ?? "";
  if (!timingSafeEqual(providedSecret, expectedSecret)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const events = extractEvents(payload);
  if (events.length === 0) {
    return jsonResponse({ error: "empty payload" }, 400);
  }

  const rows: AnalyticsEventRow[] = [];
  const errors: { index: number; error: string }[] = [];
  for (let i = 0; i < events.length; i++) {
    try {
      rows.push(buildAnalyticsEventRow(events[i]));
    } catch (err) {
      const message =
        err instanceof AnalyticsMirrorPayloadError
          ? err.message
          : (err as Error).message ?? "unknown error";
      errors.push({ index: i, error: message });
    }
  }

  if (rows.length === 0) {
    return jsonResponse({ error: "no valid events", errors }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "function not configured" }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: insertError } = await adminClient
    .from("analytics_events")
    .insert(rows);

  if (insertError) {
    return jsonResponse(
      { error: insertError.message, inserted: 0, errors },
      500,
    );
  }

  return jsonResponse(
    { inserted: rows.length, errors },
    errors.length === 0 ? 200 : 207,
  );
});
