export type PremiumState = {
  isPremium: boolean;
  activatedAt: string | null;
  premiumActivatedAt: string | null;
};

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
