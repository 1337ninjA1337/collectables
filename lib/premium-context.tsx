import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  DEFAULT_PREMIUM_STATE,
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
import { validationToPremiumState } from "@/lib/subscriptions";
import { cloudValidatePremium } from "@/lib/supabase-subscriptions";

type PremiumContextValue = {
  ready: boolean;
  isPremium: boolean;
  activatedAt: string | null;
  premiumActivatedAt: string | null;
  expiresAt: string | null;
  activatePremium: () => void;
  cancelPremium: () => void;
};

const PremiumContext = createContext<PremiumContextValue | null>(null);

export function PremiumProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const [state, setState] = useState<PremiumState>(DEFAULT_PREMIUM_STATE);
  const [ready, setReady] = useState(false);

  const storageKey = useMemo(() => premiumStorageKey(user?.id ?? null), [user]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    if (!storageKey) {
      setState(DEFAULT_PREMIUM_STATE);
      setReady(true);
      return;
    }
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (cancelled) return;
        const parsed = parsePremiumState(raw);
        setState(isPremiumExpired(parsed) ? cancelPremiumState(parsed) : parsed);
      } catch {
        if (!cancelled) setState(DEFAULT_PREMIUM_STATE);
      } finally {
        if (!cancelled) setReady(true);
      }
      // BE-22c: pull server-authoritative truth and LWW-merge it over the
      // AsyncStorage cache (server wins). A transient failure returns null, so
      // the cached entitlement is preserved rather than downgrading a payer.
      const validation = await cloudValidatePremium("validate");
      if (cancelled || !validation) return;
      setState((prev) => mergePremiumState(prev, validationToPremiumState(validation)));
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!ready || !storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(state)).catch(() => undefined);
  }, [ready, storageKey, state]);

  const activatePremium = useCallback(() => {
    setState((prev) => activatePremiumState(prev));
  }, []);

  const cancelPremium = useCallback(() => {
    setState((prev) => cancelPremiumState(prev));
  }, []);

  const value = useMemo<PremiumContextValue>(
    () => ({
      ready,
      isPremium: isPremiumActive(state),
      activatedAt: state.activatedAt,
      premiumActivatedAt: state.premiumActivatedAt,
      expiresAt: premiumExpiresAt(state),
      activatePremium,
      cancelPremium,
    }),
    [ready, state, activatePremium, cancelPremium],
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium() {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error("usePremium must be used inside PremiumProvider");
  return ctx;
}
