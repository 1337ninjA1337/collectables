import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scrubPII, makeBeforeSend, type SentryEvent } from "../lib/sentry";

describe("Crash #12 — scrubPII (production)", () => {
  it("strips email from user", () => {
    const event: SentryEvent = {
      user: { id: "u1", email: "leaked@example.com" },
    };
    const out = scrubPII(event, "production");
    assert.equal(out.user?.id, "u1");
    assert.equal(out.user?.email, undefined);
  });

  it("strips ip_address from user", () => {
    const event: SentryEvent = {
      user: { id: "u1", ip_address: "1.2.3.4" },
    };
    const out = scrubPII(event, "production");
    assert.equal(out.user?.ip_address, undefined);
  });

  it("preserves user.id (we explicitly keep it for crash debugging)", () => {
    const event: SentryEvent = {
      user: { id: "u-keep", email: "x@y.z" },
    };
    const out = scrubPII(event, "production");
    assert.equal(out.user?.id, "u-keep");
  });

  it("removes request.cookies", () => {
    const event: SentryEvent = {
      request: { cookies: "session=abc123; csrf=xyz" },
    };
    const out = scrubPII(event, "production");
    assert.equal(out.request?.cookies, undefined);
  });

  it("removes Cookie / Authorization headers (case-insensitive)", () => {
    const event: SentryEvent = {
      request: {
        headers: {
          Cookie: "session=abc",
          cookie: "csrf=xyz",
          Authorization: "Bearer x",
          authorization: "Bearer y",
          Accept: "application/json",
        },
      },
    };
    const out = scrubPII(event, "production");
    assert.equal(out.request?.headers?.Cookie, undefined);
    assert.equal(out.request?.headers?.cookie, undefined);
    assert.equal(out.request?.headers?.Authorization, undefined);
    assert.equal(out.request?.headers?.authorization, undefined);
    assert.equal(out.request?.headers?.Accept, "application/json");
  });

  it("returns a new event object (does not mutate input)", () => {
    const event: SentryEvent = {
      user: { id: "u1", email: "x@y.z" },
    };
    const out = scrubPII(event, "production");
    assert.notEqual(out, event);
    assert.notEqual(out.user, event.user);
    // original still has the email
    assert.equal(event.user?.email, "x@y.z");
  });

  it("staging environment also scrubs (only dev passes through)", () => {
    const event: SentryEvent = {
      user: { id: "u1", email: "x@y.z" },
    };
    assert.equal(scrubPII(event, "staging").user?.email, undefined);
  });
});

describe("Crash #12 — scrubPII (development passthrough)", () => {
  it("returns the event unchanged in development", () => {
    const event: SentryEvent = {
      user: { id: "u1", email: "x@y.z" },
      request: { cookies: "k=v" },
    };
    const out = scrubPII(event, "development");
    assert.equal(out, event);
    assert.equal(out.user?.email, "x@y.z");
  });
});

describe("Crash #12 — makeBeforeSend", () => {
  it("returns a function that scrubs based on the environment", () => {
    const beforeSend = makeBeforeSend("production");
    const out = beforeSend({ user: { id: "u1", email: "x@y.z" } });
    assert.equal(out.user?.email, undefined);
  });

  it("dev passthrough keeps PII for debugging", () => {
    const beforeSend = makeBeforeSend("development");
    const event: SentryEvent = { user: { id: "u1", email: "x@y.z" } };
    assert.equal(beforeSend(event).user?.email, "x@y.z");
  });
});
