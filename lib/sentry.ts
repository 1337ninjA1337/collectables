import {
  readSentryEnvFromProcess,
  resolveSentryConfig,
  type SentryConfig,
  type SentryEnvironment,
} from "@/lib/sentry-config";
import { createSlidingWindowLimiter } from "@/lib/sliding-window-limiter";

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
// In-flight init promise. A second initSentry() call (e.g. on auth state
// change) that races the first one returns this instead of kicking off a
// second native-bridge handshake — the caller awaits the real completion
// rather than getting a premature no-op from the `initialised` guard, which
// only flips once the first call's loader has resolved.
let pending: Promise<void> | null = null;
// The most recent loader/init failure (native bridge missing, network init,
// etc.). Stored so a future `sentry-doctor` self-check can surface *why* init
// failed instead of the failure being swallowed by a transient console line.
let lastInitError: unknown = null;
// One-shot guard: log the init failure exactly once via console.error rather
// than re-warning on every retry, so the cause is visible but not spammy.
let initErrorLogged = false;
// ISO timestamp of the last event handed to the SDK (crash capture or smoke
// test). Session-scoped by design — it answers "is anything actually leaving
// this device right now", so it must not persist across restarts.
let lastEventSentAt: string | null = null;

// Rate-limit captureException to MAX_EVENTS_PER_WINDOW within RATE_LIMIT_WINDOW_MS
// so a runaway useEffect loop or an exception in render cannot exhaust the
// 5k/month free-tier quota in seconds.
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 50;
const rateLimiter = createSlidingWindowLimiter(
  MAX_EVENTS_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
);

function rateLimitAllow(now: number = Date.now()): boolean {
  return rateLimiter.allow(now);
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
  pending = null;
}

export async function initSentry(options: InitOptions = {}): Promise<void> {
  if (initialised) return;
  // A concurrent call already started booting — await the same promise so the
  // native bridge handshakes exactly once.
  if (pending) return pending;
  pending = runInit(options);
  try {
    await pending;
  } finally {
    pending = null;
  }
}

async function runInit(options: InitOptions): Promise<void> {
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
      tracesSampleRate: config.tracesSampleRate,
      enableNative: true,
      beforeSend: makeBeforeSend(config.environment),
    });
    sdk = mod;
  } catch (err) {
    // SDK failed to load (native bridge missing, network init, etc.) — stay
    // disabled so call sites keep no-oping instead of crashing the host app.
    // Store the cause for diagnostics and log it once (not on every retry) so
    // it isn't silently masked.
    lastInitError = err;
    if (!initErrorLogged) {
      initErrorLogged = true;
      console.error("[sentry] init failed", err);
    }
  } finally {
    initialised = true;
  }
}

/**
 * Structured context for {@link captureException}. Narrowed from the previous
 * loose `Record<string, unknown>` so call sites get IntelliSense on the two
 * standard fields and can't drift into ad-hoc key names:
 *   - `scope` — a dotted call-site identifier (e.g. "chat-context.fetchReads")
 *     forwarded to Sentry as a filterable `scope` tag.
 *   - `extra` — arbitrary structured data forwarded verbatim to Sentry's `extra`.
 */
export type CaptureContext = {
  scope?: string;
  extra?: Record<string, unknown>;
};

/**
 * Maps our typed {@link CaptureContext} onto the loose object Sentry's SDK
 * expects. Returns `undefined` when there is nothing to forward so we never
 * send an empty `{}`. Pure + exported for unit testing.
 */
export function toSentryCaptureContext(
  context?: CaptureContext,
): { tags?: { scope: string }; extra?: Record<string, unknown> } | undefined {
  if (!context) return undefined;
  const payload: { tags?: { scope: string }; extra?: Record<string, unknown> } =
    {};
  if (context.scope) payload.tags = { scope: context.scope };
  if (context.extra) payload.extra = context.extra;
  return Object.keys(payload).length > 0 ? payload : undefined;
}

export function captureException(
  error: unknown,
  context?: CaptureContext,
): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  if (!rateLimitAllow()) return;
  try {
    sdk.captureException(error, toSentryCaptureContext(context));
    lastEventSentAt = new Date().toISOString();
  } catch {
    /* never let telemetry crash the host app */
  }
}

/**
 * Sentry breadcrumb severity. Maps onto Sentry's `level` field so non-info
 * breadcrumbs (e.g. "user denied photo permission") render with the right
 * colour/severity in the crash timeline instead of the default grey "info".
 */
export type SentryBreadcrumbLevel = "info" | "warning" | "error";

export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: SentryBreadcrumbLevel = "info",
): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.addBreadcrumb({ message, data, level });
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

/**
 * The most recent Sentry init/loader failure, or null if init never failed.
 * Consumed by diagnostics (e.g. a future `sentry-doctor` self-check) to explain
 * a `reason: "init-failed"` status instead of leaving the cause in the console.
 */
export function getSentryLastInitError(): unknown {
  return lastInitError;
}

export type SentryStatus = {
  ready: boolean;
  initialised: boolean;
  optedOut: boolean;
  dsnPresent: boolean;
  environment: SentryEnvironment | null;
  release: string | null;
  /**
   * ISO timestamp of the last event handed to the SDK this session (crash
   * capture or smoke test), or null when nothing has been sent. Drives the
   * "last sent 3 hours ago" footer on Settings → Diagnostics.
   */
  lastEventSentAt: string | null;
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
    lastEventSentAt,
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
    lastEventSentAt = new Date().toISOString();
    return "captured";
  } catch {
    return "not-ready";
  }
}

export function __resetSentryForTests(): void {
  sdk = null;
  initialised = false;
  activeConfig = null;
  pending = null;
  lastInitError = null;
  initErrorLogged = false;
  lastEventSentAt = null;
  rateLimiter.reset();
  userOptedOut = false;
}

export function __resetSentryRateLimitForTests(): void {
  rateLimiter.reset();
}
