import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_INSERT_TIMEOUT_MS,
  resolveInsertTimeoutMs,
  withTimeout,
} from "../supabase/functions/_shared/insert-timeout";

/**
 * Shared webhook insert-timeout gate
 * (`supabase/functions/_shared/insert-timeout.ts`).
 *
 * The helper is pure (setTimeout/clearTimeout globals only), so the REAL
 * module is executed here; the adopting Deno function (`analytics-mirror`)
 * gets structural guards at the bottom — same split as `_shared/cors.ts` /
 * `payload-limit.ts`.
 */

describe("resolveInsertTimeoutMs", () => {
  it("defaults to 5 seconds when the secret is unset", () => {
    assert.equal(DEFAULT_INSERT_TIMEOUT_MS, 5000);
    assert.equal(resolveInsertTimeoutMs(undefined), 5000);
    assert.equal(resolveInsertTimeoutMs(null), 5000);
  });

  it("honours a plain numeric override (with whitespace tolerated)", () => {
    assert.equal(resolveInsertTimeoutMs("2500"), 2500);
    assert.equal(resolveInsertTimeoutMs(" 10000 "), 10000);
  });

  it("falls back on blank, non-numeric, zero, negative, or fractional values", () => {
    assert.equal(resolveInsertTimeoutMs(""), 5000);
    assert.equal(resolveInsertTimeoutMs("fast"), 5000);
    assert.equal(resolveInsertTimeoutMs("0"), 5000);
    assert.equal(resolveInsertTimeoutMs("-100"), 5000);
    assert.equal(resolveInsertTimeoutMs("2.5"), 5000);
  });

  it("falls back on unsafe-integer overflow and honours a custom fallback", () => {
    assert.equal(resolveInsertTimeoutMs("9".repeat(40)), 5000);
    assert.equal(resolveInsertTimeoutMs("junk", 750), 750);
  });
});

describe("withTimeout", () => {
  it("resolves with the value when the work wins the race", async () => {
    const result = await withTimeout(Promise.resolve("row"), 1000);
    assert.deepEqual(result, { timedOut: false, value: "row" });
  });

  it("resolves timedOut when the deadline wins", async () => {
    const never = new Promise<string>(() => {});
    const result = await withTimeout(never, 20);
    assert.deepEqual(result, { timedOut: true });
  });

  it("propagates a rejection from the work, never masking it as a timeout", async () => {
    await assert.rejects(
      () => withTimeout(Promise.reject(new Error("db down")), 1000),
      /db down/,
    );
  });

  it("accepts a thenable (the supabase-js insert builder is one, not a Promise)", async () => {
    const thenable: PromiseLike<number> = {
      then(onFulfilled) {
        return Promise.resolve(7).then(onFulfilled);
      },
    };
    const result = await withTimeout(thenable, 1000);
    assert.deepEqual(result, { timedOut: false, value: 7 });
  });

  it("a fast win does not leave the process hanging on the timer", async () => {
    // clearTimeout in the finally means this test file itself exits promptly;
    // structurally pin the cleanup too.
    const source = readFileSync(
      path.join(
        process.cwd(),
        "supabase",
        "functions",
        "_shared",
        "insert-timeout.ts",
      ),
      "utf8",
    );
    assert.match(source, /finally\s*\{\s*clearTimeout\(timer\);/);
    const result = await withTimeout(Promise.resolve(1), 60_000);
    assert.equal(result.timedOut, false);
  });
});

describe("insert-timeout — structural adoption (analytics-mirror)", () => {
  const FN_SOURCE = readFileSync(
    path.join(
      process.cwd(),
      "supabase",
      "functions",
      "analytics-mirror",
      "index.ts",
    ),
    "utf8",
  );

  it("imports the shared gate and reads the POSTHOG_WEBHOOK_TIMEOUT_MS secret", () => {
    assert.match(FN_SOURCE, /from\s+['"]\.\.\/_shared\/insert-timeout\.ts['"]/);
    assert.match(
      FN_SOURCE,
      /resolveInsertTimeoutMs\(\s*Deno\.env\.get\(['"]POSTHOG_WEBHOOK_TIMEOUT_MS['"]\)/,
    );
  });

  it("races the insert against the deadline and responds 504 on timeout", () => {
    assert.match(FN_SOURCE, /withTimeout\(\s*adminClient/);
    assert.match(FN_SOURCE, /insert timeout[\s\S]*?504/);
    assert.match(FN_SOURCE, /timeoutMs: insertTimeoutMs/);
  });

  it("the knob is a server-side secret, not an EXPO_PUBLIC_ client var", () => {
    assert.doesNotMatch(FN_SOURCE, /EXPO_PUBLIC_POSTHOG_WEBHOOK_TIMEOUT_MS/);
  });
});
