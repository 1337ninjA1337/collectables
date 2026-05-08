import {
  readAnalyticsEnvFromProcess,
  resolveAnalyticsConfig,
  type AnalyticsConfig,
} from "@/lib/analytics-config";

/**
 * The typed union of every analytics event the app may emit. Defined here
 * (in the same module as `trackEvent`) so misspelled events fail at compile
 * time. Analytics #5 (event taxonomy) layers descriptions + allowed prop
 * shapes on top of this union in `lib/analytics-events.ts`.
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

export type AnalyticsProps = Record<string, unknown>;

export type AnalyticsTraits = Record<string, unknown>;

/**
 * Minimal PostHog-shaped surface the wrapper needs. Keeps the wrapper
 * peer-dep free (mirrors the SentrySdk pattern in `lib/sentry.ts`) so unit
 * tests inject a fake instead of pulling in posthog-react-native's native
 * module at import time.
 */
type AnalyticsSdk = {
  capture: (event: string, properties?: AnalyticsProps) => unknown;
  identify: (distinctId: string, traits?: AnalyticsTraits) => unknown;
  reset: () => unknown;
};

export type AnalyticsLoader = (
  config: AnalyticsConfig,
) => Promise<AnalyticsSdk>;

let sdk: AnalyticsSdk | null = null;
let initialised = false;
let activeConfig: AnalyticsConfig | null = null;

const defaultLoader: AnalyticsLoader = async (config) => {
  const mod = (await import("posthog-react-native")) as unknown as {
    default: new (
      apiKey: string,
      options?: Record<string, unknown>,
    ) => AnalyticsSdk;
  };
  const PostHogCtor = mod.default;
  return new PostHogCtor(config.posthogKey, { host: config.posthogHost });
};

export type InitAnalyticsOptions = {
  env?: Record<string, string | undefined>;
  loader?: AnalyticsLoader;
};

export async function initAnalytics(
  options: InitAnalyticsOptions = {},
): Promise<void> {
  if (initialised) return;
  // Use the literal-access helper so Metro inlines EXPO_PUBLIC_* into the
  // bundle. Passing `process.env` whole would leave the values undefined at
  // runtime — see the dsnPresent: false footgun fixed for Sentry.
  const env = options.env ?? readAnalyticsEnvFromProcess();
  const config = resolveAnalyticsConfig(env);
  activeConfig = config;
  if (!config.enabled) {
    initialised = true;
    return;
  }
  try {
    sdk = await (options.loader ?? defaultLoader)(config);
  } catch (err) {
    // SDK failed to load — stay disabled so call sites keep no-oping
    // instead of crashing the host app.
    // eslint-disable-next-line no-console
    console.warn("[analytics] init failed", err);
  } finally {
    initialised = true;
  }
}

export function trackEvent(
  name: AnalyticsEventName,
  props?: AnalyticsProps,
): void {
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.capture(name, props);
  } catch {
    /* never let telemetry crash the host app */
  }
}

export function identifyUser(
  userId: string,
  traits?: AnalyticsTraits,
): void {
  if (!sdk || !activeConfig?.enabled) return;
  try {
    sdk.identify(userId, traits);
  } catch {
    /* ignore */
  }
}

export function resetUser(): void {
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
}
