import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SERVICE_WORKER_FILENAME,
  buildServiceWorker,
  injectServiceWorkerRegistration,
} from "../lib/spa-fallback";
import {
  buildContentSecurityPolicy,
  extractInlineScriptBodies,
  injectSecurityMetaTags,
} from "../lib/web-security-headers";
import { renderPrivacyPage } from "../lib/privacy-page";

/** Pre-quoted SHA-256 CSP hash-source for an inline script body. */
function inlineScriptHash(body: string): string {
  const digest = crypto.createHash("sha256").update(body, "utf8").digest("base64");
  return `'sha256-${digest}'`;
}

/**
 * Add the strict CSP + companion security meta tags. Inline-script hashes are
 * derived from the document AFTER the SW-registration script is injected, so
 * every inline script the build emits (Expo bootstrap + our SW registration) is
 * admitted by `script-src`, while an injected/XSS inline script is not.
 */
function injectSecurityHeaders(html: string): string {
  const hashes = extractInlineScriptBodies(html).map(inlineScriptHash);
  const csp = buildContentSecurityPolicy({ scriptHashes: hashes });
  return injectSecurityMetaTags(html, csp);
}

const REPO_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(REPO_ROOT, "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");
const FALLBACK_HTML = path.join(DIST_DIR, "404.html");
const SW_FILE = path.join(DIST_DIR, SERVICE_WORKER_FILENAME);
const APP_JSON = path.join(REPO_ROOT, "app.json");

function readBaseUrlFromAppJson(): string {
  try {
    const raw = fs.readFileSync(APP_JSON, "utf8");
    const parsed = JSON.parse(raw) as {
      expo?: { experiments?: { baseUrl?: string } };
    };
    return parsed.expo?.experiments?.baseUrl ?? "/";
  } catch {
    return "/";
  }
}

function main(): void {
  if (!fs.existsSync(INDEX_HTML)) {
    console.error("[build-spa-fallback] dist/index.html not found — run expo export first");
    process.exit(1);
  }
  const baseUrl = process.env.EXPO_BASE_URL ?? readBaseUrlFromAppJson();
  const index = fs.readFileSync(INDEX_HTML, "utf8");
  // Order matters: inject the SW-registration script FIRST, then hash every
  // inline script (incl. the one just added) into the CSP and inject the
  // security meta tags as the head's first children.
  const patched = injectSecurityHeaders(injectServiceWorkerRegistration(index, baseUrl));
  if (patched !== index) {
    fs.writeFileSync(INDEX_HTML, patched);
    console.log(
      "[build-spa-fallback] patched dist/index.html with service-worker registration + CSP",
    );
  } else {
    console.log("[build-spa-fallback] dist/index.html already patched — skipping");
  }

  // 404.html IS the SPA shell — GitHub Pages serves it for every unresolved
  // dynamic route, the client router then renders the deep link directly.
  // No redirect / sessionStorage / replaceState (that chain is what made iOS
  // Safari reload-loop).
  fs.writeFileSync(FALLBACK_HTML, patched);
  console.log("[build-spa-fallback] wrote dist/404.html (copy of SPA shell)");

  // Hash the final shell so the SW cache key changes whenever the deployed
  // bundle changes — a redeploy then installs a fresh SW + drops stale cache.
  const version = crypto
    .createHash("sha1")
    .update(patched)
    .digest("hex")
    .slice(0, 12);
  fs.writeFileSync(SW_FILE, buildServiceWorker(baseUrl, version));
  console.log(
    `[build-spa-fallback] wrote dist/${SERVICE_WORKER_FILENAME} (version=${version})`,
  );

  // Static privacy-policy page at /privacy — App Store review needs a public
  // URL, and shipping it with every deploy keeps it in lockstep with the
  // tracked PRIVACY.md (drift-guarded by __tests__/privacy-policy.test.ts).
  const privacyMd = path.join(REPO_ROOT, "PRIVACY.md");
  if (fs.existsSync(privacyMd)) {
    const privacyDir = path.join(DIST_DIR, "privacy");
    fs.mkdirSync(privacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(privacyDir, "index.html"),
      renderPrivacyPage(fs.readFileSync(privacyMd, "utf8")),
    );
    console.log("[build-spa-fallback] wrote dist/privacy/index.html (from PRIVACY.md)");
  } else {
    console.error("[build-spa-fallback] PRIVACY.md not found — /privacy page NOT emitted");
    process.exit(1);
  }
}

main();
