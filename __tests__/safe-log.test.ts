import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  REDACTED,
  SECRET_LOG_TOKENS,
  isSensitiveLogKey,
  redactForLog,
  createDevLogger,
  devLog,
} from "../lib/safe-log";
import { captureConsole } from "./helpers/capture-console";
import { readRepoFile as read } from "./helpers/repo-file";

describe("safe-log: isSensitiveLogKey", () => {
  it("flags credential-shaped keys", () => {
    for (const key of [
      "authorization",
      "accessToken",
      "refresh_token",
      "apiKey",
      "password",
      "service_role_key",
      "cookie",
      "sessionId",
      "jwt",
      "otpCode",
      "bearerToken",
    ]) {
      assert.equal(isSensitiveLogKey(key), true, `${key} should be sensitive`);
    }
  });

  it("flags PII-shaped keys (reusing the SEC-13 taxonomy)", () => {
    for (const key of ["itemName", "userEmail", "note", "description", "phone"]) {
      assert.equal(isSensitiveLogKey(key), true, `${key} should be sensitive`);
    }
  });

  it("passes id / enum / boolean keys", () => {
    for (const key of ["id", "collectionId", "mode", "hasPhoto", "status", "sortOrder"]) {
      assert.equal(isSensitiveLogKey(key), false, `${key} should pass`);
    }
  });

  it("exposes a frozen secret-token list", () => {
    assert.ok(Object.isFrozen(SECRET_LOG_TOKENS));
    assert.ok(SECRET_LOG_TOKENS.includes("authorization"));
  });
});

describe("safe-log: redactForLog", () => {
  it("redacts sensitive object values, keeps safe ones", () => {
    const out = redactForLog({
      id: "abc-123",
      name: "Rare 1955 stamp",
      note: "bought from grandma",
      collection_id: "col-9",
      access_token: "ey.secret.value",
    }) as Record<string, unknown>;
    assert.equal(out.id, "abc-123");
    assert.equal(out.collection_id, "col-9");
    assert.equal(out.name, REDACTED);
    assert.equal(out.note, REDACTED);
    assert.equal(out.access_token, REDACTED);
  });

  it("walks nested objects and arrays", () => {
    const out = redactForLog({
      items: [{ id: "1", title: "secret title" }],
      auth: { authorization: "Bearer xyz" },
    }) as { items: Array<Record<string, unknown>>; auth: unknown };
    assert.equal(out.items[0].id, "1");
    assert.equal(out.items[0].title, REDACTED);
    // `auth` key itself is sensitive -> whole subtree redacted
    assert.equal(out.auth, REDACTED);
  });

  it("passes primitives through unchanged", () => {
    assert.equal(redactForLog("plain"), "plain");
    assert.equal(redactForLog(42), 42);
    assert.equal(redactForLog(null), null);
  });

  it("leaves Error objects untouched (diagnostic, not a payload)", () => {
    const err = new Error("boom");
    assert.equal(redactForLog(err), err);
  });

  it("survives cyclic payloads via the depth cap", () => {
    const a: Record<string, unknown> = { id: "x" };
    a.self = a;
    assert.doesNotThrow(() => redactForLog(a));
  });
});

describe("safe-log: createDevLogger", () => {
  it("no-ops when not a dev build", () => {
    const calls: unknown[][] = [];
    const logger = createDevLogger(false, { log: (...args) => calls.push(args) });
    logger.debug("hello", { token: "x" });
    assert.equal(calls.length, 0);
  });

  it("forwards and redacts object args when dev", () => {
    const calls: unknown[][] = [];
    const logger = createDevLogger(true, { log: (...args) => calls.push(args) });
    logger.debug("[tag]", { id: "9", name: "secret" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "[tag]");
    assert.deepEqual(calls[0][1], { id: "9", name: REDACTED });
  });

  it("forwards to the real console when no sink is passed", () => {
    // The overload `devLog` is built from, and the one every case above stepped
    // around by handing in a capturing object. A default that named a method
    // the console does not have would be a crash on the first debug line of a
    // dev build, and this suite would have been green the whole way.
    const written = captureConsole(() => {
      createDevLogger(true).debug("[tag]", { id: "9", name: "secret" });
    });
    assert.equal(written.log.length, 1);
    assert.ok(written.log[0].includes("[tag]"));
    // Redaction is not suspended by the default sink — the console is where a
    // leak would actually be read.
    assert.ok(!written.log[0].includes("secret"));
    assert.deepEqual(written.error, []);
  });

  it("module-level devLog is a no-op under the node test runner (__DEV__ unset)", () => {
    // "Produces no console output" was the claim in this case's comment and
    // `doesNotThrow` was the assertion, which is a different claim: the no-op
    // logger and a logger that printed the argument in the clear both satisfy
    // it. The sentence is now the assertion.
    const written = captureConsole(() => {
      assert.doesNotThrow(() => {
        devLog.debug("nothing prints", { secret: "x" });
      });
    });
    assert.deepEqual(written.log, []);
    assert.deepEqual(written.error, []);
  });
});

describe("SEC-20: structural logging-hygiene guards", () => {
  it("the item-write path no longer console.log's a request body", () => {
    const src = read("lib/supabase-profiles.ts");
    assert.ok(
      !/console\.log\(/.test(src),
      "lib/supabase-profiles.ts must not console.log (use devLog.debug)",
    );
    // The body debug log must be routed through the dev-gated logger.
    assert.ok(
      /devLog\.debug\(/.test(src) && /import \{ devLog \} from "@\/lib\/safe-log"/.test(src),
      "expected devLog.debug wired from @/lib/safe-log",
    );
  });

  it("runtime-config + OAuth-callback paths never log credentials", () => {
    for (const rel of ["lib/supabase.ts", "lib/runtime-config-gate.ts", "app/auth/callback.tsx"]) {
      const src = read(rel);
      assert.ok(
        !/console\.(log|debug|info|warn|error)\s*\([^)]*(token|access_token|refresh_token|apikey|api_key|password|secret|authorization)/i.test(
          src,
        ),
        `${rel} must not log a credential-bearing value`,
      );
    }
  });
});
