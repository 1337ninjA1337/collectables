import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SERVICE_WORKER_FILENAME,
  SPA_SW_REGISTER_MARKER,
  buildServiceWorker,
  injectServiceWorkerRegistration,
  normalizeSpaBaseUrl,
} from "@/lib/spa-fallback";

const repoRoot = path.join(__dirname, "..");

describe("normalizeSpaBaseUrl", () => {
  it("returns '/' for empty input", () => {
    assert.equal(normalizeSpaBaseUrl(""), "/");
    assert.equal(normalizeSpaBaseUrl("/"), "/");
  });

  it("adds a leading slash when missing", () => {
    assert.equal(normalizeSpaBaseUrl("collectables"), "/collectables/");
  });

  it("adds a trailing slash when missing", () => {
    assert.equal(normalizeSpaBaseUrl("/collectables"), "/collectables/");
  });

  it("leaves a fully-normalized base alone", () => {
    assert.equal(normalizeSpaBaseUrl("/collectables/"), "/collectables/");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(normalizeSpaBaseUrl("  /collectables  "), "/collectables/");
  });
});

describe("expo web config (GitHub Pages SPA)", () => {
  it("uses output:single so one route-agnostic shell renders every route", () => {
    const appJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "app.json"), "utf8"),
    ) as { expo: { web?: { output?: string } } };
    assert.equal(
      appJson.expo.web?.output,
      "single",
      "output must be 'single' — 'static' prerenders per-route HTML and dynamic deep links reload-loop",
    );
  });
});

describe("buildServiceWorker", () => {
  const SW = buildServiceWorker("/collectables", "abc123");

  it("scopes the cache key to the version so a redeploy busts stale shells", () => {
    assert.match(SW, /var CACHE = "collectables-spa-abc123";/);
    assert.notEqual(
      buildServiceWorker("/collectables", "abc123"),
      buildServiceWorker("/collectables", "def456"),
    );
  });

  it("uses the normalized base itself as the SPA shell", () => {
    assert.match(SW, /var BASE = "\/collectables\/";/);
    assert.match(SW, /var SHELL = BASE;/);
  });

  it("on a 404 fetches the FRESH shell (never a possibly-stale cache)", () => {
    assert.match(SW, /res\.status === 404/);
    assert.match(SW, /function freshShell\(\)/);
    assert.match(SW, /fetch\(new Request\(SHELL, \{ cache: "reload" \}\)\)/);
  });

  it("only intercepts same-origin GET navigations under the base", () => {
    assert.match(SW, /req\.method !== "GET"/);
    assert.match(SW, /req\.mode !== "navigate"/);
    assert.match(SW, /url\.origin !== self\.location\.origin/);
    assert.match(SW, /url\.pathname\.indexOf\(BASE\) !== 0/);
  });

  it("is network-first (only falls back to cache when offline)", () => {
    assert.match(SW, /fetch\(req\)\.then/);
    assert.match(SW, /\.catch\(function \(\) \{\s*return caches\.match\(SHELL\)/);
  });

  it("activates immediately and evicts old caches", () => {
    assert.match(SW, /self\.skipWaiting\(\)/);
    assert.match(SW, /self\.clients\.claim\(\)/);
    assert.match(SW, /caches\.delete\(k\)/);
  });

  it("refreshes the cached shell when the base itself loads 200", () => {
    assert.match(SW, /res\.ok && url\.pathname === BASE/);
    assert.match(SW, /cache\.put\(SHELL, copy\)/);
  });
});

describe("injectServiceWorkerRegistration", () => {
  const html = "<html><head><title>x</title></head><body></body></html>";

  it("registers sw.js at the base scope on load", () => {
    const out = injectServiceWorkerRegistration(html, "/collectables");
    assert.match(out, new RegExp(SPA_SW_REGISTER_MARKER));
    assert.match(
      out,
      /navigator\.serviceWorker\.register\("\/collectables\/sw\.js", \{ scope: "\/collectables\/" \}\)/,
    );
    assert.match(out, /window\.addEventListener\("load"/);
  });

  it("is idempotent — re-running does not double-inject", () => {
    const once = injectServiceWorkerRegistration(html, "/collectables");
    const twice = injectServiceWorkerRegistration(once, "/collectables");
    assert.equal(once, twice);
    assert.equal(
      twice.split(SPA_SW_REGISTER_MARKER).length - 1,
      1,
      "registration script must appear exactly once",
    );
  });

  it("guards on serviceWorker support and a secure context", () => {
    const out = injectServiceWorkerRegistration(html, "/collectables");
    assert.match(out, /"serviceWorker" in navigator/);
    assert.match(out, /location\.protocol === "https:"/);
    assert.match(out, /=== "localhost"/);
  });

  it("injects before </head> when present, else prepends", () => {
    const withHead = injectServiceWorkerRegistration(html, "/collectables");
    assert.ok(
      withHead.indexOf(SPA_SW_REGISTER_MARKER) < withHead.indexOf("</head>"),
    );
    const noHead = injectServiceWorkerRegistration("<body>hi</body>", "/collectables");
    assert.ok(noHead.startsWith("<script"));
  });

  it("uses the exported service-worker filename constant", () => {
    assert.equal(SERVICE_WORKER_FILENAME, "sw.js");
  });
});

describe("build-spa-fallback script wiring", () => {
  const scriptPath = path.join(repoRoot, "scripts", "build-spa-fallback.ts");
  const source = fs.readFileSync(scriptPath, "utf8");

  it("ships scripts/build-spa-fallback.ts", () => {
    assert.ok(fs.existsSync(scriptPath), "scripts/build-spa-fallback.ts must exist");
  });

  it("reads baseUrl from app.json (overridable via EXPO_BASE_URL)", () => {
    assert.match(source, /app\.json/);
    assert.match(source, /expo\?\.experiments\?\.baseUrl/);
    assert.match(source, /process\.env\.EXPO_BASE_URL/);
  });

  it("imports the SW helpers (no redirect/restore machinery anymore)", () => {
    assert.match(source, /buildServiceWorker/);
    assert.match(source, /injectServiceWorkerRegistration/);
    assert.match(source, /lib\/spa-fallback/);
    assert.doesNotMatch(source, /build404Html/);
    assert.doesNotMatch(source, /injectSpaRestoreScript/);
  });

  it("writes dist/404.html as a copy of the patched SPA shell", () => {
    assert.match(source, /FALLBACK_HTML\s*=\s*path\.join\(DIST_DIR, "404\.html"\)/);
    assert.match(source, /writeFileSync\(FALLBACK_HTML, patched\)/);
  });

  it("derives the SW cache key from a hash of the patched shell", () => {
    assert.match(source, /createHash\(\s*["']sha1["']\s*\)/);
    assert.match(source, /\.update\(patched\)/);
  });

  it("lib/spa-fallback no longer exports the redirect/restore API", () => {
    const lib = fs.readFileSync(
      path.join(repoRoot, "lib", "spa-fallback.ts"),
      "utf8",
    );
    assert.doesNotMatch(lib, /export function build404Html/);
    assert.doesNotMatch(lib, /export function injectSpaRestoreScript/);
  });

  it("package.json build + deploy invoke the helper instead of `cp`", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.match(pkg.scripts.build, /tsx scripts\/build-spa-fallback\.ts/);
    assert.match(pkg.scripts.deploy, /tsx scripts\/build-spa-fallback\.ts/);
    assert.doesNotMatch(pkg.scripts.build, /cp dist\/index\.html dist\/404\.html/);
    assert.doesNotMatch(pkg.scripts.deploy, /cp dist\/index\.html dist\/404\.html/);
  });

  it("deploy.yml runs the post-build helper instead of `cp`", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github", "workflows", "deploy.yml"),
      "utf8",
    );
    assert.match(workflow, /scripts\/build-spa-fallback\.ts/);
    assert.doesNotMatch(workflow, /cp dist\/index\.html dist\/404\.html/);
  });
});
