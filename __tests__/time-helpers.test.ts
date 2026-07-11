import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { isFreshlyCreatedUser } from "../lib/auth-helpers";
import { isWithinDuration } from "../lib/time-helpers";

const now = Date.parse("2026-05-08T12:00:00.000Z");
const MINUTE = 60_000;

describe("isWithinDuration — generic recency predicate", () => {
  it("returns true when the timestamp is inside the window", () => {
    const iso = new Date(now - MINUTE).toISOString();
    assert.equal(isWithinDuration(iso, 5 * MINUTE, now), true);
  });

  it("is inclusive at both boundaries", () => {
    assert.equal(
      isWithinDuration(new Date(now - 5 * MINUTE).toISOString(), 5 * MINUTE, now),
      true,
      "exactly window-old must count",
    );
    assert.equal(
      isWithinDuration(new Date(now).toISOString(), 5 * MINUTE, now),
      true,
      "exactly now must count",
    );
  });

  it("returns false when the timestamp is older than the window", () => {
    const iso = new Date(now - 6 * MINUTE).toISOString();
    assert.equal(isWithinDuration(iso, 5 * MINUTE, now), false);
  });

  it("returns false for missing values", () => {
    assert.equal(isWithinDuration(null, 5 * MINUTE, now), false);
    assert.equal(isWithinDuration(undefined, 5 * MINUTE, now), false);
    assert.equal(isWithinDuration("", 5 * MINUTE, now), false);
  });

  it("returns false for unparseable timestamps", () => {
    assert.equal(isWithinDuration("not-a-date", 5 * MINUTE, now), false);
  });

  it("returns false for future timestamps (clock-skew guard)", () => {
    const iso = new Date(now + MINUTE).toISOString();
    assert.equal(isWithinDuration(iso, 5 * MINUTE, now), false);
  });

  it("a zero-duration window accepts only the exact instant", () => {
    assert.equal(isWithinDuration(new Date(now).toISOString(), 0, now), true);
    assert.equal(
      isWithinDuration(new Date(now - 1).toISOString(), 0, now),
      false,
    );
  });
});

describe("isFreshlyCreatedUser — delegates to isWithinDuration", () => {
  it("source delegates instead of re-rolling Date.parse arithmetic", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib/auth-helpers.ts"),
      "utf8",
    );
    assert.match(
      src,
      /return isWithinDuration\(user\?\.created_at, windowMs, now\)/,
      "isFreshlyCreatedUser must delegate to the shared predicate",
    );
    assert.doesNotMatch(
      src,
      /Date\.parse/,
      "auth-helpers must not re-roll timestamp parsing",
    );
  });

  it("behaviour parity: the delegation preserves the original matrix", () => {
    const fresh = new Date(now - MINUTE).toISOString();
    const stale = new Date(now - 6 * MINUTE).toISOString();
    assert.equal(isFreshlyCreatedUser({ created_at: fresh }, now), true);
    assert.equal(isFreshlyCreatedUser({ created_at: stale }, now), false);
    assert.equal(isFreshlyCreatedUser(null, now), false);
    assert.equal(isFreshlyCreatedUser({ created_at: "not-a-date" }, now), false);
    assert.equal(
      isFreshlyCreatedUser({ created_at: new Date(now + MINUTE).toISOString() }, now),
      false,
    );
  });
});
