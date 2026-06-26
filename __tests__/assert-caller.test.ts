import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertCaller,
  jsonError,
  type GetUserResult,
} from "../supabase/functions/_shared/assert-caller";

/**
 * SEC-9 — shared `assertCaller` caller-authentication gate.
 *
 * The helper (`supabase/functions/_shared/assert-caller.ts`) is PURE — it
 * imports no `esm.sh` Supabase client and uses only the Fetch `Request`/
 * `Response` globals available in both Deno and Node — so it gets full
 * behavioural coverage here (the real function, executed). The six Edge
 * Functions that adopt it run under Deno, so they get source-level structural
 * assertions that the gate is wired in and fires before any privileged work.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reqWith(authHeader: string | null): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers["Authorization"] = authHeader;
  return new Request("https://fn.example/endpoint", { method: "POST", headers });
}

const okUser: GetUserResult = { data: { user: { id: "user-123" } }, error: null };

describe("assertCaller — behavioural (pure helper, runs under Node)", () => {
  it("returns ok with the verified user + auth header when the token is valid", async () => {
    let seenHeader: string | null = null;
    const result = await assertCaller(reqWith("Bearer good-token"), CORS, (h) => {
      seenHeader = h;
      return okUser;
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.id, "user-123");
      assert.equal(result.authHeader, "Bearer good-token");
    }
    assert.equal(seenHeader, "Bearer good-token");
  });

  it("rejects a missing Authorization header with 401 BEFORE calling verifyToken", async () => {
    let called = false;
    const result = await assertCaller(reqWith(null), CORS, () => {
      called = true;
      return okUser;
    });
    assert.equal(result.ok, false);
    // The privileged verify path must never run for an unauthenticated request.
    assert.equal(called, false);
    if (!result.ok) {
      assert.equal(result.response.status, 401);
      const body = await result.response.json();
      assert.equal(body.error, "Missing authorization");
    }
  });

  it("rejects a blank Authorization header with 401 (treats whitespace as absent)", async () => {
    let called = false;
    const result = await assertCaller(reqWith("   "), CORS, () => {
      called = true;
      return okUser;
    });
    assert.equal(result.ok, false);
    assert.equal(called, false);
    if (!result.ok) assert.equal(result.response.status, 401);
  });

  it("rejects when getUser() returns an error (expired/forged token) with 401 Invalid session", async () => {
    const result = await assertCaller(reqWith("Bearer expired"), CORS, () => ({
      data: { user: null },
      error: { message: "jwt expired" },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 401);
      const body = await result.response.json();
      assert.equal(body.error, "Invalid session");
    }
  });

  it("rejects when getUser() yields no user with 401 Invalid session", async () => {
    const result = await assertCaller(reqWith("Bearer ghost"), CORS, () => ({
      data: { user: null },
      error: null,
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 401);
  });

  it("fails closed (401) when verifyToken itself throws", async () => {
    const result = await assertCaller(reqWith("Bearer x"), CORS, () => {
      throw new Error("network down");
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 401);
      const body = await result.response.json();
      assert.equal(body.error, "Invalid session");
    }
  });

  it("awaits an async verifyToken (Promise) and resolves the user", async () => {
    const result = await assertCaller(reqWith("Bearer async"), CORS, async (h) => {
      assert.equal(h, "Bearer async");
      return okUser;
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.user.id, "user-123");
  });

  it("attaches the function's CORS headers + JSON content-type to error responses", async () => {
    const result = await assertCaller(reqWith(null), CORS, () => okUser);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.response.headers.get("Access-Control-Allow-Origin"),
        "*",
      );
      assert.equal(
        result.response.headers.get("Content-Type"),
        "application/json",
      );
    }
  });

  it("jsonError builds the {error} body with status + CORS headers", async () => {
    const res = jsonError("boom", 418, CORS);
    assert.equal(res.status, 418);
    assert.equal(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
    assert.deepEqual(await res.json(), { error: "boom" });
  });
});

/**
 * Structural: every privileged Edge Function in scope must delegate its
 * Authorization-header + auth.getUser() handshake to the shared gate, and must
 * NOT keep an inline copy that could drift out of the security contract.
 */
const ADOPTERS = [
  "delete-account",
  "delete-image",
  "claim-listing",
  "accept-friend-request",
  "validate-premium",
  "export-data",
];

function fnSource(name: string): string {
  return readFileSync(
    path.join(process.cwd(), "supabase", "functions", name, "index.ts"),
    "utf8",
  );
}

describe("assertCaller — adoption across Edge Functions (structural)", () => {
  for (const name of ADOPTERS) {
    describe(name, () => {
      const src = fnSource(name);

      it("imports assertCaller from the shared module", () => {
        assert.match(
          src,
          /import\s*\{\s*assertCaller\s*\}\s*from\s*["']\.\.\/_shared\/assert-caller\.ts["']/,
        );
      });

      it("invokes assertCaller and early-returns its 401 response", () => {
        assert.match(src, /await assertCaller\(\s*req,\s*corsHeaders,/);
        assert.match(src, /if \(!auth\.ok\) return auth\.response/);
      });

      it("no longer inlines the Authorization-header read or the 401 strings", () => {
        // The handshake (header read + the "Missing authorization"/"Invalid
        // session" 401s) now lives ONLY in the shared gate; `auth.getUser()`
        // remains, but only as the thunk passed into assertCaller.
        assert.doesNotMatch(src, /req\.headers\.get\(\s*["']Authorization["']\s*\)/);
        assert.doesNotMatch(src, /Missing authorization/);
        assert.doesNotMatch(src, /Invalid session/);
      });

      it("derives the acting subject from the verified caller, never the body", () => {
        // After adoption the only `user` is `auth.user` (no body-supplied id).
        if (/auth\.user/.test(src)) {
          assert.doesNotMatch(src, /const userId = payload/);
        }
      });
    });
  }
});
