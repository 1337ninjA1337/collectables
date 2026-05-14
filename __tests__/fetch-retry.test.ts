import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { fetchWithRetry, isSafariLoadFailed } from "@/lib/fetch-retry";

describe("isSafariLoadFailed", () => {
  it("matches the canonical iOS Safari 18 fetch flake", () => {
    assert.equal(isSafariLoadFailed(new TypeError("Load failed")), true);
  });

  it("matches a case-insensitive 'load failed' substring", () => {
    assert.equal(isSafariLoadFailed(new TypeError("load failed (foo)")), true);
  });

  it("rejects other TypeErrors", () => {
    assert.equal(isSafariLoadFailed(new TypeError("Failed to fetch")), false);
    assert.equal(isSafariLoadFailed(new TypeError("NetworkError")), false);
  });

  it("rejects non-TypeError errors with the same message", () => {
    assert.equal(isSafariLoadFailed(new Error("Load failed")), false);
  });

  it("returns false for non-Error values", () => {
    assert.equal(isSafariLoadFailed("Load failed"), false);
    assert.equal(isSafariLoadFailed(null), false);
    assert.equal(isSafariLoadFailed(undefined), false);
    assert.equal(isSafariLoadFailed({ message: "Load failed" }), false);
  });
});

describe("fetchWithRetry", () => {
  function makeResponse(): Response {
    return new Response("ok", { status: 200 });
  }

  it("returns the first response when fetch succeeds", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return makeResponse();
    }) as typeof fetch;
    const res = await fetchWithRetry("https://example.com", undefined, { fetcher });
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
  });

  it("retries once on TypeError('Load failed')", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("Load failed");
      return makeResponse();
    }) as typeof fetch;
    const res = await fetchWithRetry("https://example.com", undefined, {
      fetcher,
      delayMs: 0,
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 2);
  });

  it("respects the configurable retry count", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      if (calls < 3) throw new TypeError("Load failed");
      return makeResponse();
    }) as typeof fetch;
    const res = await fetchWithRetry("https://example.com", undefined, {
      fetcher,
      retries: 2,
      delayMs: 0,
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
  });

  it("rethrows the final error when retries are exhausted", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      throw new TypeError("Load failed");
    }) as typeof fetch;
    await assert.rejects(
      fetchWithRetry("https://example.com", undefined, { fetcher, delayMs: 0 }),
      (err) => err instanceof TypeError && /load failed/i.test(err.message),
    );
    assert.equal(calls, 2);
  });

  it("does not retry non-Safari errors", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(
      fetchWithRetry("https://example.com", undefined, { fetcher, delayMs: 0 }),
    );
    assert.equal(calls, 1);
  });

  it("does not retry HTTP error responses (those are not throws)", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    const res = await fetchWithRetry("https://example.com", undefined, {
      fetcher,
      delayMs: 0,
    });
    assert.equal(res.status, 500);
    assert.equal(calls, 1);
  });

  it("supports a custom shouldRetry predicate", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      if (calls === 1) throw new Error("custom retryable");
      return makeResponse();
    }) as typeof fetch;
    const res = await fetchWithRetry("https://example.com", undefined, {
      fetcher,
      delayMs: 0,
      shouldRetry: (err) => err instanceof Error && err.message === "custom retryable",
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 2);
  });
});

describe("supabase fetch retry wiring", () => {
  const repoRoot = path.join(__dirname, "..");

  it("supabase-profiles.ts imports fetchWithRetry", () => {
    const source = fs.readFileSync(path.join(repoRoot, "lib", "supabase-profiles.ts"), "utf8");
    assert.match(source, /from "@\/lib\/fetch-retry"/);
    assert.match(source, /fetchWithRetry/);
  });

  it("supabaseRest no longer sends empty Prefer or Content-Type on GET", () => {
    const source = fs.readFileSync(path.join(repoRoot, "lib", "supabase-profiles.ts"), "utf8");
    assert.doesNotMatch(source, /Prefer: options\.method === "POST" \?/);
    // The new branch only sets Content-Type when there is a body.
    assert.match(source, /if \(options\.body !== undefined\)/);
  });

  it("supabase-chat.ts imports fetchWithRetry and defaults its fetcher to it", () => {
    const source = fs.readFileSync(path.join(repoRoot, "lib", "supabase-chat.ts"), "utf8");
    assert.match(source, /from "@\/lib\/fetch-retry"/);
    assert.match(source, /fetcher = fetchWithRetry as FetchFn/);
  });
});

describe("chat-context unhandled rejection guards", () => {
  const repoRoot = path.join(__dirname, "..");

  it("imports captureException", () => {
    const source = fs.readFileSync(path.join(repoRoot, "lib", "chat-context.tsx"), "utf8");
    assert.match(source, /import \{ captureException \} from "@\/lib\/sentry"/);
  });

  it("wraps both cloud-fetch async IIFEs in try/catch", () => {
    const source = fs.readFileSync(path.join(repoRoot, "lib", "chat-context.tsx"), "utf8");
    const matches = source.match(/captureException\(err, \{ context: "chat-context\./g);
    assert.ok(matches && matches.length >= 2, "expected at least two captureException calls in chat-context");
  });
});
