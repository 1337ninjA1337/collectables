import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions on the analytics-mirror Edge Function. The function
 * runs under Deno (not Node), so we assert source-level invariants instead of
 * executing it: secret comparison, RLS-bypass via service_role key, payload
 * shape handling, CORS headers, and the Analytics #12 schema mapping.
 *
 * Behavioural coverage of the payload transformer (the part that *can* run
 * under Node) lives in `__tests__/analytics-mirror-payload.test.ts`.
 */

const FUNCTION_PATH = path.join(
  process.cwd(),
  "supabase",
  "functions",
  "analytics-mirror",
  "index.ts",
);

const SOURCE = readFileSync(FUNCTION_PATH, "utf8");

describe("analytics-mirror Edge Function", () => {
  it("exists at the documented path", () => {
    assert.ok(statSync(FUNCTION_PATH).isFile());
  });

  it("uses Deno.serve as the entrypoint (Edge Function convention)", () => {
    assert.match(SOURCE, /Deno\.serve\s*\(/);
  });

  it("imports the payload transformer rather than re-rolling it", () => {
    assert.match(
      SOURCE,
      /from\s+['"][^'"]*lib\/analytics-mirror-payload\.ts['"]/,
    );
    assert.match(SOURCE, /buildAnalyticsEventRow/);
  });

  it("loads the shared webhook secret from POSTHOG_WEBHOOK_SECRET env", () => {
    assert.match(
      SOURCE,
      /Deno\.env\.get\(['"]POSTHOG_WEBHOOK_SECRET['"]\)/,
    );
  });

  it("reads the secret from a custom header (x-posthog-webhook-secret)", () => {
    assert.match(
      SOURCE,
      /req\.headers\.get\(['"]x-posthog-webhook-secret['"]\)/,
    );
  });

  it("compares the secret in constant time (XOR-accumulator over every char)", () => {
    assert.match(SOURCE, /timingSafeEqual/);
    const fnBlock = SOURCE.match(/function timingSafeEqual[\s\S]*?\n}/);
    assert.ok(fnBlock, "timingSafeEqual function not found");
    const body = fnBlock![0];
    // XOR-accumulator pattern means no early break inside the loop.
    assert.match(body, /diff\s*\|=/);
    // The only `return false` allowed is the length-mismatch guard before
    // the loop. Confirm no `return false` appears between `for (` and the
    // closing `}` of the function (simple substring slice check).
    const forIdx = body.indexOf("for (");
    if (forIdx >= 0) {
      const loopAndAfter = body.slice(forIdx);
      assert.doesNotMatch(loopAndAfter, /return false/);
    }
  });

  it("inserts via the service_role key (bypassing analytics_events RLS)", () => {
    assert.match(
      SOURCE,
      /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/,
    );
    assert.match(
      SOURCE,
      /from\(['"]analytics_events['"]\)[\s\S]*\.insert\(/,
    );
  });

  it("targets the analytics_events table (matches Analytics #12 schema)", () => {
    assert.match(SOURCE, /['"]analytics_events['"]/);
  });

  it("accepts both single-event and batch payloads", () => {
    assert.match(SOURCE, /batch/);
    assert.match(SOURCE, /extractEvents/);
  });

  it("handles CORS preflight (OPTIONS)", () => {
    assert.match(SOURCE, /req\.method\s*===\s*['"]OPTIONS['"]/);
    assert.match(SOURCE, /Access-Control-Allow-Methods/);
  });

  it("rejects non-POST methods with 405", () => {
    assert.match(
      SOURCE,
      /method not allowed[\s\S]*405|405[\s\S]*method not allowed/,
    );
  });

  it("returns 401 on a missing or wrong secret", () => {
    assert.match(SOURCE, /unauthorized[\s\S]*401|401[\s\S]*unauthorized/);
  });

  it("returns 400 on invalid JSON or empty payload (no PostHog retry storms)", () => {
    assert.match(SOURCE, /invalid json[\s\S]*400|400[\s\S]*invalid json/);
    assert.match(SOURCE, /empty payload[\s\S]*400|400[\s\S]*empty payload/);
  });

  it("returns 207 when the payload is partial-success (some rows rejected)", () => {
    assert.match(SOURCE, /207/);
  });

  it("collects per-event errors instead of aborting on the first invalid row", () => {
    assert.match(SOURCE, /errors\.push/);
    assert.match(SOURCE, /AnalyticsMirrorPayloadError/);
  });
});
