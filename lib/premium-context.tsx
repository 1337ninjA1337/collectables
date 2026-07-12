import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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

/**
 * Which surface triggered a premium activation. Local call sites tag
 * themselves via `activatePremium(source)`; `"server_sync"` is the resting
 * value, so a false→true flip with no local intent (the cloud validation
 * merge restoring an entitlement) reports honestly instead of inheriting a
 * stale screen. `"unknown"` marks an untagged caller — seeing it on a
 * dashboard means a new call site forgot its source.
 */
export type PremiumIntentSource =
  | "settings"
  | "create_collection"
  | "upsell_sheet"
  | "server_sync"
  | "unknown";

type PremiumContextValue = {
  ready: boolean;
  isPremium: boolean;
  activatedAt: string | null;
  premiumActivatedAt: string | null;
  expiresAt: string | null;
  activatePremium: (source?: PremiumIntentSource) => void;
  cancelPremium: () => void;
  /**
   * One-shot read of the surface behind the most recent activation, for the
   * `premium_activated` transition hook. Consuming resets the intent to
   * `"server_sync"` so a later server-driven flip can't reuse it.
   */
  consumeLastPremiumIntent: () => PremiumIntentSource;
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

  // The intent must be recorded BEFORE the state flip so the transition hook
  // observing isPremium sees it on the very render the flip commits.
  const lastPremiumIntentRef = useRef<PremiumIntentSource>("server_sync");

  const activatePremium = useCallback((source: PremiumIntentSource = "unknown") => {
    lastPremiumIntentRef.current = source;
    setState((prev) => activatePremiumState(prev));
  }, []);

  const cancelPremium = useCallback(() => {
    setState((prev) => cancelPremiumState(prev));
  }, []);

  const consumeLastPremiumIntent = useCallback(() => {
    const source = lastPremiumIntentRef.current;
    lastPremiumIntentRef.current = "server_sync";
    return source;
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
      consumeLastPremiumIntent,
    }),
    [ready, state, activatePremium, cancelPremium, consumeLastPremiumIntent],
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium() {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error("usePremium must be used inside PremiumProvider");
  return ctx;
}
