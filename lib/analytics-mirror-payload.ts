/**
 * Typed transformer between PostHog's outgoing webhook payload and the row
 * shape expected by `public.analytics_events` (Analytics #12 schema).
 *
 * The Supabase Edge Function (`supabase/functions/analytics-mirror/index.ts`,
 * Analytics #13) imports this helper so the mapping is unit-tested in Node
 * even though the function itself runs under Deno.
 *
 * PostHog's webhook (https://posthog.com/docs/webhooks) sends one event per
 * POST. The shape we rely on:
 *
 *   {
 *     "event": "collection_created",
 *     "timestamp": "2026-05-08T12:34:56.789Z",
 *     "distinct_id": "user-uuid-or-anon-id",
 *     "properties": {
 *       "visibility": "public",
 *       "isPremium": true,
 *       "$lib": "posthog-js",
 *       ...
 *     }
 *   }
 *
 * We strip `$`-prefixed PostHog meta-properties (lib, lib_version, ip, etc.)
 * so the `properties` jsonb column only carries event-relevant data. The
 * `distinct_id` is treated as a Supabase auth `user_id` only when it parses
 * as a UUID — anonymous distinct_ids (e.g. PostHog-generated cookies) become
 * NULL so the FK to `auth.users` doesn't reject the insert.
 */

export type PostHogWebhookEvent = {
  event?: unknown;
  timestamp?: unknown;
  distinct_id?: unknown;
  properties?: unknown;
};

export type AnalyticsEventRow = {
  user_id: string | null;
  name: string;
  occurred_at: string;
  properties: Record<string, unknown>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NAME_MAX_LENGTH = 200;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function stripPosthogMeta(
  properties: unknown,
): Record<string, unknown> {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (key.startsWith("$")) continue;
    out[key] = value;
  }
  return out;
}

export function normaliseTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

export class AnalyticsMirrorPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsMirrorPayloadError";
  }
}

export function buildAnalyticsEventRow(
  event: PostHogWebhookEvent,
): AnalyticsEventRow {
  const name = event?.event;
  if (typeof name !== "string" || name.length === 0) {
    throw new AnalyticsMirrorPayloadError("missing event name");
  }
  if (name.length > NAME_MAX_LENGTH) {
    throw new AnalyticsMirrorPayloadError(
      `event name exceeds ${NAME_MAX_LENGTH} chars`,
    );
  }

  return {
    user_id: isUuid(event.distinct_id) ? (event.distinct_id as string) : null,
    name,
    occurred_at: normaliseTimestamp(event.timestamp),
    properties: stripPosthogMeta(event.properties),
  };
}
