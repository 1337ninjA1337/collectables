import * as fs from "node:fs";
import * as path from "node:path";

import { build404Html, injectSpaRestoreScript } from "../lib/spa-fallback";

const REPO_ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(REPO_ROOT, "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");
const FALLBACK_HTML = path.join(DIST_DIR, "404.html");
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
  const patched = injectSpaRestoreScript(index);
  if (patched !== index) {
    fs.writeFileSync(INDEX_HTML, patched);
    console.log("[build-spa-fallback] patched dist/index.html with SPA URL restore script");
  } else {
    console.log("[build-spa-fallback] dist/index.html already contains restore script — skipping");
  }
  fs.writeFileSync(FALLBACK_HTML, build404Html(baseUrl));
  console.log(`[build-spa-fallback] wrote dist/404.html (baseUrl=${baseUrl})`);
}

main();
