import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  SPA_REDIRECT_STORAGE_KEY,
  SPA_RESTORE_SCRIPT_MARKER,
  build404Html,
  injectSpaRestoreScript,
  normalizeSpaBaseUrl,
} from "@/lib/spa-fallback";

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

describe("build404Html", () => {
  it("renders a location.replace to the normalized baseUrl", () => {
    const html = build404Html("/collectables");
    assert.match(html, /location\.replace\("\/collectables\/"\)/);
  });

  it("stores the original pathname under the canonical sessionStorage key", () => {
    const html = build404Html("/collectables");
    assert.ok(
      html.includes(`sessionStorage.setItem("${SPA_REDIRECT_STORAGE_KEY}"`),
      "html should reference the canonical storage key",
    );
    assert.match(html, /location\.pathname \+ location\.search \+ location\.hash/);
  });

  it("includes a meta-refresh fallback for JS-disabled clients", () => {
    const html = build404Html("/collectables");
    assert.match(html, /<meta http-equiv="refresh" content="0; url=\/collectables\/">/);
  });

  it("wraps the redirect in try/catch so a storage exception still redirects", () => {
    const html = build404Html("/collectables");
    const tryIdx = html.indexOf("try");
    const replaceIdx = html.indexOf("location.replace");
    assert.ok(tryIdx >= 0 && replaceIdx > tryIdx, "redirect must follow the try/catch");
  });

  it("handles a root baseUrl ('/')", () => {
    const html = build404Html("/");
    assert.match(html, /location\.replace\("\/"\)/);
    assert.match(html, /<meta http-equiv="refresh" content="0; url=\/">/);
  });

  it("emits valid utf-8 HTML5 doctype and charset", () => {
    const html = build404Html("/collectables");
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.match(html, /<meta charset="utf-8">/);
  });
});

describe("injectSpaRestoreScript", () => {
  const baseHtml =
    '<!DOCTYPE html><html><head><title>x</title></head><body><div id="root"></div></body></html>';

  it("inserts the restore script before </head>", () => {
    const patched = injectSpaRestoreScript(baseHtml);
    assert.notEqual(patched, baseHtml);
    assert.ok(patched.includes(SPA_RESTORE_SCRIPT_MARKER));
    assert.ok(
      patched.indexOf(SPA_RESTORE_SCRIPT_MARKER) < patched.indexOf("</head>"),
      "script must appear before </head>",
    );
  });

  it("reads from the canonical sessionStorage key and clears it after restore", () => {
    const patched = injectSpaRestoreScript(baseHtml);
    assert.ok(patched.includes(`sessionStorage.getItem(key)`));
    assert.ok(patched.includes(`sessionStorage.removeItem(key)`));
    assert.ok(patched.includes(`"${SPA_REDIRECT_STORAGE_KEY}"`));
  });

  it("calls history.replaceState only when stored path differs from current URL", () => {
    const patched = injectSpaRestoreScript(baseHtml);
    assert.match(patched, /redirect !== current/);
    assert.match(patched, /history\.replaceState/);
  });

  it("guards against absolute external URLs (only restores paths starting with '/')", () => {
    const patched = injectSpaRestoreScript(baseHtml);
    assert.match(patched, /redirect\.charAt\(0\) === "\/"/);
  });

  it("is idempotent — applying twice is a no-op", () => {
    const once = injectSpaRestoreScript(baseHtml);
    const twice = injectSpaRestoreScript(once);
    assert.equal(once, twice);
  });

  it("falls back to prepending when </head> is missing", () => {
    const noHead = "<html><body></body></html>";
    const patched = injectSpaRestoreScript(noHead);
    assert.ok(patched.startsWith("<script"));
    assert.ok(patched.includes(SPA_RESTORE_SCRIPT_MARKER));
    assert.ok(patched.endsWith(noHead));
  });

  it("wraps the body in a try/catch so a broken sessionStorage can never crash the SPA boot", () => {
    const patched = injectSpaRestoreScript(baseHtml);
    const tryIdx = patched.indexOf("try");
    const catchIdx = patched.indexOf("catch (e)");
    assert.ok(tryIdx >= 0 && catchIdx > tryIdx);
  });
});

describe("build-spa-fallback script wiring", () => {
  const repoRoot = path.join(__dirname, "..");

  it("ships scripts/build-spa-fallback.ts", () => {
    const scriptPath = path.join(repoRoot, "scripts", "build-spa-fallback.ts");
    assert.ok(fs.existsSync(scriptPath), "scripts/build-spa-fallback.ts must exist");
  });

  it("reads baseUrl from app.json so the redirect target matches the deployed prefix", () => {
    const scriptPath = path.join(repoRoot, "scripts", "build-spa-fallback.ts");
    const source = fs.readFileSync(scriptPath, "utf8");
    assert.match(source, /app\.json/);
    assert.match(source, /expo\?\.experiments\?\.baseUrl/);
    assert.match(source, /process\.env\.EXPO_BASE_URL/);
  });

  it("imports build404Html + injectSpaRestoreScript from lib/spa-fallback", () => {
    const scriptPath = path.join(repoRoot, "scripts", "build-spa-fallback.ts");
    const source = fs.readFileSync(scriptPath, "utf8");
    assert.match(source, /build404Html/);
    assert.match(source, /injectSpaRestoreScript/);
    assert.match(source, /lib\/spa-fallback/);
  });

  it("package.json build + deploy scripts invoke the post-build helper instead of `cp`", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.match(pkg.scripts.build, /tsx scripts\/build-spa-fallback\.ts/);
    assert.match(pkg.scripts.deploy, /tsx scripts\/build-spa-fallback\.ts/);
    assert.doesNotMatch(pkg.scripts.build, /cp dist\/index\.html dist\/404\.html/);
    assert.doesNotMatch(pkg.scripts.deploy, /cp dist\/index\.html dist\/404\.html/);
  });

  it("deploy.yml runs the post-build helper instead of `cp`", () => {
    const workflowPath = path.join(repoRoot, ".github", "workflows", "deploy.yml");
    const source = fs.readFileSync(workflowPath, "utf8");
    assert.match(source, /scripts\/build-spa-fallback\.ts/);
    assert.doesNotMatch(source, /cp dist\/index\.html dist\/404\.html/);
  });
});
