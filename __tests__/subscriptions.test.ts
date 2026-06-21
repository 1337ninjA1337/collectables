import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SubscriptionRow,
  isSubscriptionActive,
  parseValidation,
  rowToPremiumState,
  rowToValidation,
  validatePremiumPayload,
  validatePremiumUrl,
  validationToPremiumState,
} from "../lib/subscriptions";

/**
 * BE-22a — pure `lib/subscriptions.ts` shape helpers for the
 * server-authoritative `subscriptions` table + `validate-premium` function.
 */

const NOW = Date.parse("2026-06-21T00:00:00.000Z");
const FUTURE = "2026-07-21T00:00:00.000Z";
const PAST = "2026-05-21T00:00:00.000Z";

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    user_id: "u1",
    status: "active",
    activated_at: "2026-06-01T00:00:00.000Z",
    current_period_end: FUTURE,
    ...overrides,
  };
}

describe("isSubscriptionActive (BE-22a)", () => {
  it("is true for an active row whose period has not lapsed", () => {
    assert.equal(isSubscriptionActive(row(), NOW), true);
  });

  it("is true for an active row with a NULL period (no known expiry)", () => {
    assert.equal(isSubscriptionActive(row({ current_period_end: null }), NOW), true);
  });

  it("is false for an active row whose period has lapsed", () => {
    assert.equal(isSubscriptionActive(row({ current_period_end: PAST }), NOW), false);
  });

  it("is false for a non-active status regardless of period", () => {
    for (const status of ["inactive", "expired", "cancelled"] as const) {
      assert.equal(isSubscriptionActive(row({ status }), NOW), false);
    }
  });

  it("is false for a tombstoned row even when active+unexpired", () => {
    assert.equal(isSubscriptionActive(row({ deleted_at: PAST }), NOW), false);
  });

  it("is false for null/undefined and unparseable period falls back to active", () => {
    assert.equal(isSubscriptionActive(null, NOW), false);
    assert.equal(isSubscriptionActive(undefined, NOW), false);
    assert.equal(isSubscriptionActive(row({ current_period_end: "not-a-date" }), NOW), true);
  });
});

describe("rowToPremiumState (BE-22a)", () => {
  it("maps an active row to a premium state preserving activation log", () => {
    const state = rowToPremiumState(row(), NOW);
    assert.deepEqual(state, {
      isPremium: true,
      activatedAt: "2026-06-01T00:00:00.000Z",
      premiumActivatedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("collapses a lapsed row to inactive but keeps the historical log", () => {
    const state = rowToPremiumState(row({ current_period_end: PAST }), NOW);
    assert.equal(state.isPremium, false);
    assert.equal(state.activatedAt, null);
    assert.equal(state.premiumActivatedAt, "2026-06-01T00:00:00.000Z");
  });

  it("maps null/empty to the default inactive state", () => {
    assert.deepEqual(rowToPremiumState(null, NOW), {
      isPremium: false,
      activatedAt: null,
      premiumActivatedAt: null,
    });
  });
});

describe("rowToValidation (BE-22a)", () => {
  it("returns the active entitlement with activation + expiry", () => {
    assert.deepEqual(rowToValidation(row(), NOW), {
      isPremium: true,
      activatedAt: "2026-06-01T00:00:00.000Z",
      expiresAt: FUTURE,
    });
  });

  it("strips activation/expiry when inactive", () => {
    assert.deepEqual(rowToValidation(row({ status: "cancelled" }), NOW), {
      isPremium: false,
      activatedAt: null,
      expiresAt: null,
    });
  });
});

describe("parseValidation (BE-22a)", () => {
  it("coerces a well-formed body", () => {
    assert.deepEqual(
      parseValidation({ isPremium: true, activatedAt: PAST, expiresAt: FUTURE }),
      { isPremium: true, activatedAt: PAST, expiresAt: FUTURE },
    );
  });

  it("defaults to inactive for junk / wrong types", () => {
    for (const junk of [null, undefined, 42, "x", { isPremium: "yes" }, {}]) {
      assert.deepEqual(parseValidation(junk), {
        isPremium: false,
        activatedAt: null,
        expiresAt: null,
      });
    }
  });

  it("drops empty-string timestamps to null", () => {
    assert.deepEqual(parseValidation({ isPremium: true, activatedAt: "", expiresAt: "" }), {
      isPremium: true,
      activatedAt: null,
      expiresAt: null,
    });
  });
});

describe("validationToPremiumState (BE-22a)", () => {
  it("maps active → premium, inactive → not premium (keeping the log)", () => {
    assert.deepEqual(
      validationToPremiumState({ isPremium: true, activatedAt: PAST, expiresAt: FUTURE }),
      { isPremium: true, activatedAt: PAST, premiumActivatedAt: PAST },
    );
    assert.deepEqual(
      validationToPremiumState({ isPremium: false, activatedAt: PAST, expiresAt: null }),
      { isPremium: false, activatedAt: null, premiumActivatedAt: PAST },
    );
  });
});

describe("validate-premium shape builders (BE-22a)", () => {
  it("builds the function URL", () => {
    assert.equal(
      validatePremiumUrl("https://abc.supabase.co"),
      "https://abc.supabase.co/functions/v1/validate-premium",
    );
  });

  it("defaults the action to validate and accepts activate", () => {
    assert.deepEqual(validatePremiumPayload(), { action: "validate" });
    assert.deepEqual(validatePremiumPayload("activate"), { action: "activate" });
  });
});
