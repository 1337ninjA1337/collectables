import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SERVICE_WORKER_FILENAME,
  build404Html,
  buildServiceWorker,
  injectServiceWorkerRegistration,
  injectSpaRestoreScript,
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
  const patched = injectServiceWorkerRegistration(
    injectSpaRestoreScript(index),
    baseUrl,
  );
  if (patched !== index) {
    fs.writeFileSync(INDEX_HTML, patched);
    console.log(
      "[build-spa-fallback] patched dist/index.html with SPA restore + service-worker registration",
    );
  } else {
    console.log("[build-spa-fallback] dist/index.html already patched — skipping");
  }
  fs.writeFileSync(FALLBACK_HTML, build404Html(baseUrl));
  console.log(`[build-spa-fallback] wrote dist/404.html (baseUrl=${baseUrl})`);

  // Hash the *final* patched shell so the SW cache key changes whenever the
  // deployed bundle changes — a redeploy then evicts the stale fallback shell.
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
