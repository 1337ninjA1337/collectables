import {
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

export async function initSentry(options: InitOptions = {}): Promise<void> {
  if (initialised) return;
  const env =
    options.env ?? (process.env as Record<string, string | undefined>);
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
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.addBreadcrumb({ message, data, level: "info" });
  } catch {
    /* ignore */
  }
}

export type SentryUser = { id: string; email?: string | null } | null;

export function setSentryUser(user: SentryUser): void {
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
  if (!sdk || !activeConfig?.enabled) return "not-ready";
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
}

export function __resetSentryRateLimitForTests(): void {
  recentEvents = [];
}
