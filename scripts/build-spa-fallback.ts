import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SERVICE_WORKER_FILENAME,
  buildServiceWorker,
  injectServiceWorkerRegistration,
} from "../lib/spa-fallback";

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
  const patched = injectServiceWorkerRegistration(index, baseUrl);
  if (patched !== index) {
    fs.writeFileSync(INDEX_HTML, patched);
    console.log(
      "[build-spa-fallback] patched dist/index.html with service-worker registration",
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
}

main();
