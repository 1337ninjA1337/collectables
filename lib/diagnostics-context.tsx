import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  initSentry,
  setSentryOptOut,
  shutdownSentry,
} from "@/lib/sentry";
import { DIAGNOSTICS_KEY } from "@/lib/storage-keys";

type DiagnosticsContextValue = {
  ready: boolean;
  diagnosticsEnabled: boolean;
  setDiagnosticsEnabled: (next: boolean) => void;
};

const DiagnosticsContext = createContext<DiagnosticsContextValue | null>(null);

export type StoredDiagnostics = { enabled: boolean };

export function parseStoredDiagnostics(raw: string | null): boolean {
  // Default: opt-IN (true). Only persist `false` flips this.
  if (!raw) return true;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDiagnostics>;
    return parsed.enabled !== false;
  } catch {
    return true;
  }
}

export function DiagnosticsProvider({ children }: React.PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [diagnosticsEnabled, setEnabled] = useState(true);

  // Hydrate the stored choice on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DIAGNOSTICS_KEY)
      .then((raw) => {
        if (cancelled) return;
        const next = parseStoredDiagnostics(raw);
        setEnabled(next);
        setSentryOptOut(!next);
        if (next) void initSentry();
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setDiagnosticsEnabled = useMemo(
    () => (next: boolean) => {
      setEnabled(next);
      setSentryOptOut(!next);
      AsyncStorage.setItem(
        DIAGNOSTICS_KEY,
        JSON.stringify({ enabled: next }),
      ).catch(() => undefined);
      if (next) {
        void initSentry();
      } else {
        shutdownSentry();
      }
    },
    [],
  );

  const value = useMemo(
    () => ({ ready, diagnosticsEnabled, setDiagnosticsEnabled }),
    [ready, diagnosticsEnabled, setDiagnosticsEnabled],
  );

  return (
    <DiagnosticsContext.Provider value={value}>
      {children}
    </DiagnosticsContext.Provider>
  );
}

export function useDiagnostics() {
  const ctx = useContext(DiagnosticsContext);
  if (!ctx) {
    throw new Error("useDiagnostics must be used inside DiagnosticsProvider");
  }
  return ctx;
}
