import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  initAnalytics,
  setAnalyticsOptOut,
  shutdownAnalytics,
} from "@/lib/analytics";
import {
  initClarity,
  setClarityOptOut,
  shutdownClarity,
} from "@/lib/clarity";
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

/**
 * Returns the user's explicit stored choice, or `null` when there is no
 * valid persisted decision yet. `null` is the signal that the Do-Not-Track
 * default may apply — an explicit choice (either way) always wins over the
 * browser signal because it represents real consent.
 */
export function parseStoredChoice(raw: string | null): boolean | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDiagnostics>;
    return typeof parsed.enabled === "boolean" ? parsed.enabled : null;
  } catch {
    return null;
  }
}

export function parseStoredDiagnostics(raw: string | null): boolean {
  // Back-compat helper: default opt-IN unless an explicit `false` is stored.
  return parseStoredChoice(raw) !== false;
}

/**
 * Reads the browser Do-Not-Track signal. Web-only — native has no
 * `navigator.doNotTrack`, so this returns false there (opt-in default).
 * Handles the three historical surfaces: `navigator.doNotTrack` ("1"),
 * legacy `window.doNotTrack` ("1"/"yes"), and IE's `navigator.msDoNotTrack`.
 */
export function readDoNotTrack(): boolean {
  try {
    const g = globalThis as {
      navigator?: { doNotTrack?: string | null; msDoNotTrack?: string | null };
      doNotTrack?: string | null;
    };
    const signal =
      g.navigator?.doNotTrack ??
      g.doNotTrack ??
      g.navigator?.msDoNotTrack ??
      null;
    return signal === "1" || signal === "yes";
  } catch {
    return false;
  }
}

/**
 * Resolves the effective default on hydrate: an explicit stored choice wins,
 * otherwise honour Do-Not-Track (opt-out), otherwise opt-in.
 */
export function resolveDiagnosticsEnabled(
  raw: string | null,
  doNotTrack: boolean,
): boolean {
  const choice = parseStoredChoice(raw);
  if (choice !== null) return choice;
  return !doNotTrack;
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
        const next = resolveDiagnosticsEnabled(raw, readDoNotTrack());
        setEnabled(next);
        setSentryOptOut(!next);
        setAnalyticsOptOut(!next);
        setClarityOptOut(!next);
        if (next) {
          void initSentry();
          void initAnalytics();
          initClarity();
        }
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
      setAnalyticsOptOut(!next);
      setClarityOptOut(!next);
      AsyncStorage.setItem(
        DIAGNOSTICS_KEY,
        JSON.stringify({ enabled: next }),
      ).catch(() => undefined);
      if (next) {
        void initSentry();
        void initAnalytics();
        initClarity();
      } else {
        shutdownSentry();
        shutdownAnalytics();
        shutdownClarity();
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
