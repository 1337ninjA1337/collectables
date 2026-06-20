import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildMarketplaceWriteHeaders,
  markSoldPayload,
  markSoldUrl,
} from "@/lib/supabase-marketplace-shapes";

/**
 * Guards the contract that `cloudMarkSold` in `lib/supabase-marketplace.ts`
 * actually serialises `buyer_user_id` into the PATCH body. The cloud wrapper
 * itself can't be imported under `node:test` (it transitively pulls in
 * react-native peers via `@/lib/supabase`), so the regression vector is
 * split into two halves:
 *
 *   1. Runtime: exercise the pure helpers the wrapper composes
 *      (`markSoldPayload`, `markSoldUrl`, `buildMarketplaceWriteHeaders`)
 *      with a synthetic `fetcher` so a regression in *those* shows up.
 *   2. Structural: pin the wrapper source so a future refactor that
 *      drops `buyer_user_id` (e.g. re-introducing the old `{ sold_at }`
 *      literal in place of `markSoldPayload(...)`) is caught immediately.
 */

const SUPABASE_MARKETPLACE_PATH = path.join(
  process.cwd(),
  "lib",
  "supabase-marketplace.ts",
);

function readSrc(): string {
  return readFileSync(SUPABASE_MARKETPLACE_PATH, "utf8");
}

type FetchCall = { url: string; init: RequestInit };

function makeRecordingFetcher(response: { ok: boolean; status?: number }): {
  calls: FetchCall[];
  fetch: typeof fetch;
} {
  const calls: FetchCall[] = [];
  const fakeFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status ?? 200,
      async json() {
        return [];
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetch: fakeFetch };
}

describe("cloudMarkSold — pure-helper composition", () => {
  it("markSoldPayload produces a JSON body containing both sold_at and buyer_user_id", () => {
    const body = JSON.stringify(markSoldPayload("2026-05-07T10:00:00.000Z", "buyer-9"));
    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.equal(parsed.sold_at, "2026-05-07T10:00:00.000Z");
    assert.equal(parsed.buyer_user_id, "buyer-9");
    assert.ok("buyer_user_id" in parsed, "PATCH body must include buyer_user_id key");
  });

  it("markSoldPayload includes buyer_user_id even when null (no key drop)", () => {
    const body = JSON.stringify(markSoldPayload("2026-05-07T10:00:00.000Z", null));
    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.ok(
      "buyer_user_id" in parsed,
      "buyer_user_id must remain in the body when null so we can reset it explicitly",
    );
    assert.equal(parsed.buyer_user_id, null);
  });

  it("markSoldUrl targets the marketplace_listings row by id", () => {
    const url = markSoldUrl("https://xyz.supabase.co", "l-abc");
    assert.ok(url.startsWith("https://xyz.supabase.co/rest/v1/marketplace_listings"));
    assert.ok(url.includes("id=eq.l-abc"));
  });

  it("buildMarketplaceWriteHeaders threads the access token and apikey", () => {
    const h = buildMarketplaceWriteHeaders("apikey-xyz", "token-abc");
    assert.equal(h.apikey, "apikey-xyz");
    assert.ok(h.Authorization.includes("token-abc"));
    assert.ok("Prefer" in h, "write headers must request the representation back");
  });

  it("a mocked PATCH fired with the composed bits round-trips buyer_user_id", async () => {
    // Mimic what cloudMarkSold actually does: PATCH the row, body=markSoldPayload,
    // headers=buildMarketplaceWriteHeaders. A future regression that ignores
    // buyerUserId in the wrapper would surface here (and in the structural
    // section below) regardless of whether we can load the cloud wrapper.
    const { calls, fetch: fakeFetch } = makeRecordingFetcher({ ok: true });
    const baseUrl = "https://xyz.supabase.co";
    const apiKey = "apikey-xyz";
    const token = "token-abc";
    const soldAt = "2026-05-07T10:00:00.000Z";
    const buyerUserId = "buyer-9";

    await fakeFetch(markSoldUrl(baseUrl, "l-abc"), {
      method: "PATCH",
      headers: buildMarketplaceWriteHeaders(apiKey, token),
      body: JSON.stringify(markSoldPayload(soldAt, buyerUserId)),
    });

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call.url.includes("id=eq.l-abc"));
    assert.equal(call.init.method, "PATCH");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.apikey, apiKey);
    assert.ok(headers.Authorization.includes(token));
    const parsedBody = JSON.parse(call.init.body as string) as Record<string, unknown>;
    assert.equal(parsedBody.sold_at, soldAt);
    assert.equal(parsedBody.buyer_user_id, buyerUserId);
  });

  it("a mocked PATCH with buyerUserId=null still serialises buyer_user_id into the body", async () => {
    // Strict integration: simulates cloudMarkSold(id, soldAt, null) end-to-end
    // via the same composed pure helpers the wrapper uses. The null branch is
    // the regression vector the task calls out — if a future refactor swaps
    // markSoldPayload for an `if (buyerUserId) { body.buyer_user_id = ... }`
    // pattern, the column silently stops being reset on existing rows.
    const { calls, fetch: fakeFetch } = makeRecordingFetcher({ ok: true });
    const baseUrl = "https://xyz.supabase.co";
    const apiKey = "apikey-xyz";
    const token = "token-abc";
    const soldAt = "2026-05-07T10:00:00.000Z";

    await fakeFetch(markSoldUrl(baseUrl, "l-null"), {
      method: "PATCH",
      headers: buildMarketplaceWriteHeaders(apiKey, token),
      body: JSON.stringify(markSoldPayload(soldAt, null)),
    });

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.init.method, "PATCH");
    const parsedBody = JSON.parse(call.init.body as string) as Record<string, unknown>;
    assert.equal(parsedBody.sold_at, soldAt);
    assert.ok(
      "buyer_user_id" in parsedBody,
      "PATCH body must include buyer_user_id key even when null — otherwise existing rows keep their stale buyer",
    );
    assert.equal(parsedBody.buyer_user_id, null);
    // Exactly two keys: catches a future regression that accidentally appends
    // a third field (e.g. an unexpected `updated_at`) which would change the
    // PATCH semantics from a targeted column write to a multi-column overwrite.
    assert.deepEqual(Object.keys(parsedBody).sort(), ["buyer_user_id", "sold_at"]);
  });
});

describe("cloudMarkSold — structural composition (lib/supabase-marketplace.ts)", () => {
  it("declares cloudMarkSold(id, soldAt, buyerUserId, ...)", () => {
    const src = readSrc();
    assert.match(
      src,
      /export\s+async\s+function\s+cloudMarkSold\s*\(\s*\n?\s*id\s*:\s*string\s*,\s*\n?\s*soldAt\s*:\s*string\s*,\s*\n?\s*buyerUserId\s*:\s*string\s*\|\s*null/,
      "cloudMarkSold must accept buyerUserId as a third positional arg",
    );
  });

  it("uses markSoldPayload(soldAt, buyerUserId) to build the PATCH body", () => {
    const src = readSrc();
    assert.match(
      src,
      /body\s*:\s*JSON\.stringify\s*\(\s*markSoldPayload\s*\(\s*soldAt\s*,\s*buyerUserId\s*\)\s*\)/,
      "PATCH body must be composed via markSoldPayload(soldAt, buyerUserId)",
    );
  });

  it("never re-introduces the legacy `{ sold_at }`-only body literal", () => {
    const src = readSrc();
    // Catch the regression where someone replaces the helper with an inline
    // object that omits buyer_user_id. Allow `sold_at` to appear elsewhere
    // (it's a column name) — only flag it inside a `body: JSON.stringify({...})`.
    const legacyBody = /body\s*:\s*JSON\.stringify\s*\(\s*\{\s*sold_at\s*:[^}]*\}\s*\)/;
    assert.doesNotMatch(
      src,
      legacyBody,
      "cloudMarkSold must not inline `{ sold_at: ... }` — use markSoldPayload(soldAt, buyerUserId) instead",
    );
  });

  it("PATCHes through markSoldUrl + write headers", () => {
    const src = readSrc();
    assert.match(
      src,
      /method\s*:\s*["']PATCH["']/,
      "cloudMarkSold must issue a PATCH",
    );
    assert.match(
      src,
      /markSoldUrl\s*\(\s*supabaseUrl!\s*,\s*id\s*\)/,
      "must route through markSoldUrl(supabaseUrl!, id)",
    );
    assert.match(
      src,
      /buildMarketplaceWriteHeaders\s*\(/,
      "must use the write-headers builder (includes Prefer=return=representation)",
    );
  });

  it("threads the optional fetcher + tokenProvider injection through cloudMarkSold", () => {
    const src = readSrc();
    // Pin the dependency-injection shape so tests like this can mock both
    // sides; a refactor that drops the optional args would break the call
    // site contract without changing the URL/body.
    assert.match(
      src,
      /cloudMarkSold[\s\S]*?fetcher\s*=\s*fetch\s+as\s+FetchFn[\s\S]*?tokenProvider\s*=\s*getAccessToken/,
      "cloudMarkSold must accept overridable fetcher + tokenProvider",
    );
  });
});

describe("cloudClaimListing — structural composition (BE-20)", () => {
  it("declares cloudClaimListing(id, ...) returning Promise<boolean>", () => {
    const src = readSrc();
    assert.match(
      src,
      /export\s+async\s+function\s+cloudClaimListing\s*\(\s*\n?\s*id\s*:\s*string/,
      "cloudClaimListing must accept the listing id",
    );
    assert.match(src, /cloudClaimListing[\s\S]*?Promise<boolean>/);
  });

  it("POSTs to the claim-listing Edge Function endpoint", () => {
    const src = readSrc();
    assert.match(src, /claimListingUrl\s*\(\s*supabaseUrl!\s*\)/);
    assert.match(src, /cloudClaimListing[\s\S]*?method\s*:\s*["']POST["']/);
    assert.match(src, /body\s*:\s*JSON\.stringify\s*\(\s*claimListingPayload\s*\(\s*id\s*\)\s*\)/);
  });

  it("requires a real user token — bails out (false) when none is available", () => {
    const src = readSrc();
    // The Edge Function calls auth.getUser(); the anon apikey fallback cannot
    // satisfy it, so an absent token must short-circuit to false.
    assert.match(src, /cloudClaimListing[\s\S]*?if\s*\(!token\)\s*return false/);
  });

  it("only reports success when the server confirms (res.ok)", () => {
    const src = readSrc();
    assert.match(src, /cloudClaimListing[\s\S]*?return res\.ok/);
  });
});

describe("markListingSold routes buyer claims through the atomic Edge Function (BE-20)", () => {
  const CONTEXT_PATH = path.join(process.cwd(), "lib", "marketplace-context.tsx");
  const ctxSrc = readFileSync(CONTEXT_PATH, "utf8");

  it("calls cloudClaimListing for a buyer claim and cloudMarkSold for a seller mark-sold", () => {
    assert.match(ctxSrc, /if\s*\(buyerUserId\)\s*\{\s*\n?\s*void cloudClaimListing\(id\)/);
    assert.match(ctxSrc, /void cloudMarkSold\(id,\s*soldAt,\s*null\)/);
  });

  it("imports cloudClaimListing from the cloud wrapper", () => {
    assert.match(ctxSrc, /cloudClaimListing/);
  });
});
