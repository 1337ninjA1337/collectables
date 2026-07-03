import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildAnomalyEnvelope,
  parseSentryDsn,
  reportMirrorAnomaly,
  type MirrorAnomaly,
} from "../supabase/functions/_shared/sentry-report";

/**
 * Edge Function → Sentry anomaly reporting
 * (`supabase/functions/_shared/sentry-report.ts`).
 *
 * The helper is pure (Fetch/crypto globals, injected fetcher), so the REAL
 * module is executed here; the adopting Deno function (`analytics-mirror`)
 * gets structural guards at the bottom — same split as the other `_shared`
 * suites.
 */

const ANOMALY: MirrorAnomaly = { status: 207, invalidCount: 3, insertedCount: 7 };

describe("parseSentryDsn", () => {
  it("parses a canonical DSN into the envelope endpoint + public key", () => {
    const dsn = parseSentryDsn("https://abc123@o450.ingest.sentry.io/4505");
    assert.deepEqual(dsn, {
      envelopeUrl: "https://o450.ingest.sentry.io/api/4505/envelope/",
      publicKey: "abc123",
    });
  });

  it("rejects missing, blank, and malformed DSNs (e.g. a pasted Slack webhook)", () => {
    assert.equal(parseSentryDsn(null), null);
    assert.equal(parseSentryDsn(undefined), null);
    assert.equal(parseSentryDsn(""), null);
    assert.equal(parseSentryDsn("https://hooks.slack.com/services/T0/B0/x"), null);
    assert.equal(parseSentryDsn("https://key@host/not-a-number"), null);
  });
});

describe("buildAnomalyEnvelope", () => {
  const dsn = parseSentryDsn("https://pk@sentry.example/42")!;
  const envelope = buildAnomalyEnvelope(dsn, ANOMALY, "2026-07-03T00:00:00.000Z", "e".repeat(32));
  const [header, itemHeader, event] = envelope.split("\n").map((l) => JSON.parse(l));

  it("is three newline-separated JSON lines (envelope format)", () => {
    assert.equal(envelope.split("\n").length, 3);
    assert.equal(itemHeader.type, "event");
    assert.equal(header.event_id, "e".repeat(32));
  });

  it("ships a warning-level event tagged to the function with both counts", () => {
    assert.equal(event.level, "warning");
    assert.equal(event.tags.function, "analytics-mirror");
    assert.equal(event.tags.status, "207");
    assert.equal(event.extra.invalidCount, 3);
    assert.equal(event.extra.insertedCount, 7);
    assert.match(event.message.formatted, /3 invalid event\(s\), 7 inserted/);
  });

  it("carries counts only — no webhook payload fields that could hold PII", () => {
    assert.doesNotMatch(envelope, /properties|distinct_id|user_id/);
  });
});

describe("reportMirrorAnomaly", () => {
  it("POSTs the envelope to the DSN's envelope endpoint with the sentry auth header", async () => {
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
    const ok = await reportMirrorAnomaly(
      "https://pk@sentry.example/42",
      ANOMALY,
      async (url, init) => {
        calls.push({ url, init });
        return { ok: true };
      },
    );
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://sentry.example/api/42/envelope/");
    assert.equal(calls[0].init.method, "POST");
    assert.match(calls[0].init.headers["X-Sentry-Auth"], /sentry_key=pk/);
    assert.match(calls[0].init.headers["Content-Type"], /x-sentry-envelope/);
    assert.match(calls[0].init.body, /"level":"warning"/);
  });

  it("no-ops (false, no fetch) when the SENTRY_DSN secret is unset or malformed", async () => {
    let fetched = 0;
    const fetcher = async () => {
      fetched++;
      return {};
    };
    assert.equal(await reportMirrorAnomaly(undefined, ANOMALY, fetcher), false);
    assert.equal(await reportMirrorAnomaly("garbage", ANOMALY, fetcher), false);
    assert.equal(fetched, 0);
  });

  it("resolves false instead of throwing when the POST fails (telemetry never breaks the response)", async () => {
    const ok = await reportMirrorAnomaly("https://pk@sentry.example/42", ANOMALY, async () => {
      throw new Error("network down");
    });
    assert.equal(ok, false);
  });
});

describe("sentry-report — structural adoption (analytics-mirror)", () => {
  const FN_SOURCE = readFileSync(
    path.join(process.cwd(), "supabase", "functions", "analytics-mirror", "index.ts"),
    "utf8",
  );

  it("fires the report on the partial-success path, gated on errors and fire-and-forget", () => {
    assert.match(FN_SOURCE, /from\s+['"]\.\.\/_shared\/sentry-report\.ts['"]/);
    assert.match(FN_SOURCE, /if \(errors\.length > 0\) \{\s*void reportMirrorAnomaly\(/);
    assert.match(FN_SOURCE, /Deno\.env\.get\(['"]SENTRY_DSN['"]\)/);
  });

  it("reports counts only — never the errors array or raw payload", () => {
    const callBlock = FN_SOURCE.match(/void reportMirrorAnomaly\([\s\S]*?\);/)![0];
    assert.match(callBlock, /invalidCount: errors\.length/);
    // The raw errors array (or body) must never be passed — counts only.
    assert.doesNotMatch(callBlock, /errors\s*[,}]/);
    assert.doesNotMatch(callBlock, /payload|bodyText/);
  });
});
