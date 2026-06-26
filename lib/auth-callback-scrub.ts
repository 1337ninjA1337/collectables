/**
 * SEC-7 — OAuth callback token hygiene.
 *
 * After a magic-link / OAuth redirect, Supabase delivers the credentials in
 * the URL itself: the implicit-flow tokens land in the hash fragment
 * (`#access_token=…&refresh_token=…`) and the PKCE / OTP flows in the query
 * string (`?code=…`, `?token_hash=…`). Those values are a full session.
 *
 * If we navigate away (`router.replace`) without rewriting the address bar,
 * the token-bearing URL lingers in:
 *   - browser history (back button replays it),
 *   - the `Referer` header on the next outbound request,
 *   - anything that reads `window.location` (extensions, analytics, embeds).
 *
 * So before navigating we rewrite the current history entry with the
 * sensitive params stripped via `history.replaceState` — the hash/query
 * tokens never persist past the moment the session is established.
 *
 * Pure + DOM-injectable so it is unit-testable under plain Node without
 * pulling the react-native bundle.
 */

/** Hash-fragment params the implicit OAuth/magic-link flow carries. */
const SENSITIVE_HASH_PARAMS = [
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "type",
  "error",
  "error_code",
  "error_description",
];

/** Query-string params the PKCE / OTP / email flows carry. */
const SENSITIVE_QUERY_PARAMS = [
  "code",
  "token_hash",
  "token",
  "type",
  "error",
  "error_code",
  "error_description",
];

/**
 * Return `href` with every credential-bearing hash + query param removed.
 * A malformed URL is returned unchanged (nothing to safely strip).
 */
export function stripAuthParamsFromHref(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }

  for (const key of SENSITIVE_QUERY_PARAMS) {
    url.searchParams.delete(key);
  }

  const rawHash = url.hash.replace(/^#/, "");
  if (rawHash) {
    const hashParams = new URLSearchParams(rawHash);
    for (const key of SENSITIVE_HASH_PARAMS) {
      hashParams.delete(key);
    }
    const remaining = hashParams.toString();
    url.hash = remaining ? `#${remaining}` : "";
  }

  return url.toString();
}

type HistoryLike = {
  replaceState: (data: unknown, unused: string, url?: string | null) => void;
  state?: unknown;
};

type WindowLike = {
  location?: { href?: string } | null;
  history?: HistoryLike | null;
};

/**
 * Rewrite the current history entry of `win` with the auth tokens stripped
 * from its URL. No-op (returns `false`) when there is nothing to strip or the
 * environment lacks `history.replaceState` (native / SSR). Returns `true`
 * when the address bar was actually scrubbed.
 */
export function scrubAuthParamsFromLocation(win: WindowLike | undefined): boolean {
  const href = win?.location?.href;
  const history = win?.history;
  if (!href || !history || typeof history.replaceState !== "function") {
    return false;
  }

  const cleaned = stripAuthParamsFromHref(href);
  if (cleaned === href) {
    return false;
  }

  history.replaceState(history.state ?? null, "", cleaned);
  return true;
}
