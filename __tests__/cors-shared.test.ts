import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  evaluateCors,
  forbiddenOriginResponse,
  getAllowedOrigins,
  isOriginAllowed,
  GITHUB_PAGES_ORIGIN,
  DEEP_LINK_ORIGIN,
} from "../supabase/functions/_shared/cors";

/**
 * SEC-10 — centralised Edge Function CORS.
 *
 * The policy module (`supabase/functions/_shared/cors.ts`) is PURE — it uses
 * only the Fetch `Request`/`Response` globals available in both Deno and Node —
 * so it gets full behavioural coverage here (the real module, executed). The
 * seven Edge Functions that adopt it run under Deno, so they get source-level
 * structural assertions that the wildcard is gone and the shared gate is wired
 * in before any work.
 */

function reqWithOrigin(origin: string | null, method = "POST"): Request {
  const headers: Record<string, string> = {};
  if (origin !== null) headers["Origin"] = origin;
  return new Request("https://fn.example/endpoint", { method, headers });
}

describe("cors — allow-list resolution", () => {
  it("defaults to the GitHub Pages origin + the deep-link", () => {
    assert.deepEqual(getAllowedOrigins(), [GITHUB_PAGES_ORIGIN, DEEP_LINK_ORIGIN]);
  });

  it("merges comma-separated ALLOWED_ORIGINS extras and de-dupes", () => {
    const origins = getAllowedOrigins("https://custom.example, http://localhost:8081");
    assert.deepEqual(origins, [
      GITHUB_PAGES_ORIGIN,
      DEEP_LINK_ORIGIN,
      "https://custom.example",
      "http://localhost:8081",
    ]);
  });

  it("ignores blank/whitespace-only extra entries", () => {
    assert.deepEqual(getAllowedOrigins("  , ,"), [GITHUB_PAGES_ORIGIN, DEEP_LINK_ORIGIN]);
  });

  it("does not duplicate an extra that equals a default", () => {
    assert.deepEqual(getAllowedOrigins(GITHUB_PAGES_ORIGIN), [
      GITHUB_PAGES_ORIGIN,
      DEEP_LINK_ORIGIN,
    ]);
  });

  it("treats a missing Origin as allowed (native app / server-to-server)", () => {
    assert.equal(isOriginAllowed(null, getAllowedOrigins()), true);
  });

  it("rejects a present Origin not in the list", () => {
    assert.equal(isOriginAllowed("https://evil.example", getAllowedOrigins()), false);
  });
});

describe("cors — evaluateCors decision + headers", () => {
  it("reflects an allow-listed browser origin back verbatim", () => {
    const cors = evaluateCors(reqWithOrigin(GITHUB_PAGES_ORIGIN));
    assert.equal(cors.allowed, true);
    assert.equal(cors.headers["Access-Control-Allow-Origin"], GITHUB_PAGES_ORIGIN);
    assert.equal(cors.headers["Vary"], "Origin");
  });

  it("allows the deep-link origin", () => {
    const cors = evaluateCors(reqWithOrigin(DEEP_LINK_ORIGIN));
    assert.equal(cors.allowed, true);
    assert.equal(cors.headers["Access-Control-Allow-Origin"], DEEP_LINK_ORIGIN);
  });

  it("allows an ALLOWED_ORIGINS-configured extra origin", () => {
    const cors = evaluateCors(reqWithOrigin("https://staging.example"), {
      allowedOriginsEnv: "https://staging.example",
    });
    assert.equal(cors.allowed, true);
    assert.equal(cors.headers["Access-Control-Allow-Origin"], "https://staging.example");
  });

  it("REJECTS a disallowed origin and never sets Allow-Origin", () => {
    const cors = evaluateCors(reqWithOrigin("https://evil.example"));
    assert.equal(cors.allowed, false);
    assert.equal(cors.headers["Access-Control-Allow-Origin"], undefined);
  });

  it("falls back to the GitHub Pages origin when no Origin header is present", () => {
    const cors = evaluateCors(reqWithOrigin(null));
    assert.equal(cors.allowed, true);
    assert.equal(cors.headers["Access-Control-Allow-Origin"], GITHUB_PAGES_ORIGIN);
  });

  it("always advertises POST + OPTIONS and the default allow-headers", () => {
    const cors = evaluateCors(reqWithOrigin(GITHUB_PAGES_ORIGIN));
    assert.equal(cors.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
    assert.match(cors.headers["Access-Control-Allow-Headers"], /authorization/);
    assert.match(cors.headers["Access-Control-Allow-Headers"], /content-type/);
  });

  it("appends extra allow-headers (e.g. the PostHog webhook secret header)", () => {
    const cors = evaluateCors(reqWithOrigin(null), {
      extraAllowHeaders: ["x-posthog-webhook-secret"],
    });
    assert.match(cors.headers["Access-Control-Allow-Headers"], /x-posthog-webhook-secret/);
  });
});

describe("cors — forbiddenOriginResponse", () => {
  it("is a 403 JSON {error} carrying the CORS headers", async () => {
    const cors = evaluateCors(reqWithOrigin("https://evil.example"));
    const res = forbiddenOriginResponse(cors.headers);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Content-Type"), "application/json");
    assert.equal(res.headers.get("Vary"), "Origin");
    // A rejected origin must NOT be granted access by the reply.
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.deepEqual(await res.json(), { error: "origin not allowed" });
  });
});

/**
 * Structural: every Edge Function must source its CORS from the shared module
 * and must NOT keep an inline wildcard that could drift out of the policy.
 */
const FUNCTIONS = [
  "delete-account",
  "delete-image",
  "claim-listing",
  "accept-friend-request",
  "validate-premium",
  "export-data",
  "analytics-mirror",
];

function fnSource(name: string): string {
  return readFileSync(
    path.join(process.cwd(), "supabase", "functions", name, "index.ts"),
    "utf8",
  );
}

describe("cors — adoption across Edge Functions (structural)", () => {
  for (const name of FUNCTIONS) {
    describe(name, () => {
      const src = fnSource(name);

      it("imports the shared cors gate", () => {
        assert.match(
          src,
          /import\s*\{[^}]*evaluateCors[^}]*\}\s*from\s*["']\.\.\/_shared\/cors\.ts["']/,
        );
      });

      it("evaluates CORS and rejects disallowed origins before any work", () => {
        assert.match(src, /evaluateCors\(\s*req,/);
        assert.match(src, /if \(!cors\.allowed\) return forbiddenOriginResponse\(corsHeaders\)/);
      });

      it("no longer inlines a wildcard Access-Control-Allow-Origin", () => {
        assert.doesNotMatch(src, /Access-Control-Allow-Origin["']\s*:\s*["']\*["']/);
      });
    });
  }
});
