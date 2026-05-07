import {
  readSentryEnvFromProcess,
  resolveSentryConfig,
  type SentryConfig,
  type SentryEnvironment,
} from "@/lib/sentry-config";

export type SentryEvent = {
  user?: { id?: string; email?: string | null; ip_address?: string };
  request?: {
    cookies?: string | Record<string, string>;
    headers?: Record<string, string>;
  };
  [key: string]: unknown;
};

export function scrubPII(
  event: SentryEvent,
  environment: SentryEnvironment,
): SentryEvent {
  // In dev environments leave the event untouched so engineers can debug.
  if (environment === "development") return event;

  const next: SentryEvent = { ...event };
  if (next.user) {
    const { email: _email, ip_address: _ip, ...userRest } = next.user;
    next.user = userRest;
  }
  if (next.request) {
    const request = { ...next.request };
    delete request.cookies;
    if (request.headers) {
      const headers = { ...request.headers };
      delete headers.cookie;
      delete headers.Cookie;
      delete headers.authorization;
      delete headers.Authorization;
      request.headers = headers;
    }
    next.request = request;
  }
  return next;
}

export function makeBeforeSend(environment: SentryEnvironment) {
  return (event: SentryEvent) => scrubPII(event, environment);
}

type SentrySdk = {
  init: (options: Record<string, unknown>) => unknown;
  captureException: (error: unknown, context?: Record<string, unknown>) => unknown;
  addBreadcrumb: (breadcrumb: Record<string, unknown>) => unknown;
  setUser?: (user: Record<string, unknown> | null) => unknown;
};

export type SentryLoader = () => Promise<SentrySdk>;

let sdk: SentrySdk | null = null;
let initialised = false;
let activeConfig: SentryConfig | null = null;

// Rate-limit captureException to MAX_EVENTS_PER_WINDOW within RATE_LIMIT_WINDOW_MS
// so a runaway useEffect loop or an exception in render cannot exhaust the
// 5k/month free-tier quota in seconds.
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 50;
let recentEvents: number[] = [];

function rateLimitAllow(now: number = Date.now()): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  recentEvents = recentEvents.filter((ts) => ts > cutoff);
  if (recentEvents.length >= MAX_EVENTS_PER_WINDOW) return false;
  recentEvents.push(now);
  return true;
}

const defaultLoader: SentryLoader = async () => {
  const mod = (await import("@sentry/react-native")) as unknown as SentrySdk;
  return mod;
};

export type InitOptions = {
  env?: Record<string, string | undefined>;
  loader?: SentryLoader;
};

let userOptedOut = false;

/**
 * Honoured by initSentry — when set to true (e.g. user toggled the
 * "Diagnostics & crash reports" switch off), the SDK never initialises.
 * Wrappers also short-circuit when the flag flips after init.
 */
export function setSentryOptOut(optedOut: boolean): void {
  userOptedOut = optedOut;
}

export function isSentryOptedOut(): boolean {
  return userOptedOut;
}

/**
 * Closes any active SDK and clears the cached references so the next call
 * to initSentry can decide whether to boot again. Used when the user flips
 * the diagnostics toggle off mid-session.
 */
export function shutdownSentry(): void {
  sdk = null;
  initialised = false;
  activeConfig = null;
}

export async function initSentry(options: InitOptions = {}): Promise<void> {
  if (initialised) return;
  if (userOptedOut) {
    initialised = true;
    return;
  }
  // Use the literal-access helper so Metro inlines EXPO_PUBLIC_* into the
  // bundle. Passing `process.env` whole would leave the values undefined at
  // runtime in the web bundle.
  const env = options.env ?? readSentryEnvFromProcess();
  const config = resolveSentryConfig(env);
  activeConfig = config;
  if (!config.enabled) {
    initialised = true;
    return;
  }
  try {
    const mod = await (options.loader ?? defaultLoader)();
    mod.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      tracesSampleRate: 0.1,
      enableNative: true,
      beforeSend: makeBeforeSend(config.environment),
    });
    sdk = mod;
  } catch (err) {
    // SDK failed to load (native bridge missing, network init, etc.) — stay
    // disabled so call sites keep no-oping instead of crashing the host app.
    console.warn("[sentry] init failed", err);
  } finally {
    initialised = true;
  }
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  if (!rateLimitAllow()) return;
  try {
    sdk.captureException(error, context ? { extra: context } : undefined);
  } catch {
    /* never let telemetry crash the host app */
  }
}

export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.addBreadcrumb({ message, data, level: "info" });
  } catch {
    /* ignore */
  }
}

export type SentryUser = { id: string; email?: string | null } | null;

export function setSentryUser(user: SentryUser): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled || !sdk.setUser) return;
  try {
    if (user === null) {
      sdk.setUser(null);
    } else {
      sdk.setUser({
        id: user.id,
        ...(user.email ? { email: user.email } : {}),
      });
    }
  } catch {
    /* never let identity tracking crash the host app */
  }
}

export function isSentryReady(): boolean {
  return sdk !== null && (activeConfig?.enabled ?? false);
}

export type SentryStatus = {
  ready: boolean;
  initialised: boolean;
  optedOut: boolean;
  dsnPresent: boolean;
  environment: SentryEnvironment | null;
  release: string | null;
  reason:
    | "ready"
    | "not-initialised"
    | "user-opted-out"
    | "missing-dsn"
    | "development-env"
    | "init-failed";
};

/**
 * Returns a structured snapshot of the Sentry wrapper state. Useful for
 * debugging "not-ready" responses from `triggerSentryTestError` — surfaces
 * exactly which gate (DSN missing, dev env, opt-out, init still pending,
 * loader failed) is blocking event capture.
 *
 * Exposed on `globalThis.__sentryStatus()` from app/_layout.tsx.
 */
export function getSentryStatus(): SentryStatus {
  const dsnPresent = !!activeConfig?.dsn;
  const environment = activeConfig?.environment ?? null;
  const release = activeConfig?.release ?? null;
  const ready = isSentryReady();
  let reason: SentryStatus["reason"];
  if (ready) reason = "ready";
  else if (userOptedOut) reason = "user-opted-out";
  else if (!initialised) reason = "not-initialised";
  else if (!dsnPresent) reason = "missing-dsn";
  else if (environment === "development") reason = "development-env";
  else reason = "init-failed";
  return {
    ready,
    initialised,
    optedOut: userOptedOut,
    dsnPresent,
    environment,
    release,
    reason,
  };
}

/**
 * Fires a deliberate test event into Sentry so a deployed install can verify
 * its DSN + sourcemap wiring end-to-end. Returns one of:
 *   - "captured" → SDK is enabled and the event was forwarded to Sentry.
 *   - "not-ready" → SDK never initialised (DSN missing or env=development).
 *   - "rate-limited" → the per-minute rate limiter dropped the event.
 *
 * Intended to be invoked from the browser devtools console via the
 * `globalThis.__sendSentryTestError()` global registered in app/_layout.tsx,
 * or from a future admin-only "Send test error" button.
 */
export function triggerSentryTestError(
  message: string = "Sentry smoke test",
): "captured" | "not-ready" | "rate-limited" {
  if (!sdk || !activeConfig?.enabled) {
    const status = getSentryStatus();
    // Print a structured diagnostic to the devtools console so the operator
    // can see which gate is blocking. Useful when the API returns
    // "not-ready" but the user can't tell whether that's "DSN missing",
    // "init still pending", or "user opted out".
    // eslint-disable-next-line no-console
    console.info("[sentry] smoke test blocked:", status);
    return "not-ready";
  }
  if (!rateLimitAllow()) return "rate-limited";
  try {
    sdk.captureException(new Error(message), {
      extra: { context: "sentry.smokeTest", triggeredAt: new Date().toISOString() },
    });
    return "captured";
  } catch {
    return "not-ready";
  }
}

export function __resetSentryForTests(): void {
  sdk = null;
  initialised = false;
  activeConfig = null;
  recentEvents = [];
  userOptedOut = false;
}

export function __resetSentryRateLimitForTests(): void {
  recentEvents = [];
}
