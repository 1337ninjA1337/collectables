/**
 * Logging hygiene (SEC-20).
 *
 * Two failure modes this module closes:
 *  1. Noisy *debug* logs (full request/response bodies, raw rows) reaching a
 *     shipped production bundle, where they dump user PII — item names, notes,
 *     tags, photo URLs — into the browser console / device logs.
 *  2. A payload that legitimately must be logged on a genuine failure carrying
 *     a token / key / PII field in the clear.
 *
 * The fix is a single app-wide `devLog` whose `debug` channel is a **no-op in
 * production** (`__DEV__` false) and which **redacts** any sensitive-shaped
 * object key before it is printed even in development. The redaction taxonomy
 * is reused from the SEC-13 telemetry guard (`isPiiPropKey`) so the deny-list
 * stays a single source of truth, extended here with the credential tokens a
 * log payload can carry that an analytics prop key never would.
 *
 * Pure on purpose: the only import beyond the PII taxonomy is the dependency-
 * free `isDevEnvironment` (`typeof __DEV__`), so the node test runner consumes
 * this module without a Metro / react-native shim.
 */
import { isPiiPropKey, tokenizePropKey } from "./analytics-pii";
import { isDevEnvironment } from "./dev-menu";

export const REDACTED = "[redacted]";

/**
 * Credential / session word-tokens that a *log payload* can carry but an
 * analytics prop key (the `isPiiPropKey` domain) would not — so they live here
 * rather than widening the telemetry deny-list. Combined with `isPiiPropKey`
 * (which already covers `token`/`secret`/`apikey`/`password`/`credential`)
 * these catch `authorization`, `accessKey`, `cookie`, a bearer `jwt`, etc.
 */
export const SECRET_LOG_TOKENS: readonly string[] = Object.freeze([
  "authorization",
  "auth",
  "bearer",
  "key",
  "jwt",
  "cookie",
  "session",
  "signature",
  "otp",
]);

const SECRET_TOKEN_SET = new Set(SECRET_LOG_TOKENS);

/**
 * True when an object key names a credential or PII field that must not be
 * printed in the clear. Unions the SEC-13 PII rule with the credential tokens
 * above.
 */
export function isSensitiveLogKey(key: string): boolean {
  if (isPiiPropKey(key)) return true;
  return tokenizePropKey(key).some((token) => SECRET_TOKEN_SET.has(token));
}

/**
 * Deep-copies `value`, replacing the value of any sensitive-shaped key with
 * `[redacted]`. Arrays are walked element-wise; primitives pass through. A
 * depth cap (and the structural copy) make it safe against deep or cyclic
 * payloads.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth >= 8) return REDACTED;
  if (Array.isArray(value)) {
    return value.map((entry) => redactForLog(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    // Leave non-plain objects (Error, etc.) untouched — they carry stack/
    // message diagnostics, not structured user payloads.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveLogKey(k) ? REDACTED : redactForLog(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface DevLogger {
  /** Forwards to the console only in a dev build; redacts object args. */
  debug(...args: unknown[]): void;
}

/**
 * Builds a logger whose `debug` channel is a no-op unless `isDev` is true. When
 * active, every object argument is redacted via `redactForLog` first so even a
 * developer console never shows a token / item name in the clear.
 */
export function createDevLogger(
  isDev: boolean,
  sink: Pick<Console, "log"> = console,
): DevLogger {
  if (!isDev) return { debug() {} };
  return {
    debug(...args: unknown[]) {
      sink.log(
        ...args.map((arg) =>
          arg && typeof arg === "object" ? redactForLog(arg) : arg,
        ),
      );
    },
  };
}

/**
 * App-wide debug logger. Resolves `__DEV__` once at module load, so production
 * web/native bundles get the no-op implementation and the dead `sink.log` call
 * is tree-shaken away.
 */
export const devLog: DevLogger = createDevLogger(isDevEnvironment());
