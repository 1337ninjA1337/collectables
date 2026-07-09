import {
  readAnalyticsEnvFromProcess,
  resolveAnalyticsConfig,
  type AnalyticsConfig,
} from "@/lib/analytics-config";
import { createSlidingWindowLimiter } from "@/lib/sliding-window-limiter";

/**
 * Closed set of event names the analytics wrapper accepts. Defined here so
 * misspelled event names fail at compile time. Analytics #5 will add a
 * companion `lib/analytics-events.ts` that pairs each name with a description
 * and prop schema; the union here remains the single source of truth for the
 * `trackEvent` overload.
 */
export type AnalyticsEventName =
  | "signup_completed"
  | "collection_created"
  | "item_added"
  | "item_photo_attached"
  | "listing_created"
  | "listing_claimed"
  | "chat_opened"
  | "friend_requested"
  | "premium_activated"
  | "premium_upsell_shown"
  | "language_switched";

export type AnalyticsProps = Record<string, string | number | boolean | null>;

export type AnalyticsTraits = Record<string, string | number | boolean | null>;

type PostHogSdk = {
  capture: (event: string, properties?: AnalyticsProps) => unknown;
  identify: (userId: string, traits?: AnalyticsTraits) => unknown;
  reset: () => unknown;
  shutdown?: () => unknown;
};

type PostHogConstructor = new (
  apiKey: string,
  options?: { host?: string; captureAppLifecycleEvents?: boolean },
) => PostHogSdk;

export type AnalyticsLoader = () => Promise<PostHogConstructor>;

let sdk: PostHogSdk | null = null;
let initialised = false;
let activeConfig: AnalyticsConfig | null = null;
// In-flight init promise. A second initAnalytics() call (e.g. on auth state
// change) that races the first one returns this instead of constructing a
// second PostHog instance — the caller awaits the real completion rather than
// slipping past the `initialised` guard, which only flips once the first call's
// loader has resolved. Mirrors the Sentry initSentry() dedup.
let pending: Promise<void> | null = null;

let userOptedOut = false;

// Rate-limit trackEvent to MAX_EVENTS_PER_WINDOW within RATE_LIMIT_WINDOW_MS
// so a runaway useEffect loop or a list render that fires capture() per row
// cannot exhaust the PostHog free-tier (1M events/mo) in seconds. Mirrors the
// Sentry captureException limiter (Crash #11); 200/min/user is generous for
// real interaction yet caps a hot loop at ~288k/day instead of unbounded.
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 200;
const rateLimiter = createSlidingWindowLimiter(
  MAX_EVENTS_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
);

function rateLimitAllow(now: number = Date.now()): boolean {
  return rateLimiter.allow(now);
}

/**
 * Honoured by initAnalytics — when set to true (e.g. user toggled the
 * "Diagnostics & analytics" switch off), the SDK never initialises.
 * Wrappers also short-circuit when the flag flips after init.
 */
export function setAnalyticsOptOut(optedOut: boolean): void {
  userOptedOut = optedOut;
}

export function isAnalyticsOptedOut(): boolean {
  return userOptedOut;
}

const defaultLoader: AnalyticsLoader = async () => {
  const mod = (await import("posthog-react-native")) as unknown as {
    default: PostHogConstructor;
    PostHog?: PostHogConstructor;
  };
  return mod.default ?? mod.PostHog!;
};

export type InitOptions = {
  env?: Record<string, string | undefined>;
  loader?: AnalyticsLoader;
};

export async function initAnalytics(options: InitOptions = {}): Promise<void> {
  if (initialised) return;
  // A concurrent call already started booting — await the same promise so the
  // PostHog instance is constructed exactly once.
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
  const env = options.env ?? readAnalyticsEnvFromProcess();
  const config = resolveAnalyticsConfig(env);
  activeConfig = config;
  if (!config.enabled) {
    initialised = true;
    return;
  }
  try {
    const Ctor = await (options.loader ?? defaultLoader)();
    sdk = new Ctor(config.posthogKey, {
      host: config.posthogHost,
      captureAppLifecycleEvents: true,
    });
  } catch (err) {
    // SDK failed to load (native bridge missing, network init, etc.) — stay
    // disabled so call sites keep no-oping instead of crashing the host app.
    console.warn("[analytics] init failed", err);
  } finally {
    initialised = true;
  }
}

/**
 * Closes any active SDK and clears the cached references so the next call
 * to initAnalytics can decide whether to boot again. Used when the user flips
 * the diagnostics toggle off mid-session.
 */
export function shutdownAnalytics(): void {
  if (sdk?.shutdown) {
    try {
      sdk.shutdown();
    } catch {
      /* ignore */
    }
  }
  sdk = null;
  initialised = false;
  activeConfig = null;
  pending = null;
}

export function trackEvent(
  name: AnalyticsEventName,
  props?: AnalyticsProps,
): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  if (!rateLimitAllow()) return;
  try {
    sdk.capture(name, props);
  } catch {
    /* never let telemetry crash the host app */
  }
}

export function identifyUser(userId: string, traits?: AnalyticsTraits): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.identify(userId, traits);
  } catch {
    /* never let identity tracking crash the host app */
  }
}

export function resetUser(): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.reset();
  } catch {
    /* ignore */
  }
}

export function isAnalyticsReady(): boolean {
  return sdk !== null && (activeConfig?.enabled ?? false);
}

export type AnalyticsStatus = {
  ready: boolean;
  initialised: boolean;
  optedOut: boolean;
  keyPresent: boolean;
  environment: AnalyticsConfig["environment"] | null;
  host: string | null;
  reason:
    | "ready"
    | "not-initialised"
    | "user-opted-out"
    | "missing-key"
    | "development-env"
    | "kill-switch"
    | "init-failed";
};

/**
 * Returns a structured snapshot of the analytics wrapper state, mirroring
 * `getSentryStatus()` in lib/sentry.ts. Surfaces exactly which gate (key
 * missing, dev env, kill-switch, opt-out, init still pending, loader failed)
 * is blocking event capture, so the settings Diagnostics screen can render
 * "events flowing / blocked because X" without reimplementing the gate-walk.
 *
 * Exposed on `globalThis.__analyticsStatus()` from app/_layout.tsx.
 */
export function getAnalyticsStatus(): AnalyticsStatus {
  const keyPresent = (activeConfig?.posthogKey ?? "").length > 0;
  const environment = activeConfig?.environment ?? null;
  const host = activeConfig?.posthogHost ?? null;
  const ready = isAnalyticsReady();
  let reason: AnalyticsStatus["reason"];
  if (ready) reason = "ready";
  else if (userOptedOut) reason = "user-opted-out";
  else if (!initialised) reason = "not-initialised";
  else if (!keyPresent) reason = "missing-key";
  else if (environment === "development") reason = "development-env";
  // Key present, non-dev env, yet the resolver still disabled analytics —
  // only the EXPO_PUBLIC_ANALYTICS_DISABLED kill-switch produces that combo.
  else if (!(activeConfig?.enabled ?? false)) reason = "kill-switch";
  else reason = "init-failed";
  return {
    ready,
    initialised,
    optedOut: userOptedOut,
    keyPresent,
    environment,
    host,
    reason,
  };
}

export function __resetAnalyticsForTests(): void {
  sdk = null;
  initialised = false;
  activeConfig = null;
  pending = null;
  userOptedOut = false;
  rateLimiter.reset();
}

export function __resetAnalyticsRateLimitForTests(): void {
  rateLimiter.reset();
}
