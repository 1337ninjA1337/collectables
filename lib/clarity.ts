import { analyticsConfig } from "@/lib/analytics-config";

/**
 * Microsoft Clarity (web-only) session-replay loader.
 *
 * Clarity ships its tracker as a single async `<script>` tag — there is no
 * SDK to npm-install. We inject the tag at runtime once all of these gates
 * pass:
 *   1. The host is a browser (`window` + `document` exist) — Clarity has no
 *      native counterpart and we never want it to try loading on iOS/Android
 *      where the React Native bundle runs without `document`.
 *   2. `navigator.doNotTrack === "1"` is honoured — required for the Apple
 *      App Privacy story and listed as a requirement in
 *      `docs/analytics-platform.md`.
 *   3. The user has not opted out of diagnostics (Crash #15 / Analytics #18
 *      single-toggle pattern). The DiagnosticsProvider flips this via
 *      `setClarityOptOut(true)` whenever the toggle is off.
 *   4. `analyticsConfig.enabled === true` — guarantees we never load Clarity
 *      in `development` and never load it when no PostHog key is set, so
 *      analytics + replay stay tied to the same opt-in surface.
 *   5. `analyticsConfig.clarityId` is non-empty — without a project ID the
 *      remote tag URL is meaningless, so we silently no-op.
 */

const CLARITY_SCRIPT_ID = "ms-clarity-tag";
const CLARITY_TAG_BASE_URL = "https://www.clarity.ms/tag/";

let injected = false;
let optedOut = false;

export type ClarityRuntime = {
  isBrowser: boolean;
  doNotTrack: boolean;
  clarityId: string;
  enabled: boolean;
};

export function detectBrowserRuntime(): {
  isBrowser: boolean;
  doNotTrack: boolean;
} {
  const isBrowser =
    typeof window !== "undefined" && typeof document !== "undefined";
  if (!isBrowser) return { isBrowser: false, doNotTrack: false };
  const nav = (
    window as unknown as {
      navigator?: { doNotTrack?: unknown; msDoNotTrack?: unknown };
    }
  ).navigator;
  const dnt = nav?.doNotTrack ?? nav?.msDoNotTrack;
  const doNotTrack = dnt === "1" || dnt === "yes" || dnt === true;
  return { isBrowser, doNotTrack };
}

export function shouldLoadClarity(runtime: ClarityRuntime): boolean {
  if (optedOut) return false;
  if (!runtime.isBrowser) return false;
  if (runtime.doNotTrack) return false;
  if (!runtime.enabled) return false;
  if (!runtime.clarityId || runtime.clarityId.trim().length === 0) return false;
  return true;
}

function injectScript(projectId: string): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }
  if (document.getElementById(CLARITY_SCRIPT_ID)) return true;
  // Initialise the queued-call shim BEFORE the remote script loads so any
  // tracker calls fired between the DOM injection and the script's actual
  // download/execute are buffered (this mirrors the official Clarity
  // snippet's IIFE so we stay drop-in compatible).
  const w = window as unknown as {
    clarity?: { (...args: unknown[]): void; q?: unknown[][] };
  };
  if (typeof w.clarity !== "function") {
    const queue: unknown[][] = [];
    const fn = ((...args: unknown[]) => {
      queue.push(args);
    }) as { (...args: unknown[]): void; q?: unknown[][] };
    fn.q = queue;
    w.clarity = fn;
  }
  const script = document.createElement("script");
  script.id = CLARITY_SCRIPT_ID;
  script.async = true;
  script.src = `${CLARITY_TAG_BASE_URL}${encodeURIComponent(projectId)}`;
  const first = document.getElementsByTagName("script")[0];
  if (first && first.parentNode) {
    first.parentNode.insertBefore(script, first);
  } else if (document.head) {
    document.head.appendChild(script);
  } else {
    return false;
  }
  return true;
}

export function initClarity(options?: {
  runtime?: ClarityRuntime;
}): boolean {
  if (injected) return true;
  const runtime: ClarityRuntime = options?.runtime ?? {
    ...detectBrowserRuntime(),
    clarityId: analyticsConfig.clarityId,
    enabled: analyticsConfig.enabled,
  };
  if (!shouldLoadClarity(runtime)) return false;
  try {
    const ok = injectScript(runtime.clarityId);
    if (ok) injected = true;
    return ok;
  } catch {
    return false;
  }
}

export function setClarityOptOut(next: boolean): void {
  optedOut = next;
  if (next) shutdownClarity();
}

export function isClarityOptedOut(): boolean {
  return optedOut;
}

export function isClarityReady(): boolean {
  return injected;
}

export function shutdownClarity(): void {
  if (typeof document !== "undefined") {
    const existing = document.getElementById(CLARITY_SCRIPT_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }
  if (typeof window !== "undefined") {
    const w = window as unknown as { clarity?: unknown };
    if (w.clarity) {
      try {
        delete w.clarity;
      } catch {
        w.clarity = undefined;
      }
    }
  }
  injected = false;
}

export function __resetClarityForTests(): void {
  injected = false;
  optedOut = false;
}
