// Web Content-Security-Policy + companion security meta tags for the
// GitHub-Pages SPA build. Pure module — no `react-native`/DOM/`node` imports —
// so it can be unit-tested from plain Node and reused by the build script.
//
// Why meta tags (not HTTP headers): GitHub Pages is a static host and does not
// let us set response headers, so the only place we can ship a CSP for the web
// build is an in-document `<meta http-equiv>`. Caveats of meta-delivered CSP:
// `frame-ancestors`/`sandbox`/`report-uri` are ignored by the spec (left out),
// and `X-Content-Type-Options` is only truly enforced as a real header — the
// meta is best-effort/documentary. Everything else (default/script/style/img/
// connect/font/object/base-uri) IS enforced from a meta tag.
//
// The policy is intentionally strict: `script-src 'self'` (no `'unsafe-inline'`
// / `'unsafe-eval'`) with explicit SHA-256 hashes for the few inline scripts the
// build actually emits (Expo's bootstrap + our SW registration), so an injected
// XSS `<script>` cannot run. `connect-src` is allow-listed to exactly the
// backends the app talks to (Supabase REST+realtime, Cloudinary, PostHog,
// Clarity, Sentry); anything else is blocked.

/** Cloudinary image-delivery + API hosts. */
export const CLOUDINARY_API_HOST = "https://api.cloudinary.com";
export const CLOUDINARY_CDN_HOST = "https://res.cloudinary.com";
/** Microsoft Clarity loads its tag from this exact origin (see lib/clarity.ts). */
export const CLARITY_SCRIPT_HOST = "https://www.clarity.ms";

/**
 * `connect-src` allow-list (fetch / XHR / WebSocket targets). Wildcarded per
 * vendor so the policy survives a project/region change without a redeploy of
 * the CSP itself:
 * - Supabase REST (`https`) + realtime (`wss`) on `*.supabase.co`
 * - Cloudinary upload API + CDN
 * - PostHog ingest (`*.posthog.com`)
 * - Microsoft Clarity ingest (`*.clarity.ms` + the `c.bing.com` beacon)
 * - Sentry ingest (`*.sentry.io`)
 */
export const CSP_CONNECT_SRC: readonly string[] = [
  "'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
  CLOUDINARY_API_HOST,
  CLOUDINARY_CDN_HOST,
  "https://*.posthog.com",
  "https://*.clarity.ms",
  "https://c.bing.com",
  "https://*.sentry.io",
];

/** `img-src` — local assets, inline data/blob previews, Cloudinary delivery. */
export const CSP_IMG_SRC: readonly string[] = [
  "'self'",
  "data:",
  "blob:",
  CLOUDINARY_CDN_HOST,
  "https://*.cloudinary.com",
];

/**
 * Extra `script-src` hosts beyond `'self'` + inline hashes. Only Clarity, which
 * injects a cross-origin `<script src="https://www.clarity.ms/tag/…">`. Empty
 * when no third-party script loader is in play.
 */
export const CSP_SCRIPT_EXTRA_HOSTS: readonly string[] = [CLARITY_SCRIPT_HOST];

export type CspOptions = {
  /**
   * Pre-quoted CSP hash-source tokens for the inline scripts in the document,
   * e.g. `"'sha256-abc…='"`. Without these a strict `script-src 'self'` would
   * block our inline SW-registration / Expo bootstrap scripts.
   */
  scriptHashes?: readonly string[];
  /** Additional `connect-src` entries (e.g. a custom Supabase domain). */
  extraConnectSrc?: readonly string[];
  /** Additional `img-src` entries. */
  extraImgSrc?: readonly string[];
};

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((v) => v && v.trim().length > 0)));
}

/**
 * Build the `Content-Security-Policy` value (the string that goes in the meta
 * tag's `content`). Deterministic and order-stable so the SW cache hash only
 * changes when the policy actually changes.
 */
export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const scriptSrc = dedupe([
    "'self'",
    ...(options.scriptHashes ?? []),
    ...CSP_SCRIPT_EXTRA_HOSTS,
  ]);
  const connectSrc = dedupe([...CSP_CONNECT_SRC, ...(options.extraConnectSrc ?? [])]);
  const imgSrc = dedupe([...CSP_IMG_SRC, ...(options.extraImgSrc ?? [])]);

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["form-action", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["worker-src", ["'self'"]],
    ["script-src", scriptSrc],
    // React Native Web injects styles at runtime as inline <style>/style="…",
    // so 'unsafe-inline' is unavoidable here. CSS cannot exfiltrate or execute.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", imgSrc],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connectSrc],
  ];

  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export const CSP_META_MARKER = 'http-equiv="Content-Security-Policy"';

/**
 * The three security meta tags: CSP, a privacy-preserving Referrer-Policy, and
 * the best-effort `X-Content-Type-Options: nosniff`.
 */
export function buildSecurityMetaTags(csp: string): string {
  return [
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<meta name="referrer" content="strict-origin-when-cross-origin">`,
    `<meta http-equiv="X-Content-Type-Options" content="nosniff">`,
  ].join("\n");
}

/**
 * Extract the bodies of every INLINE `<script>` (no `src=` attribute) in the
 * document, in source order. The build script hashes these into `script-src`
 * so the strict policy admits exactly the scripts the build emits — and nothing
 * an attacker injects. `src=`-bearing (external) scripts are skipped: they're
 * covered by host allow-listing (`'self'` / Clarity), not hashes.
 */
export function extractInlineScriptBodies(html: string): string[] {
  const bodies: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue; // external script — host-allow-listed
    bodies.push(m[2] ?? "");
  }
  return bodies;
}

/**
 * Inject the security meta tags as the first children of `<head>` so the CSP
 * governs every script/style/connect that follows it in the document. Idempotent
 * (a document that already carries a CSP meta is returned unchanged). Falls back
 * to prepending when there is no `<head>`.
 */
export function injectSecurityMetaTags(html: string, csp: string): string {
  if (html.includes(CSP_META_MARKER)) return html;
  const tags = buildSecurityMetaTags(csp);
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen && headOpen.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return html.slice(0, insertAt) + "\n" + tags + html.slice(insertAt);
  }
  return tags + html;
}
