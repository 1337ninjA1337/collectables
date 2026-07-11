import {
  readAnalyticsEnvFromProcess,
  resolveAnalyticsConfig,
  type AnalyticsConfig,
} from "@/lib/analytics-config";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
} from "@/lib/analytics-events";
import { assertValidProps } from "@/lib/analytics-validate";
import { makeLazyLoader } from "@/lib/lazy-sdk";
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
  | "item_photos_replaced"
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

// Last successful identify, for the diagnostics screen ("Last identify:
// 2 minutes ago — language=ru, isPremium=false"). Cleared on resetUser so a
// signed-out session never exposes the previous user's traits.
let lastIdentifyAt: number | null = null;
let lastIdentifyTraits: AnalyticsTraits | null = null;

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

const defaultLoader: AnalyticsLoader = makeLazyLoader(
  () => import("posthog-react-native"),
  (mod) => {
    const m = mod as unknown as {
      default: PostHogConstructor;
      PostHog?: PostHogConstructor;
    };
    return m.default ?? m.PostHog!;
  },
);

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
  // Validate BEFORE the enabled/opt-out gates: analytics is disabled in dev
  // builds, and dev is exactly where a typo'd payload key must throw (see
  // lib/analytics-validate.ts). In production this warns + strips instead.
  const safeProps = assertValidProps(name, props);
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  if (!rateLimitAllow()) return;
  try {
    sdk.capture(name, safeProps);
  } catch {
    /* never let telemetry crash the host app */
  }
}

export function identifyUser(userId: string, traits?: AnalyticsTraits): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.identify(userId, traits);
    lastIdentifyAt = Date.now();
    lastIdentifyTraits = traits ? { ...traits } : null;
  } catch {
    /* never let identity tracking crash the host app */
  }
}

export function resetUser(): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.reset();
    lastIdentifyAt = null;
    lastIdentifyTraits = null;
  } catch {
    /* ignore */
  }
}

export type AnalyticsSnapshot = {
  /** Epoch ms of the last identify that actually reached the SDK, or null. */
  lastIdentifyAt: number | null;
  /** Traits sent with that identify (defensive copy), or null. */
  lastIdentifyTraits: AnalyticsTraits | null;
};

/**
 * Read-only snapshot of the last successful identify, mirroring
 * `getAnalyticsStatus()`. Lets the settings diagnostics screen render
 * "Last identify: 2 minutes ago — language=ru, isPremium=false" without
 * re-deriving the values from the React tree. Only identifies that pass the
 * opt-out/enabled gates and reach `sdk.identify` are recorded; `resetUser()`
 * clears the snapshot so a signed-out session never exposes the previous
 * user's traits.
 */
export function getAnalyticsSnapshot(): AnalyticsSnapshot {
  return {
    lastIdentifyAt,
    lastIdentifyTraits: lastIdentifyTraits ? { ...lastIdentifyTraits } : null,
  };
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
  // Opt-out is the FIRST gate trackEvent checks, before the sdk/enabled
  // pair isAnalyticsReady() reflects — so a live SDK with the flag flipped
  // (the window between setAnalyticsOptOut and shutdownAnalytics, or a
  // caller that forgets the shutdown) must report not-ready, not "ready"
  // while every capture is silently dropped.
  const ready = isAnalyticsReady() && !userOptedOut;
  let reason: AnalyticsStatus["reason"];
  if (userOptedOut) reason = "user-opted-out";
  else if (ready) reason = "ready";
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

/**
 * Dev-only smoke test for the PostHog wire. Fires a synthetic
 * `signup_completed` event (`method: "manual_test"`) so a developer can
 * verify the capture pipeline end-to-end without forging a fresh OTP/OAuth
 * flow, then returns the status snapshot so a console caller immediately
 * sees which gate (if any) blocked the capture. Exposed as
 * `globalThis.__simulateSignupEvent()` via the `isDevEnvironment()`-gated
 * `registerDevMenu` call in app/_layout.tsx — never attached in production
 * builds, and every runtime gate in `trackEvent` (opt-out, enabled, rate
 * limit) still applies to the synthetic event.
 */
export function simulateSignupEvent(): AnalyticsStatus {
  trackEvent("signup_completed", { method: "manual_test" });
  return getAnalyticsStatus();
}

export type AnalyticsEventCatalogEntry = {
  readonly name: AnalyticsEventName;
  readonly description: string;
  readonly props: readonly string[];
};

/**
 * Read-only view of the event taxonomy for UI consumers (the settings
 * Diagnostics "Events captured by this app" list). Derived entirely from
 * `ANALYTICS_EVENTS` — zero hardcoded copy — and exposed here so screens
 * consume the taxonomy through lib/analytics.ts rather than importing
 * `@/lib/analytics-events` directly (keeps the future bundle-size import
 * gate on that module intact). Sorted by event name.
 */
export function getAnalyticsEventCatalog(): readonly AnalyticsEventCatalogEntry[] {
  return ANALYTICS_EVENT_NAMES.map((name) => ({
    name,
    description: ANALYTICS_EVENTS[name].description,
    props: ANALYTICS_EVENTS[name].props,
  }));
}

export function __resetAnalyticsForTests(): void {
  sdk = null;
  initialised = false;
  activeConfig = null;
  pending = null;
  userOptedOut = false;
  lastIdentifyAt = null;
  lastIdentifyTraits = null;
  rateLimiter.reset();
}

export function __resetAnalyticsRateLimitForTests(): void {
  rateLimiter.reset();
}
