import { createContext, useContext, useEffect, useMemo, useRef } from "react";

import {
  identifyUser,
  resetUser,
  trackEvent,
  type AnalyticsEventName,
  type AnalyticsProps,
  type AnalyticsTraits,
} from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { useDiagnostics } from "@/lib/diagnostics-context";
import { useI18n } from "@/lib/i18n-context";
import {
  createIdentifyScheduler,
  DEFAULT_IDENTIFY_DEBOUNCE_MS,
  type IdentifyScheduler,
} from "@/lib/identify-scheduler";
import { usePremium } from "@/lib/premium-context";

/**
 * React-facing surface of the analytics wrapper. Call sites that need to fire
 * ad-hoc identifies or events (e.g. premium upgrade post-payment) consume this
 * via `useAnalytics()` instead of importing `@/lib/analytics` directly, so the
 * capture path stays inside the React lifecycle and `optedOut` re-renders when
 * the diagnostics toggle flips.
 */
export type AnalyticsContextValue = {
  identify: (userId: string, traits?: AnalyticsTraits) => void;
  reset: () => void;
  track: (name: AnalyticsEventName, props?: AnalyticsProps) => void;
  /** Mirrors the diagnostics toggle — true when the user disabled telemetry. */
  optedOut: boolean;
};

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

/**
 * Debounce window for the identify effect. A rapid premium-flag flip +
 * language switch inside the same render cycle (or a React Strict-Mode
 * double-mount) collapses into a single `identifyUser` call instead of
 * double-charging the PostHog identify quota. Re-exports the scheduler's
 * default so the two modules can never drift.
 */
export const IDENTIFY_DEBOUNCE_MS = DEFAULT_IDENTIFY_DEBOUNCE_MS;

/**
 * Provider-tree node that wires the analytics SDK identity to the auth +
 * preference contexts and exposes the wrapper via `useAnalytics()`. The
 * identify-edge semantics (debounce, fired-identity guard, synchronous reset)
 * live in `createIdentifyScheduler`; the effect here only feeds it:
 *
 *   - `scheduler.update(user.id, { language, isPremium })` whenever the
 *     authenticated user changes (sign-in, refresh) or the language /
 *     premium-state traits change → debounced `identifyUser`
 *   - `scheduler.update(null)` on signout → synchronous `resetUser()` so the
 *     next anonymous session does not inherit the previous user's identity
 *
 * Must mount inside `AuthProvider`, `I18nProvider`, `PremiumProvider`, and
 * `DiagnosticsProvider` (uses each via its hook).
 */
export function AnalyticsProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const { language } = useI18n();
  const { isPremium } = usePremium();
  const { diagnosticsEnabled } = useDiagnostics();
  const schedulerRef = useRef<IdentifyScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createIdentifyScheduler({
      identify: identifyUser,
      reset: resetUser,
      debounceMs: IDENTIFY_DEBOUNCE_MS,
    });
  }
  const scheduler = schedulerRef.current;

  useEffect(() => {
    // Debounced identify on sign-in / trait changes, synchronous reset on the
    // signed-in→signed-out edge — the semantics live in the scheduler.
    scheduler.update(user?.id ?? null, { language, isPremium });
  }, [scheduler, user, language, isPremium]);

  useEffect(() => {
    // Unmount cleanup: cancel any pending identify so it cannot fire after
    // the provider is gone (Strict-Mode double-mounts re-arm via the effect
    // above on the second mount).
    return () => scheduler.dispose();
  }, [scheduler]);

  const value = useMemo<AnalyticsContextValue>(
    () => ({
      identify: identifyUser,
      reset: resetUser,
      track: trackEvent,
      optedOut: !diagnosticsEnabled,
    }),
    [diagnosticsEnabled],
  );

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}

/**
 * Access the analytics wrapper from the React tree. Throws a descriptive
 * error when mounted outside `<AnalyticsProvider>` so a provider-order
 * mistake in app/_layout.tsx surfaces during dev with a clear message.
 */
export function useAnalytics(): AnalyticsContextValue {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) {
    throw new Error(
      "useAnalytics must be used inside <AnalyticsProvider> — check the provider order in app/_layout.tsx",
    );
  }
  return ctx;
}
