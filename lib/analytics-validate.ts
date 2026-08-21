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

export type InvalidPropValue = {
  readonly key: string;
  readonly value: string;
  readonly allowed: readonly string[];
};

/**
 * Pure half of the value check: finds props carrying a value outside the
 * closed set `ANALYTICS_EVENTS[name].values` declares for them.
 *
 * Only string values are judged. A number or boolean under a key that
 * declares a set is reported too — the set is the statement that this prop is
 * a small enumeration, and `mode: 3` is as wrong as `mode: "swap"` — but
 * `null` is not, because it is how the app already says "not applicable" and
 * a set of buckets is not a claim that one always applies.
 */
export function findInvalidPropValues(
  name: AnalyticsEventName,
  payload: AnalyticsProps | undefined,
): readonly InvalidPropValue[] {
  if (!payload) return [];
  const values = (
    ANALYTICS_EVENTS as Record<
      string,
      { readonly values?: Readonly<Record<string, readonly string[]>> } | undefined
    >
  )[name]?.values;
  if (!values) return [];
  const invalid: InvalidPropValue[] = [];
  for (const [key, allowed] of Object.entries(values)) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (value === null) continue;
    if (typeof value === "string" && allowed.includes(value)) continue;
    invalid.push({ key, value: String(value), allowed });
  }
  return invalid.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Validates a `trackEvent` payload against `ANALYTICS_EVENTS[name]`.
 *
 * - All keys declared and all constrained values in range → payload unchanged.
 * - Unknown keys, dev runtime (`__DEV__`, overridable via `failFast`) →
 *   throws, so the typo is caught at the desk instead of in the dashboard.
 * - Unknown keys, production → logs one warning per event+key and returns
 *   the payload with the unknown keys dropped.
 * - Out-of-set values, dev → throws, same reasoning.
 * - Out-of-set values, production → warns once and KEEPS the value.
 *
 * That last asymmetry is deliberate. An unknown KEY is a column the schema
 * doc and Power BI have never heard of, so dropping it costs nothing that
 * existed. An unexpected VALUE is under a key that a report is already built
 * on, and dropping it would delete what actually happened because the
 * taxonomy is out of date — leaving a breakdown whose buckets no longer add
 * up to the event count, which is a harder thing to notice than one extra
 * bar. Dev throws either way, so a kept value only ever means a value that
 * reached production without anybody running the dev build.
 */
export function assertValidProps(
  name: AnalyticsEventName,
  payload: AnalyticsProps | undefined,
  options: { failFast?: boolean } = {},
): AnalyticsProps | undefined {
  const { allowed, unknown } = splitUnknownProps(name, payload);
  const failFastForValues = options.failFast ?? isDevRuntime();
  const invalidValues = findInvalidPropValues(name, payload);
  if (invalidValues.length > 0) {
    const listed = invalidValues
      .map((v) => `${v.key}="${v.value}" (allowed: ${v.allowed.join(", ")})`)
      .join("; ");
    const detail = `[analytics] event "${name}" received out-of-taxonomy prop value(s): ${listed}`;
    if (failFastForValues) {
      throw new Error(
        `${detail}. Add the value to ANALYTICS_EVENTS[...].values in lib/analytics-events.ts (via lib/analytics-prop-values.ts) or fix the call site.`,
      );
    }
    const warnKey = `${name}:values:${invalidValues.map((v) => `${v.key}=${v.value}`).join(",")}`;
    if (!warnedKeys.has(warnKey)) {
      warnedKeys.add(warnKey);
      console.warn(`${detail} — kept in the captured event.`);
    }
  }
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
