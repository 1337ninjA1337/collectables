import React from "react";

import { usePremium } from "@/lib/premium-context";

type Props = {
  fallback?: React.ReactNode;
  loading?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Renders `children` when premium is active and ready.
 * Shows `loading` while hydrating (prevents cold-start flash).
 * Shows `fallback` when ready and not premium.
 */
export function PremiumGate({ fallback = null, loading = null, children }: Props) {
  const { ready, isPremium } = usePremium();
  if (!ready) return <>{loading}</>;
  if (!isPremium) return <>{fallback}</>;
  return <>{children}</>;
}
