/**
 * SEC-10 — centralised CORS for every Edge Function.
 *
 * Before this module each function shipped its own inline `corsHeaders` with
 * `Access-Control-Allow-Origin: "*"`. A wildcard means *any* website can drive
 * a victim's browser to call our authenticated functions and read the JSON
 * response — the browser's same-origin protection is exactly what
 * `Allow-Origin: *` switches off. The privileged functions are gated by a
 * bearer token (SEC-9), so a wildcard is not an immediate auth bypass, but it
 * needlessly widens the attack surface (CSRF-style probing, token replay from a
 * malicious tab) and drifts the six+ copies apart over time.
 *
 * This is the single place the policy lives. `Access-Control-Allow-Origin` is
 * reflected back ONLY for an allow-listed origin (the GitHub Pages web build and
 * the `collectables://` deep-link), and a browser request from any other origin
 * is rejected outright with 403. Requests with no `Origin` header at all
 * (native app fetches, server-to-server webhooks, curl) are not browser CORS
 * requests, so they pass through unchanged.
 *
 * The module is PURE — it uses only the Fetch `Request`/`Response` globals
 * available in both Deno and Node ≥18 — so the policy is unit-testable in Node
 * while the Deno functions import it with the `.ts` extension.
 */

/** The GitHub Pages origin the web build is deployed to (scheme+host only). */
export const GITHUB_PAGES_ORIGIN = "https://1337ninja1337.github.io";

/** The custom-scheme deep link used by the native app's OAuth redirect. */
export const DEEP_LINK_ORIGIN = "collectables://";

/** Header value listing the request headers the browser may send. */
const DEFAULT_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";

/** Methods every function accepts (all are POST + the OPTIONS preflight). */
const ALLOW_METHODS = "POST, OPTIONS";

export type CorsOptions = {
  /**
   * Raw `ALLOWED_ORIGINS` Edge Function secret — a comma-separated list of
   * extra origins (e.g. a custom domain or `http://localhost:8081` for local
   * dev). Merged with the built-in defaults; blank/undefined adds nothing.
   */
  allowedOriginsEnv?: string | null;
  /**
   * Extra request-header names to append to `Access-Control-Allow-Headers`
   * (e.g. analytics-mirror's `x-posthog-webhook-secret`).
   */
  extraAllowHeaders?: string[];
};

/**
 * The effective allow-list: the GitHub Pages origin + the deep-link, plus any
 * origins configured via the `ALLOWED_ORIGINS` secret. De-duplicated.
 */
export function getAllowedOrigins(allowedOriginsEnv?: string | null): string[] {
  const extra = (allowedOriginsEnv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([GITHUB_PAGES_ORIGIN, DEEP_LINK_ORIGIN, ...extra]));
}

/**
 * True when the request may proceed. A missing `Origin` (non-browser caller) is
 * allowed; a present `Origin` must be in the allow-list.
 */
export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}

export type CorsDecision = {
  /** Whether the request is permitted (origin absent or allow-listed). */
  allowed: boolean;
  /** The request's `Origin` header (null when absent). */
  origin: string | null;
  /** Response headers to spread onto every reply (incl. error replies). */
  headers: Record<string, string>;
};

/**
 * Evaluate the request's `Origin` against the allow-list and build the CORS
 * response headers.
 *
 *   - allowed + origin present → `Access-Control-Allow-Origin: <that origin>`;
 *   - allowed + no origin (native/server) → falls back to the GitHub Pages
 *     origin (harmless; non-browser callers ignore it);
 *   - disallowed → `allowed: false`, and NO `Access-Control-Allow-Origin` is
 *     set, so even if the function answered the browser would block the read.
 *
 * `Vary: Origin` is always set so caches never serve one origin's CORS headers
 * to another.
 */
export function evaluateCors(req: Request, options: CorsOptions = {}): CorsDecision {
  const origin = req.headers.get("Origin");
  const allowed = getAllowedOrigins(options.allowedOriginsEnv);
  const isAllowed = isOriginAllowed(origin, allowed);

  const allowHeaders = [DEFAULT_ALLOW_HEADERS, ...(options.extraAllowHeaders ?? [])]
    .filter(Boolean)
    .join(", ");

  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    Vary: "Origin",
  };
  if (isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin ?? GITHUB_PAGES_ORIGIN;
  }

  return { allowed: isAllowed, origin, headers };
}

/** The 403 returned verbatim when a browser request's origin is not allowed. */
export function forbiddenOriginResponse(headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "origin not allowed" }), {
    status: 403,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
