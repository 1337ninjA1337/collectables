import { CollectionVisibility } from "@/lib/types";

export type PremiumState = {
  isPremium: boolean;
  activatedAt: string | null;
  premiumActivatedAt: string | null;
};

/**
 * The default visibility a new collection should start at for a given user.
 * Premium users default to "private"; free users default to "public" (private
 * collections are a premium-only feature). Lives next to the other
 * premium-derived defaults so the rule is unit-testable without React.
 */
export function defaultCollectionVisibilityForUser(isPremium: boolean): CollectionVisibility {
  return isPremium ? "private" : "public";
}

/**
 * Is the "private" option locked for this user, on this collection?
 *
 * The rule both visibility rows were writing out for themselves: a free user
 * cannot make a collection private, but an ALREADY-private collection is never
 * locked, so a lapsed subscriber is not forced to publish what they had.
 *
 * `savedVisibility` is what the collection is stored as, and each caller
 * decides what "not stored yet" means for it, because the two screens
 * genuinely disagree and both are right. The create screen has no saved value
 * and passes `"public"`: a collection being created has no private history to
 * protect. The edit sheet passes `savedVisibility ?? "private"`: there the
 * value can be momentarily unknown while the collection loads, and treating
 * unknown as private errs toward NOT locking an owner out of their own sheet.
 */
export function isPrivateVisibilityLocked(
  isPremium: boolean,
  savedVisibility: CollectionVisibility,
): boolean {
  return !isPremium && savedVisibility !== "private";
}

/**
 * What a save is allowed to write, given what the user selected.
 *
 * Defence in depth for the collection edit sheet: the chip already refuses to
 * select "private" when the lock is on, so this can only differ from `selected`
 * if that refusal was bypassed. It is deliberately kept — and deliberately
 * expressed through `isPrivateVisibilityLocked` rather than as a fourth inline
 * spelling of the same three clauses, which is what it was.
 *
 * `savedVisibility` is the stored value, and the argument order matches the
 * lock's: swapping `selected` and `savedVisibility` type-checks (both are
 * `CollectionVisibility`) and silently clamps the wrong direction, so both
 * are asserted.
 */
export function clampVisibilityForSave(
  isPremium: boolean,
  selected: CollectionVisibility,
  savedVisibility: CollectionVisibility,
): CollectionVisibility {
  if (selected === "private" && isPrivateVisibilityLocked(isPremium, savedVisibility)) {
    return "public";
  }
  return selected;
}

/**
 * Which of the two controls fired the upsell.
 *
 * The padlocked chip and the sentence beside it are the same button doing the
 * same job, so they send the same `feature` and `source` — and until this
 * existed, `premium_upsell_shown` could not tell them apart at all. That
 * matters because the standing "hide the locked chip once the dashboard shows
 * nobody taps it" decision is read off this event: with the two controls
 * merged, taps on the SENTENCE would keep the chip alive forever, and hiding
 * the chip would look like it cost traffic it never had.
 */
export type PremiumUpsellControl = "chip" | "hint";

/**
 * Which sentence belongs under a visibility row, given what is selected.
 *
 * Split from the lock because the two answers are independent, and conflating
 * them is what made the premium explanation unreachable: both screens rendered
 * ONE sentence chosen by `!isPremium && visibility === "private"`, and a free
 * user can never get `visibility` to `"private"` — the locked chip returns
 * before setting it. So the branch that explains the padlock was dead in both
 * files, and the only place the sentence appeared was a toast that has already
 * gone by the time somebody looks at the row.
 *
 * The current selection always gets its own sentence now; the lock adds a
 * second line beside it rather than replacing it. Losing "public collections
 * are visible to everyone" in order to say "private is premium" would trade
 * one explanation for another.
 */
export function visibilityHintKey(
  visibility: CollectionVisibility,
): "visibilityPublicHint" | "visibilityPrivateHint" {
  return visibility === "public" ? "visibilityPublicHint" : "visibilityPrivateHint";
}

export const DEFAULT_PREMIUM_STATE: PremiumState = {
  isPremium: false,
  activatedAt: null,
  premiumActivatedAt: null,
};

export function premiumStorageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `collectables-premium-v1-${userId}`;
}

export function isPremiumActive(state: PremiumState | null | undefined): boolean {
  if (!state) return false;
  return state.isPremium === true;
}

export function parsePremiumState(raw: string | null | undefined): PremiumState {
  if (!raw) return DEFAULT_PREMIUM_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<PremiumState>;
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREMIUM_STATE;
    const activatedAt =
      typeof parsed.activatedAt === "string" && parsed.activatedAt.length > 0
        ? parsed.activatedAt
        : null;
    const persistedActivationLog =
      typeof parsed.premiumActivatedAt === "string" && parsed.premiumActivatedAt.length > 0
        ? parsed.premiumActivatedAt
        : null;
    return {
      isPremium: parsed.isPremium === true,
      activatedAt,
      premiumActivatedAt: persistedActivationLog ?? activatedAt,
    };
  } catch {
    return DEFAULT_PREMIUM_STATE;
  }
}

export function activatePremiumState(
  state: PremiumState,
  now: () => string = () => new Date().toISOString(),
): PremiumState {
  if (state.isPremium) return state;
  const stamp = now();
  return { isPremium: true, activatedAt: stamp, premiumActivatedAt: stamp };
}

export function cancelPremiumState(state: PremiumState): PremiumState {
  if (!state.isPremium) return state;
  return {
    isPremium: false,
    activatedAt: null,
    premiumActivatedAt: state.premiumActivatedAt ?? state.activatedAt,
  };
}

export const PREMIUM_PERIOD_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export function premiumExpiresAt(
  state: PremiumState | null | undefined,
  periodDays: number = PREMIUM_PERIOD_DAYS,
): string | null {
  if (!state || !isPremiumActive(state)) return null;
  const stamp = state.activatedAt ?? state.premiumActivatedAt;
  if (!stamp) return null;
  const start = Date.parse(stamp);
  if (!Number.isFinite(start)) return null;
  return new Date(start + periodDays * MS_PER_DAY).toISOString();
}

export function isPremiumExpired(
  state: PremiumState | null | undefined,
  now: number = Date.now(),
  periodDays: number = PREMIUM_PERIOD_DAYS,
): boolean {
  const expiresAt = premiumExpiresAt(state, periodDays);
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= now;
}

export function mergePremiumState(
  cached: PremiumState,
  remote: Partial<PremiumState> | null | undefined,
): PremiumState {
  if (!remote) return cached;
  const remoteLog =
    typeof remote.premiumActivatedAt === "string" && remote.premiumActivatedAt.length > 0
      ? remote.premiumActivatedAt
      : null;
  const remoteIsPremium = remote.isPremium === true;
  if (remoteIsPremium === cached.isPremium) {
    if (remoteLog && remoteLog !== cached.premiumActivatedAt) {
      return { ...cached, premiumActivatedAt: remoteLog };
    }
    return cached;
  }
  if (remoteIsPremium) {
    const remoteActivatedAt =
      typeof remote.activatedAt === "string" && remote.activatedAt.length > 0
        ? remote.activatedAt
        : null;
    const stamp = remoteActivatedAt ?? cached.activatedAt ?? new Date().toISOString();
    return {
      isPremium: true,
      activatedAt: stamp,
      premiumActivatedAt: remoteLog ?? cached.premiumActivatedAt ?? stamp,
    };
  }
  return {
    isPremium: false,
    activatedAt: null,
    premiumActivatedAt: remoteLog ?? cached.premiumActivatedAt ?? cached.activatedAt,
  };
}
