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
 * Provider-tree node that wires the analytics SDK identity to the auth +
 * preference contexts and exposes the wrapper via `useAnalytics()`. Mounts a
 * single `useEffect` that:
 *
 *   - calls `identifyUser(user.id, { language, isPremium })` whenever the
 *     authenticated user changes (sign-in, refresh) or the language /
 *     premium-state traits change
 *   - calls `resetUser()` on signout so the next anonymous session does not
 *     inherit the previous user's identity
 *
 * Must mount inside `AuthProvider`, `I18nProvider`, `PremiumProvider`, and
 * `DiagnosticsProvider` (uses each via its hook).
 */
export function AnalyticsProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const { language } = useI18n();
  const { isPremium } = usePremium();
  const { diagnosticsEnabled } = useDiagnostics();
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (user) {
      identifyUser(user.id, { language, isPremium });
      lastUserIdRef.current = user.id;
    } else if (lastUserIdRef.current) {
      // Auth transitioned from "signed in" to "signed out" — clear identity
      // so the next anonymous session does not inherit traits.
      resetUser();
      lastUserIdRef.current = null;
    }
  }, [user, language, isPremium]);

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
