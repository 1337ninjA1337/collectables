import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PREMIUM_STATE,
  PremiumState,
  activatePremiumState,
  cancelPremiumState,
  isPremiumActive,
  mergePremiumState,
  parsePremiumState,
  premiumStorageKey,
} from "@/lib/premium-helpers";

describe("premiumStorageKey", () => {
  it("returns null for empty user id", () => {
    assert.equal(premiumStorageKey(null), null);
    assert.equal(premiumStorageKey(undefined), null);
    assert.equal(premiumStorageKey(""), null);
  });

  it("returns a per-user key when user id is provided", () => {
    assert.equal(premiumStorageKey("user-123"), "collectables-premium-v1-user-123");
  });
});

describe("isPremiumActive", () => {
  it("returns false for null/undefined/default state", () => {
    assert.equal(isPremiumActive(null), false);
    assert.equal(isPremiumActive(undefined), false);
    assert.equal(isPremiumActive(DEFAULT_PREMIUM_STATE), false);
  });

  it("returns true when isPremium is true", () => {
    assert.equal(
      isPremiumActive({ isPremium: true, activatedAt: "2026-04-25T00:00:00.000Z" }),
      true,
    );
  });
});

describe("parsePremiumState", () => {
  it("returns default state for null/empty input", () => {
    assert.deepEqual(parsePremiumState(null), DEFAULT_PREMIUM_STATE);
    assert.deepEqual(parsePremiumState(""), DEFAULT_PREMIUM_STATE);
  });

  it("returns default state for malformed JSON", () => {
    assert.deepEqual(parsePremiumState("{not json"), DEFAULT_PREMIUM_STATE);
  });

  it("parses a valid premium state payload", () => {
    const raw = JSON.stringify({ isPremium: true, activatedAt: "2026-04-25T00:00:00.000Z" });
    assert.deepEqual(parsePremiumState(raw), {
      isPremium: true,
      activatedAt: "2026-04-25T00:00:00.000Z",
    });
  });

  it("coerces missing activatedAt to null", () => {
    const raw = JSON.stringify({ isPremium: true });
    assert.deepEqual(parsePremiumState(raw), {
      isPremium: true,
      activatedAt: null,
    });
  });

  it("coerces non-true isPremium to false", () => {
    const raw = JSON.stringify({ isPremium: "yes", activatedAt: "x" });
    assert.deepEqual(parsePremiumState(raw), {
      isPremium: false,
      activatedAt: "x",
    });
  });
});

describe("activatePremiumState", () => {
  it("flips isPremium to true and stamps activatedAt", () => {
    const next = activatePremiumState(DEFAULT_PREMIUM_STATE, () => "2026-04-25T12:00:00.000Z");
    assert.equal(next.isPremium, true);
    assert.equal(next.activatedAt, "2026-04-25T12:00:00.000Z");
  });

  it("returns the same reference when already premium", () => {
    const state: PremiumState = { isPremium: true, activatedAt: "2026-04-01T00:00:00.000Z" };
    const next = activatePremiumState(state, () => "2026-04-25T12:00:00.000Z");
    assert.equal(next, state);
  });
});

describe("cancelPremiumState", () => {
  it("clears isPremium and activatedAt", () => {
    const state: PremiumState = { isPremium: true, activatedAt: "2026-04-01T00:00:00.000Z" };
    assert.deepEqual(cancelPremiumState(state), DEFAULT_PREMIUM_STATE);
  });

  it("returns the same reference when already free", () => {
    const next = cancelPremiumState(DEFAULT_PREMIUM_STATE);
    assert.equal(next, DEFAULT_PREMIUM_STATE);
  });
});

describe("mergePremiumState", () => {
  it("returns cached when remote is null", () => {
    const cached: PremiumState = { isPremium: true, activatedAt: "2026-04-01T00:00:00.000Z" };
    assert.equal(mergePremiumState(cached, null), cached);
  });

  it("returns cached when remote does not change isPremium", () => {
    const cached: PremiumState = { isPremium: true, activatedAt: "2026-04-01T00:00:00.000Z" };
    assert.equal(mergePremiumState(cached, { isPremium: true }), cached);
  });

  it("upgrades cached free state when remote says premium", () => {
    const merged = mergePremiumState(DEFAULT_PREMIUM_STATE, {
      isPremium: true,
      activatedAt: "2026-04-25T12:00:00.000Z",
    });
    assert.equal(merged.isPremium, true);
    assert.equal(merged.activatedAt, "2026-04-25T12:00:00.000Z");
  });

  it("downgrades cached premium when remote says free", () => {
    const cached: PremiumState = { isPremium: true, activatedAt: "2026-04-01T00:00:00.000Z" };
    const merged = mergePremiumState(cached, { isPremium: false });
    assert.deepEqual(merged, DEFAULT_PREMIUM_STATE);
  });

  it("preserves cached activatedAt when remote upgrades without timestamp", () => {
    const cached: PremiumState = { isPremium: false, activatedAt: "2026-04-01T00:00:00.000Z" };
    const merged = mergePremiumState(cached, { isPremium: true });
    assert.equal(merged.isPremium, true);
    assert.equal(merged.activatedAt, "2026-04-01T00:00:00.000Z");
  });
});
