import type { AnalyticsEventName, AnalyticsProps } from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analytics-events";

/**
 * Runtime payload validation for analytics events. Sits between `trackEvent`
 * and the PostHog SDK the same way `scrubPII` sits between `captureException`
 * and Sentry: a typo'd payload key fails loudly during development (throw)
 * and is warned about + dropped in production so the event stream never grows
 * undocumented columns that Power BI/the schema doc don't know about.
 */

/** True in React Native / Metro dev builds (bundler defines `__DEV__`). */
function isDevRuntime(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
}

// One warning per event+key combination — a hot render loop re-firing the
// same misspelled payload must not flood the console the way it would flood
// PostHog without the rate limiter.
const warnedKeys = new Set<string>();

export function __resetAnalyticsValidateForTests(): void {
  warnedKeys.clear();
}

export type SplitPropsResult = {
  /** Payload reduced to the keys declared in ANALYTICS_EVENTS[name].props. */
  allowed: AnalyticsProps | undefined;
  /** Keys present in the payload but absent from the taxonomy, sorted. */
  unknown: readonly string[];
};

/**
 * Pure half of the guard: partitions a payload into taxonomy-declared keys
 * and unknown ones. An event name missing from the registry (only reachable
 * via an `as AnalyticsEventName` cast) treats every key as unknown.
 */
export function splitUnknownProps(
  name: AnalyticsEventName,
  payload: AnalyticsProps | undefined,
): SplitPropsResult {
  if (!payload) return { allowed: payload, unknown: [] };
  const definition = (
    ANALYTICS_EVENTS as Record<
      string,
      { readonly props: readonly string[] } | undefined
    >
  )[name];
  const declared = new Set<string>(definition?.props ?? []);
  const unknown = Object.keys(payload)
    .filter((key) => !declared.has(key))
    .sort();
  if (unknown.length === 0) return { allowed: payload, unknown };
  const allowed: AnalyticsProps = {};
  for (const [key, value] of Object.entries(payload)) {
    if (declared.has(key)) allowed[key] = value;
  }
  return { allowed, unknown };
}

/**
 * Validates a `trackEvent` payload against `ANALYTICS_EVENTS[name].props`.
 *
 * - All keys declared → returns the payload unchanged.
 * - Unknown keys, dev runtime (`__DEV__`, overridable via `failFast`) →
 *   throws, so the typo is caught at the desk instead of in the dashboard.
 * - Unknown keys, production → logs one warning per event+key and returns
 *   the payload with the unknown keys dropped.
 */
export function assertValidProps(
  name: AnalyticsEventName,
  payload: AnalyticsProps | undefined,
  options: { failFast?: boolean } = {},
): AnalyticsProps | undefined {
  const { allowed, unknown } = splitUnknownProps(name, payload);
  if (unknown.length === 0) return payload;
  const failFast = options.failFast ?? isDevRuntime();
  const declared = (
    ANALYTICS_EVENTS as Record<
      string,
      { readonly props: readonly string[] } | undefined
    >
  )[name]?.props;
  const detail = `[analytics] event "${name}" received undeclared prop key(s): ${unknown.join(", ")} (allowed: ${declared?.join(", ") ?? "<event not in ANALYTICS_EVENTS>"})`;
  if (failFast) {
    throw new Error(
      `${detail}. Add the key to ANALYTICS_EVENTS in lib/analytics-events.ts or fix the call site.`,
    );
  }
  const warnKey = `${name}:${unknown.join(",")}`;
  if (!warnedKeys.has(warnKey)) {
    warnedKeys.add(warnKey);
    console.warn(`${detail} — dropped from the captured event.`);
  }
  return allowed;
}
