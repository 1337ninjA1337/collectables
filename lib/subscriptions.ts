import { PremiumState } from "@/lib/premium-helpers";

/**
 * BE-22a — pure request/response shapes for the server-authoritative
 * `subscriptions` table + the `validate-premium` Edge Function.
 *
 * No react-native / Supabase imports — every helper here is unit-testable in
 * node. The BE-22b Edge Function + client wrapper and the BE-22c premium-context
 * wiring consume these so the entitlement contract lives in one place.
 *
 * The DB row (`20260625_subscriptions.sql`) is the source of truth:
 *   - `status` is one of 'active' | 'inactive' | 'expired' | 'cancelled'
 *   - `current_period_end` (when present) is the LWW-by-time expiry; a row that
 *     is `status='active'` but whose period has lapsed is treated as inactive
 *     (the server expires it lazily in BE-22b, but the client is defensive too).
 */

export type SubscriptionStatus = "active" | "inactive" | "expired" | "cancelled";

export type SubscriptionRow = {
  user_id: string;
  status: SubscriptionStatus;
  activated_at: string | null;
  current_period_end: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
};

/**
 * The validated entitlement the `validate-premium` Edge Function returns to the
 * client. Deliberately narrower than the row: only what gates paid features.
 */
export type PremiumValidation = {
  isPremium: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
};

function parsableTime(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Server-authoritative "is this subscription currently active?" check.
 * A row counts as active iff it is not tombstoned, its status is 'active', and
 * its period (if any) has not lapsed. A NULL `current_period_end` means "active
 * with no known expiry" (e.g. a perpetual grant) and stays active.
 */
export function isSubscriptionActive(
  row: SubscriptionRow | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!row) return false;
  if (row.deleted_at) return false;
  if (row.status !== "active") return false;
  const end = parsableTime(row.current_period_end);
  if (end === null) return true;
  return end > now;
}

/**
 * Project a `subscriptions` row into the client's `PremiumState`. A lapsed or
 * non-active row collapses to the inactive state, but the historical
 * `premiumActivatedAt` log is preserved (mirroring `cancelPremiumState`) so the
 * UI can still show "premium since…" for a churned user.
 */
export function rowToPremiumState(
  row: SubscriptionRow | null | undefined,
  now: number = Date.now(),
): PremiumState {
  const activationLog =
    typeof row?.activated_at === "string" && row.activated_at.length > 0
      ? row.activated_at
      : null;
  if (isSubscriptionActive(row, now)) {
    return {
      isPremium: true,
      activatedAt: activationLog,
      premiumActivatedAt: activationLog,
    };
  }
  return {
    isPremium: false,
    activatedAt: null,
    premiumActivatedAt: activationLog,
  };
}

/** Project a `subscriptions` row into the narrow validation payload. */
export function rowToValidation(
  row: SubscriptionRow | null | undefined,
  now: number = Date.now(),
): PremiumValidation {
  const active = isSubscriptionActive(row, now);
  return {
    isPremium: active,
    activatedAt:
      active && typeof row?.activated_at === "string" && row.activated_at.length > 0
        ? row.activated_at
        : null,
    expiresAt:
      active && typeof row?.current_period_end === "string" && row.current_period_end.length > 0
        ? row.current_period_end
        : null,
  };
}

/** Coerce an arbitrary validation response body into a safe `PremiumValidation`. */
export function parseValidation(raw: unknown): PremiumValidation {
  if (typeof raw !== "object" || raw === null) {
    return { isPremium: false, activatedAt: null, expiresAt: null };
  }
  const obj = raw as Partial<PremiumValidation>;
  return {
    isPremium: obj.isPremium === true,
    activatedAt:
      typeof obj.activatedAt === "string" && obj.activatedAt.length > 0
        ? obj.activatedAt
        : null,
    expiresAt:
      typeof obj.expiresAt === "string" && obj.expiresAt.length > 0 ? obj.expiresAt : null,
  };
}

/** Map a validated entitlement to the client `PremiumState`. */
export function validationToPremiumState(validation: PremiumValidation): PremiumState {
  if (validation.isPremium) {
    return {
      isPremium: true,
      activatedAt: validation.activatedAt,
      premiumActivatedAt: validation.activatedAt,
    };
  }
  return {
    isPremium: false,
    activatedAt: null,
    premiumActivatedAt: validation.activatedAt,
  };
}

/** BE-22b: the `validate-premium` Edge Function endpoint. */
export function validatePremiumUrl(baseUrl: string): string {
  return `${baseUrl}/functions/v1/validate-premium`;
}

export type ValidatePremiumPayload = {
  /** "validate" (default) reads + lazily-expires; "activate" starts a period. */
  action: "validate" | "activate";
};

export function validatePremiumPayload(
  action: ValidatePremiumPayload["action"] = "validate",
): ValidatePremiumPayload {
  return { action };
}
