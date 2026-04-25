export type PremiumState = {
  isPremium: boolean;
  activatedAt: string | null;
};

export const DEFAULT_PREMIUM_STATE: PremiumState = {
  isPremium: false,
  activatedAt: null,
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
    return {
      isPremium: parsed.isPremium === true,
      activatedAt:
        typeof parsed.activatedAt === "string" && parsed.activatedAt.length > 0
          ? parsed.activatedAt
          : null,
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
  return { isPremium: true, activatedAt: now() };
}

export function cancelPremiumState(state: PremiumState): PremiumState {
  if (!state.isPremium) return state;
  return { isPremium: false, activatedAt: null };
}

export function mergePremiumState(
  cached: PremiumState,
  remote: Partial<PremiumState> | null | undefined,
): PremiumState {
  if (!remote) return cached;
  const remoteIsPremium = remote.isPremium === true;
  if (remoteIsPremium === cached.isPremium) return cached;
  if (remoteIsPremium) {
    return {
      isPremium: true,
      activatedAt:
        typeof remote.activatedAt === "string" && remote.activatedAt.length > 0
          ? remote.activatedAt
          : (cached.activatedAt ?? new Date().toISOString()),
    };
  }
  return { isPremium: false, activatedAt: null };
}
