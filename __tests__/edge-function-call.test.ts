import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EDGE_FUNCTION_FALLBACK_ERROR,
  EDGE_FUNCTION_NO_SESSION,
  callEdgeFunction,
  edgeFunctionDeletedCount,
  edgeFunctionError,
  edgeFunctionUrl,
  type EdgeFunctionFetch,
  type EdgeFunctionTransport,
} from "@/lib/edge-function-call";

import { readRepoFile } from "./helpers/repo-file";

const BASE = "https://proj.supabase.co";

/** A transport whose fetch answers with `response`, recording what it was sent. */
function transport(
  response: EdgeFunctionFetch,
  token: string | null = "tok",
): EdgeFunctionTransport {
  return { baseUrl: BASE, apiKey: "anon-key", token: () => Promise.resolve(token), fetch: response };
}

/** A response with a body that parses. */
function responds(ok: boolean, body: unknown): EdgeFunctionFetch {
  return () => Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

describe("edgeFunctionUrl", () => {
  it("puts the function where Supabase serves it", () => {
    assert.equal(
      edgeFunctionUrl(BASE, "delete-account"),
      "https://proj.supabase.co/functions/v1/delete-account",
    );
  });
});

describe("callEdgeFunction — a rejected transport is a value, not a throw", () => {
  it("returns the reason instead of rejecting", async () => {
    // THE BUG. `deleteAccountViaEdgeFunction` used this envelope without a
    // `try`, so an offline tap threw past `auth-context` and `app/settings.tsx`
    // — both `try … finally` with no `catch` — and the user got no alert, no
    // navigation and no record, on the one screen whose failure matters most.
    const result = await callEdgeFunction(
      transport(() => Promise.reject(new Error("Network request failed"))),
      "delete-account",
    );
    assert.deepEqual(result, { ok: false, error: "Network request failed" });
  });

  it("does not reject even when the error is not an Error", async () => {
    // A rejected `fetch` in a browser can hand over a DOMException or a
    // string. `(err as Error).message` is `undefined` for those, which must
    // still be a result rather than an exception.
    const result = await callEdgeFunction(
      transport(() => Promise.reject("refused")),
      "delete-image",
      { publicIds: ["a"] },
    );
    assert.equal(result.ok, false);
  });

  it("answers before fetching when there is no session", async () => {
    let called = false;
    const result = await callEdgeFunction(
      transport(() => {
        called = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }, null),
      "delete-account",
    );
    assert.deepEqual(result, { ok: false, error: EDGE_FUNCTION_NO_SESSION });
    assert.equal(called, false, "a call with no token was sent anyway");
  });
});

describe("callEdgeFunction — what it sends", () => {
  it("carries the session token and the api key", async () => {
    let seen: { url: string; headers: Record<string, string>; body?: string } | null = null;
    await callEdgeFunction(
      transport((url, init) => {
        seen = { url, headers: init.headers, body: init.body };
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
      "delete-account",
    );
    assert.ok(seen);
    const sent = seen as unknown as { url: string; headers: Record<string, string>; body?: string };
    assert.equal(sent.url, `${BASE}/functions/v1/delete-account`);
    assert.equal(sent.headers.Authorization, "Bearer tok");
    assert.equal(sent.headers.apikey, "anon-key");
  });

  it("omits the body entirely when there is none", async () => {
    // `delete-account` takes no arguments and was always sent body-less; a
    // `JSON.stringify(undefined)` would have put the string "undefined" on
    // the wire.
    let body: string | undefined = "sentinel";
    await callEdgeFunction(
      transport((_url, init) => {
        body = init.body;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }),
      "delete-account",
    );
    assert.equal(body, undefined);
  });

  it("serialises the body when there is one", async () => {
    let body: string | undefined;
    await callEdgeFunction(
      transport((_url, init) => {
        body = init.body;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: 1 }) });
      }),
      "delete-image",
      { publicIds: ["a", "b"] },
    );
    assert.equal(body, JSON.stringify({ publicIds: ["a", "b"] }));
  });
});

describe("callEdgeFunction — what it reads back", () => {
  it("passes a successful body through", async () => {
    const result = await callEdgeFunction(transport(responds(true, { deleted: 3 })), "delete-image");
    assert.deepEqual(result, { ok: true, body: { deleted: 3 } });
  });

  it("reports the server's own message on a non-OK status", async () => {
    const result = await callEdgeFunction(
      transport(responds(false, { error: "service_role key missing" })),
      "delete-account",
    );
    assert.deepEqual(result, { ok: false, error: "service_role key missing" });
  });

  it("falls back when the failure body cannot be parsed", async () => {
    // An HTML error page from a gateway is the realistic case: `res.json()`
    // rejects, and a reader that did not catch it would turn a 502 into a
    // thrown exception — the same defect one layer down.
    const result = await callEdgeFunction(
      transport(() => Promise.resolve({ ok: false, json: () => Promise.reject(new Error("bad json")) })),
      "delete-account",
    );
    assert.deepEqual(result, { ok: false, error: EDGE_FUNCTION_FALLBACK_ERROR });
  });

  it("survives a success body that cannot be parsed", async () => {
    const result = await callEdgeFunction(
      transport(() => Promise.resolve({ ok: true, json: () => Promise.reject(new Error("bad json")) })),
      "delete-image",
    );
    assert.deepEqual(result, { ok: true, body: null });
  });
});

describe("edgeFunctionError", () => {
  it("takes the server's string", () => {
    assert.equal(edgeFunctionError({ error: "nope" }), "nope");
  });

  it("falls back for an error that is not a string", () => {
    // `res.json()` is `any`, so `data.error ?? fallback` used to pass an
    // object straight through as an error message. Nothing renders it today,
    // which is exactly why nobody would have noticed.
    assert.equal(edgeFunctionError({ error: { code: 500 } }), EDGE_FUNCTION_FALLBACK_ERROR);
    assert.equal(edgeFunctionError({ error: ["a"] }), EDGE_FUNCTION_FALLBACK_ERROR);
    assert.equal(edgeFunctionError({ error: 500 }), EDGE_FUNCTION_FALLBACK_ERROR);
  });

  it("falls back for an empty string, which says nothing", () => {
    assert.equal(edgeFunctionError({ error: "" }), EDGE_FUNCTION_FALLBACK_ERROR);
  });

  it("falls back for a body with no error at all, and for no body", () => {
    assert.equal(edgeFunctionError({}), EDGE_FUNCTION_FALLBACK_ERROR);
    assert.equal(edgeFunctionError(null), EDGE_FUNCTION_FALLBACK_ERROR);
    assert.equal(edgeFunctionError(undefined), EDGE_FUNCTION_FALLBACK_ERROR);
    assert.equal(edgeFunctionError("a string body"), EDGE_FUNCTION_FALLBACK_ERROR);
  });
});

describe("edgeFunctionDeletedCount", () => {
  it("reads the number the server reported", () => {
    assert.equal(edgeFunctionDeletedCount({ deleted: 4 }), 4);
    assert.equal(edgeFunctionDeletedCount({ deleted: 0 }), 0);
  });

  it("is 0 for anything that is not a finite number", () => {
    // Best-effort by contract: an orphaned Cloudinary asset is not a
    // data-loss bug, so "none reported" is the honest answer rather than an
    // error worth surfacing.
    assert.equal(edgeFunctionDeletedCount({ deleted: "4" }), 0);
    assert.equal(edgeFunctionDeletedCount({ deleted: Number.NaN }), 0);
    assert.equal(edgeFunctionDeletedCount({}), 0);
    assert.equal(edgeFunctionDeletedCount(null), 0);
    assert.equal(edgeFunctionDeletedCount(undefined), 0);
  });
});

describe("both Edge Function callers go through the one envelope", () => {
  // The asymmetry was invisible because each function read correctly on its
  // own. These hold the thing that was actually wrong: that there were two of
  // them.
  const src = readRepoFile("lib/supabase-profiles.ts");

  it("neither caller builds its own fetch to /functions/v1", () => {
    assert.ok(
      !/functions\/v1\//.test(src),
      "an Edge Function URL is built in the caller again",
    );
    assert.equal(
      src.split("callDeleteFunction(").length - 1,
      3,
      "a caller stopped going through the shared envelope (or a third one appeared)",
    );
  });

  it("the account deleter returns the envelope its signature promises", () => {
    assert.match(
      src,
      /deleteAccountViaEdgeFunction\(\): Promise<\{ error\?: string \}> \{[\s\S]*?return result\.ok \? \{\} : \{ error: result\.error \};/,
    );
  });

  it("the shared envelope is the pure module, not a second copy", () => {
    assert.match(src, /callEdgeFunction\(\s*\{ baseUrl: supabaseUrl, apiKey: supabaseKey, token: getAccessToken, fetch \}/);
    assert.ok(
      !/res\.json\(\)\.catch/.test(src),
      "the error read is back in the caller",
    );
  });
});
