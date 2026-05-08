import { useEffect, useRef } from "react";

import { identifyUser, resetUser } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { usePremium } from "@/lib/premium-context";

/**
 * Provider-tree node that wires the analytics SDK identity to the auth +
 * preference contexts. Mounts a single `useEffect` that:
 *
 *   - calls `identifyUser(user.id, { language, isPremium })` whenever the
 *     authenticated user changes (sign-in, refresh) or the language /
 *     premium-state traits change
 *   - calls `resetUser()` on signout so the next anonymous session does not
 *     inherit the previous user's identity
 *
 * Must mount inside `AuthProvider`, `I18nProvider`, and `PremiumProvider`
 * (uses each via its hook).
 */
export function AnalyticsProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const { language } = useI18n();
  const { isPremium } = usePremium();
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

  return <>{children}</>;
}
