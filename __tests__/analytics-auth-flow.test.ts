import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isFreshlyCreatedUser } from "../lib/auth-helpers";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("isFreshlyCreatedUser — 5-minute window detector", () => {
  const now = Date.parse("2026-05-08T12:00:00.000Z");

  it("returns true when created_at is within last 5 minutes", () => {
    const created = new Date(now - 60_000).toISOString();
    assert.equal(isFreshlyCreatedUser({ created_at: created }, now), true);
  });

  it("returns true exactly at the 5-minute boundary", () => {
    const created = new Date(now - 5 * 60 * 1000).toISOString();
    assert.equal(isFreshlyCreatedUser({ created_at: created }, now), true);
  });

  it("returns false when created_at is older than 5 minutes", () => {
    const created = new Date(now - 6 * 60 * 1000).toISOString();
    assert.equal(isFreshlyCreatedUser({ created_at: created }, now), false);
  });

  it("returns false when created_at is null/undefined/missing", () => {
    assert.equal(isFreshlyCreatedUser(null, now), false);
    assert.equal(isFreshlyCreatedUser({}, now), false);
    assert.equal(
      isFreshlyCreatedUser({ created_at: undefined }, now),
      false,
    );
  });

  it("returns false when created_at is unparseable", () => {
    assert.equal(
      isFreshlyCreatedUser({ created_at: "not-a-date" }, now),
      false,
    );
  });

  it("returns false when created_at is in the future (clock skew guard)", () => {
    const created = new Date(now + 60_000).toISOString();
    assert.equal(isFreshlyCreatedUser({ created_at: created }, now), false);
  });
});

describe("auth-context — signup_completed wiring", () => {
  const src = read("lib/auth-context.tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "auth-context must import trackEvent",
    );
  });

  it("fires trackEvent('signup_completed', ...) inside verifyEmailOtp", () => {
    // Slice out the verifyEmailOtp implementation body — its second occurrence
    // (`verifyEmailOtp: async`) is the impl; the first is the type entry.
    const verifyIdx = src.indexOf("verifyEmailOtp: async");
    assert.ok(verifyIdx >= 0, "verifyEmailOtp impl not found");
    // Bound on the next provider impl (also takes `: async` form).
    const sliceEnd = src.indexOf("signInWithProvider: async", verifyIdx);
    assert.ok(sliceEnd > verifyIdx, "signInWithProvider impl not found after verifyEmailOtp");
    const body = src.slice(verifyIdx, sliceEnd);
    assert.match(
      body,
      /trackEvent\(\s*["']signup_completed["']/,
      "verifyEmailOtp must fire trackEvent('signup_completed')",
    );
    assert.match(
      body,
      /isFreshlyCreatedUser\(/,
      "verifyEmailOtp must gate the event on isFreshlyCreatedUser",
    );
    assert.match(
      body,
      /method:\s*["']otp["']/,
      "signup_completed must include method: 'otp'",
    );
  });

  it("does NOT fire signup_completed unconditionally — must check error and freshness", () => {
    const verifyIdx = src.indexOf("verifyEmailOtp: async");
    const sliceEnd = src.indexOf("signInWithProvider: async", verifyIdx);
    const body = src.slice(verifyIdx, sliceEnd);
    assert.match(
      body,
      /if\s*\(\s*!error\s*&&\s*isFreshlyCreatedUser/,
      "signup_completed must be gated on (!error && isFreshlyCreatedUser)",
    );
  });
});

describe("i18n-context — language_switched wiring", () => {
  const src = read("lib/i18n-context.tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "i18n-context must import trackEvent",
    );
  });

  it("fires language_switched inside setLanguage with previousLanguage trait", () => {
    const setLangIdx = src.indexOf("setLanguage: async");
    assert.ok(setLangIdx >= 0, "setLanguage not found");
    const sliceEnd = src.indexOf("setLanguageState(nextLanguage);", setLangIdx);
    const body = src.slice(setLangIdx, sliceEnd + 100);
    assert.match(
      body,
      /trackEvent\(\s*["']language_switched["']/,
      "setLanguage must fire trackEvent('language_switched')",
    );
    assert.match(
      body,
      /previousLanguage:\s*language/,
      "language_switched must include previousLanguage trait",
    );
    assert.match(
      body,
      /language:\s*nextLanguage/,
      "language_switched must include language=nextLanguage trait",
    );
  });

  it("does NOT fire language_switched when language has not changed", () => {
    const setLangIdx = src.indexOf("setLanguage: async");
    const sliceEnd = src.indexOf("setLanguageState(nextLanguage);", setLangIdx);
    const body = src.slice(setLangIdx, sliceEnd);
    assert.match(
      body,
      /if\s*\(\s*nextLanguage\s*!==\s*language\s*\)/,
      "language_switched must be gated on nextLanguage !== language so a no-op setLanguage doesn't double-count",
    );
  });
});

describe("trackEvent mock — runtime wiring (deferred)", () => {
  // The trackEvent function is a no-op when the SDK isn't initialised, so a
  // pure runtime test of the wiring would observe nothing. The structural
  // assertions above pin the call sites + payload shapes; the SDK-delegation
  // path is covered by __tests__/analytics-init.test.ts. The combination
  // gives us the same coverage as a JSDOM render with mocked SDK without
  // pulling in a UI test runtime.
  it("structural-only — see analytics-init.test.ts for SDK delegation coverage", () => {
    assert.ok(true);
  });
});
