import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PREMIUM_STATE,
  PREMIUM_PERIOD_DAYS,
  PremiumState,
  activatePremiumState,
  cancelPremiumState,
  isPremiumActive,
  isPremiumExpired,
  mergePremiumState,
  parsePremiumState,
  premiumExpiresAt,
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
      isPremiumActive({
        isPremium: true,
        activatedAt: "2026-04-25T00:00:00.000Z",
        premiumActivatedAt: "2026-04-25T00:00:00.000Z",
      }),
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
    const raw = JSON.stringify({
      isPremium: true,
      activatedAt: "2026-04-25T00:00:00.000Z",
      premiumActivatedAt: "2026-04-25T00:00:00.000Z",
    });
    assert.deepEqual(parsePremiumState(raw), {
      isPremium: true,
      activatedAt: "2026-04-25T00:00:00.000Z",
      premiumActivatedAt: "2026-04-25T00:00:00.000Z",
    });
  });

  it("coerces missing activatedAt to null", () => {
    const raw = JSON.stringify({ isPremium: true });
    assert.deepEqual(parsePremiumState(raw), {
      isPremium: true,
      activatedAt: null,
      premiumActivatedAt: null,
    });
  });

  it("coerces non-true isPremium to false", () => {
    const raw = JSON.stringify({ isPremium: "yes", activatedAt: "x" });
    assert.deepEqual(parsePremiumState(raw), {
      isPremium: false,
      activatedAt: "x",
      premiumActivatedAt: "x",
    });
  });

  it("backfills premiumActivatedAt from legacy activatedAt for older payloads", () => {
    const raw = JSON.stringify({ isPremium: true, activatedAt: "2026-04-01T00:00:00.000Z" });
    assert.deepEqual(parsePremiumState(raw), {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    });
  });

  it("preserves a stored premiumActivatedAt log even when activatedAt is null", () => {
    const raw = JSON.stringify({
      isPremium: false,
      activatedAt: null,
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    });
    assert.deepEqual(parsePremiumState(raw), {
      isPremium: false,
      activatedAt: null,
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    });
  });
});

describe("activatePremiumState", () => {
  it("flips isPremium to true and stamps both activatedAt and premiumActivatedAt", () => {
    const next = activatePremiumState(DEFAULT_PREMIUM_STATE, () => "2026-04-25T12:00:00.000Z");
    assert.equal(next.isPremium, true);
    assert.equal(next.activatedAt, "2026-04-25T12:00:00.000Z");
    assert.equal(next.premiumActivatedAt, "2026-04-25T12:00:00.000Z");
  });

  it("returns the same reference when already premium", () => {
    const state: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    const next = activatePremiumState(state, () => "2026-04-25T12:00:00.000Z");
    assert.equal(next, state);
  });

  it("overwrites a stale premiumActivatedAt log on re-activation", () => {
    const state: PremiumState = {
      isPremium: false,
      activatedAt: null,
      premiumActivatedAt: "2026-03-01T00:00:00.000Z",
    };
    const next = activatePremiumState(state, () => "2026-04-25T12:00:00.000Z");
    assert.equal(next.isPremium, true);
    assert.equal(next.premiumActivatedAt, "2026-04-25T12:00:00.000Z");
  });
});

describe("cancelPremiumState", () => {
  it("clears isPremium and activatedAt but preserves premiumActivatedAt log", () => {
    const state: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    assert.deepEqual(cancelPremiumState(state), {
      isPremium: false,
      activatedAt: null,
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    });
  });

  it("falls back to activatedAt when premiumActivatedAt is missing", () => {
    const state: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: null,
    };
    assert.deepEqual(cancelPremiumState(state), {
      isPremium: false,
      activatedAt: null,
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    });
  });

  it("returns the same reference when already free", () => {
    const next = cancelPremiumState(DEFAULT_PREMIUM_STATE);
    assert.equal(next, DEFAULT_PREMIUM_STATE);
  });
});

describe("premiumExpiresAt", () => {
  it("returns null when state is null/undefined or not premium", () => {
    assert.equal(premiumExpiresAt(null), null);
    assert.equal(premiumExpiresAt(undefined), null);
    assert.equal(premiumExpiresAt(DEFAULT_PREMIUM_STATE), null);
  });

  it("returns null when premium but no activation timestamp is recorded", () => {
    const state: PremiumState = {
      isPremium: true,
      activatedAt: null,
      premiumActivatedAt: null,
    };
    assert.equal(premiumExpiresAt(state), null);
  });

  it("returns activatedAt + default 30 days when premium and stamped", () => {
    const state: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    assert.equal(premiumExpiresAt(state), "2026-05-01T00:00:00.000Z");
  });

  it("honours an overridden period", () => {
    const state: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    assert.equal(premiumExpiresAt(state, 7), "2026-04-08T00:00:00.000Z");
  });

  it("falls back to premiumActivatedAt log when activatedAt is null", () => {
    const state: PremiumState = {
      isPremium: true,
      activatedAt: null,
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    assert.equal(premiumExpiresAt(state), "2026-05-01T00:00:00.000Z");
  });

  it("returns null for an invalid timestamp", () => {
    const state: PremiumState = {
      isPremium: true,
      activatedAt: "not-a-date",
      premiumActivatedAt: null,
    };
    assert.equal(premiumExpiresAt(state), null);
  });

  it("uses a 30-day default period", () => {
    assert.equal(PREMIUM_PERIOD_DAYS, 30);
  });
});

describe("isPremiumExpired", () => {
  const state: PremiumState = {
    isPremium: true,
    activatedAt: "2026-04-01T00:00:00.000Z",
    premiumActivatedAt: "2026-04-01T00:00:00.000Z",
  };

  it("returns false for non-premium / unstamped states", () => {
    assert.equal(isPremiumExpired(null), false);
    assert.equal(isPremiumExpired(DEFAULT_PREMIUM_STATE), false);
    assert.equal(
      isPremiumExpired({ isPremium: true, activatedAt: null, premiumActivatedAt: null }),
      false,
    );
  });

  it("returns false the day before expiry", () => {
    const now = Date.parse("2026-04-30T00:00:00.000Z");
    assert.equal(isPremiumExpired(state, now), false);
  });

  it("returns true exactly at the boundary", () => {
    const now = Date.parse("2026-05-01T00:00:00.000Z");
    assert.equal(isPremiumExpired(state, now), true);
  });

  it("returns true after expiry", () => {
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    assert.equal(isPremiumExpired(state, now), true);
  });

  it("respects an overridden period (7-day trial)", () => {
    const now = Date.parse("2026-04-09T00:00:00.000Z");
    assert.equal(isPremiumExpired(state, now, 7), true);
    assert.equal(isPremiumExpired(state, Date.parse("2026-04-07T00:00:00.000Z"), 7), false);
  });
});

describe("mergePremiumState", () => {
  it("returns cached when remote is null", () => {
    const cached: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    assert.equal(mergePremiumState(cached, null), cached);
  });

  it("returns cached when remote does not change isPremium and brings no new log", () => {
    const cached: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    assert.equal(mergePremiumState(cached, { isPremium: true }), cached);
  });

  it("adopts remote premiumActivatedAt log when status matches but log is newer", () => {
    const cached: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    const merged = mergePremiumState(cached, {
      isPremium: true,
      premiumActivatedAt: "2026-04-25T12:00:00.000Z",
    });
    assert.equal(merged.premiumActivatedAt, "2026-04-25T12:00:00.000Z");
    assert.equal(merged.activatedAt, "2026-04-01T00:00:00.000Z");
  });

  it("upgrades cached free state when remote says premium", () => {
    const merged = mergePremiumState(DEFAULT_PREMIUM_STATE, {
      isPremium: true,
      activatedAt: "2026-04-25T12:00:00.000Z",
    });
    assert.equal(merged.isPremium, true);
    assert.equal(merged.activatedAt, "2026-04-25T12:00:00.000Z");
    assert.equal(merged.premiumActivatedAt, "2026-04-25T12:00:00.000Z");
  });

  it("downgrades cached premium when remote says free, keeps the activation log", () => {
    const cached: PremiumState = {
      isPremium: true,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    const merged = mergePremiumState(cached, { isPremium: false });
    assert.deepEqual(merged, {
      isPremium: false,
      activatedAt: null,
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    });
  });

  it("preserves cached activatedAt when remote upgrades without timestamp", () => {
    const cached: PremiumState = {
      isPremium: false,
      activatedAt: "2026-04-01T00:00:00.000Z",
      premiumActivatedAt: "2026-04-01T00:00:00.000Z",
    };
    const merged = mergePremiumState(cached, { isPremium: true });
    assert.equal(merged.isPremium, true);
    assert.equal(merged.activatedAt, "2026-04-01T00:00:00.000Z");
    assert.equal(merged.premiumActivatedAt, "2026-04-01T00:00:00.000Z");
  });
});
