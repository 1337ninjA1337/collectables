/**
 * Minimal Sentry reporting for Edge Functions (today: analytics-mirror's
 * partial-success path). A `207` with `errors[]` entries means PostHog sent
 * events the transformer rejected — previously that was silent unless an
 * operator grepped Edge Function logs. Cross-tagging a warning into Sentry
 * puts webhook anomalies on the same pane of glass as app crashes.
 *
 * Deliberately NOT the Sentry SDK: the function only needs to emit one small
 * warning event, and the SDK would add a network import + init cost to every
 * cold start. Instead this builds a minimal envelope by hand and POSTs it to
 * the DSN's `/envelope/` endpoint (same target `lib/sentry-doctor.ts` probes)
 * — fire-and-forget, never throwing, no-op unless the optional `SENTRY_DSN`
 * Edge Function secret is set.
 *
 * A Sentry "breadcrumb" cannot exist standalone (crumbs attach to events),
 * so the partial-success signal ships as a warning-level *event* — that is
 * what actually surfaces in the dashboard and can be alerted on.
 *
 * The module is PURE — Fetch/crypto globals only, fetcher injected — so the
 * real helper is unit-tested in Node while the Deno functions import it with
 * the `.ts` extension (same pattern as the other `_shared` modules). It does
 * NOT import `lib/sentry-doctor.ts`: that module's import chain uses
 * extension-less specifiers Deno can't resolve.
 */

export type ParsedSentryDsn = {
  /** `https://host/api/<projectId>/envelope/` ingest endpoint. */
  envelopeUrl: string;
  publicKey: string;
};

const DSN_RE = /^(https?):\/\/([^:@]+)@([^/]+)\/(\d+)$/;

/** Parse a canonical Sentry DSN; null on anything malformed. */
export function parseSentryDsn(raw: string | null | undefined): ParsedSentryDsn | null {
  if (!raw) return null;
  const match = raw.trim().match(DSN_RE);
  if (!match) return null;
  const [, scheme, publicKey, host, projectId] = match;
  return {
    envelopeUrl: `${scheme}://${host}/api/${projectId}/envelope/`,
    publicKey,
  };
}

export type MirrorAnomaly = {
  /** Response status the function is about to return (207 today). */
  status: number;
  /** How many webhook events failed row-validation. */
  invalidCount: number;
  /** How many rows were inserted successfully. */
  insertedCount: number;
};

/**
 * Serialise a warning event into Sentry's envelope format (header line,
 * item-header line, payload line — newline-separated JSON). Counts only —
 * no event payloads, so no PII can ride along (SEC-13/SEC-20 hygiene).
 */
export function buildAnomalyEnvelope(
  dsn: ParsedSentryDsn,
  anomaly: MirrorAnomaly,
  nowIso: string,
  eventId: string,
): string {
  const event = {
    event_id: eventId,
    timestamp: nowIso,
    platform: "javascript",
    level: "warning",
    logger: "analytics-mirror",
    message: {
      formatted: `analytics-mirror partial success: ${anomaly.invalidCount} invalid event(s), ${anomaly.insertedCount} inserted`,
    },
    tags: {
      function: "analytics-mirror",
      status: String(anomaly.status),
    },
    extra: {
      invalidCount: anomaly.invalidCount,
      insertedCount: anomaly.insertedCount,
    },
  };
  const header = { event_id: eventId, dsn_public_key: dsn.publicKey, sent_at: nowIso };
  const itemHeader = { type: "event" };
  return `${JSON.stringify(header)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(event)}`;
}

export type SentryFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<unknown>;

/**
 * Fire the anomaly at Sentry. Resolves `false` (never throws) when the DSN
 * is unset/malformed or the POST fails — telemetry must never break the
 * webhook response path.
 */
export async function reportMirrorAnomaly(
  dsnRaw: string | null | undefined,
  anomaly: MirrorAnomaly,
  fetcher: SentryFetcher,
): Promise<boolean> {
  const dsn = parseSentryDsn(dsnRaw);
  if (!dsn) return false;
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const body = buildAnomalyEnvelope(dsn, anomaly, new Date().toISOString(), eventId);
  try {
    await fetcher(dsn.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=collectables-edge/1.0`,
      },
      body,
    });
    return true;
  } catch {
    return false;
  }
}
