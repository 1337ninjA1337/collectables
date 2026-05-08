import {
  readAnalyticsEnvFromProcess,
  resolveAnalyticsConfig,
  type AnalyticsConfig,
} from "@/lib/analytics-config";

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

let userOptedOut = false;

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
}

export function trackEvent(
  name: AnalyticsEventName,
  props?: AnalyticsProps,
): void {
  if (userOptedOut) return;
  if (!sdk || !activeConfig?.enabled) return;
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

export function __resetAnalyticsForTests(): void {
  sdk = null;
  initialised = false;
  activeConfig = null;
  userOptedOut = false;
}
