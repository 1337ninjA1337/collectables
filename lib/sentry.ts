import { resolveSentryConfig, type SentryConfig } from "@/lib/sentry-config";

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

export function __resetSentryForTests(): void {
  sdk = null;
  initialised = false;
  activeConfig = null;
}
