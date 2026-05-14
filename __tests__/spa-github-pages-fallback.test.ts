import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRedirectScript,
  injectRestoreScript,
  buildSpaFallback,
  RESTORE_MARKER,
} from "../scripts/build-spa-fallback";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "deploy.yml"),
  "utf8",
);
const packageJson = readFileSync(
  path.join(process.cwd(), "package.json"),
  "utf8",
);

function makeDist(indexHtml: string): string {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "spa-fallback-"));
  const distDir = path.join(tmpDir, "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(path.join(distDir, "index.html"), indexHtml, "utf8");
  return distDir;
}

describe("buildRedirectScript — 404.html template", () => {
  const html = buildRedirectScript("/collectables");

  it("declares an HTML5 doctype", () => {
    assert.match(html, /^<!doctype html>/i);
  });

  it("counts the leading base-URL segments so the redirect preserves them", () => {
    // /collectables has 1 leading segment; root deploys would be 0.
    assert.match(html, /pathSegmentsToKeep\s*=\s*1\b/);
  });

  it("uses location.replace so the failed 404 entry does not stay in history", () => {
    assert.match(html, /l\.replace\(/);
  });

  it("rewrites the request path into the ?/ single-query-string convention", () => {
    assert.match(html, /\+\s*"\/\?\/"/);
  });

  it("encodes ampersands as ~and~ so query strings round-trip safely", () => {
    assert.match(html, /~and~/);
    assert.match(html, /replace\(\/&\/g,\s*"~and~"\)/);
  });

  it("falls back to 0 leading segments when baseUrl is empty (user/org root)", () => {
    const rootHtml = buildRedirectScript("");
    assert.match(rootHtml, /pathSegmentsToKeep\s*=\s*0\b/);
  });

  it("keeps the page minimal so iOS Safari does not hit the repeated-error guard", () => {
    // Heuristic: the redirect page should be tiny (under 2 KB) so it runs
    // before Safari counts the 404 status against its retry threshold.
    assert.ok(html.length < 2048, `redirect HTML is ${html.length} bytes`);
  });
});

describe("injectRestoreScript — index.html patch", () => {
  it("injects a script tagged with the canonical marker before </head>", () => {
    const patched = injectRestoreScript("<html><head><title>x</title></head><body></body></html>");
    assert.match(patched, new RegExp(`<script id="${RESTORE_MARKER}">`));
    assert.ok(patched.indexOf(RESTORE_MARKER) < patched.indexOf("</head>"));
  });

  it("is idempotent — re-injecting does not duplicate the script", () => {
    const once = injectRestoreScript("<html><head></head><body></body></html>");
    const twice = injectRestoreScript(once);
    const matches = twice.match(new RegExp(RESTORE_MARKER, "g")) ?? [];
    assert.equal(matches.length, 1);
  });

  it("falls back to <body> when there is no </head> (defensive)", () => {
    const patched = injectRestoreScript("<html><body>x</body></html>");
    assert.match(patched, new RegExp(`<body[^>]*><script id="${RESTORE_MARKER}">`));
  });

  it("uses history.replaceState so the bundle sees the original deep-link path", () => {
    const patched = injectRestoreScript("<html><head></head><body></body></html>");
    assert.match(patched, /window\.history\.replaceState/);
  });

  it("decodes ~and~ back into & to mirror the redirector's encoding", () => {
    const patched = injectRestoreScript("<html><head></head><body></body></html>");
    assert.match(patched, /replace\(\/~and~\/g,\s*"&"\)/);
  });

  it("guards on l.search starting with ?/ or containing &/ before touching history", () => {
    const patched = injectRestoreScript("<html><head></head><body></body></html>");
    assert.match(patched, /search\.indexOf\("\?\/"\)\s*===\s*0/);
    assert.match(patched, /search\.indexOf\("&\/"\)\s*!==\s*-1/);
  });
});

describe("buildSpaFallback — end-to-end on a temp dist directory", () => {
  it("writes both 404.html (redirector) and patched index.html into dist/", () => {
    const distDir = makeDist(
      "<!doctype html><html><head><meta charset=utf-8></head><body><div id=root></div></body></html>",
    );
    buildSpaFallback(distDir);
    const indexHtml = readFileSync(path.join(distDir, "index.html"), "utf8");
    const fallback = readFileSync(path.join(distDir, "404.html"), "utf8");
    assert.match(indexHtml, new RegExp(RESTORE_MARKER));
    assert.match(fallback, /pathSegmentsToKeep/);
  });

  it("preserves the existing <head> content of index.html when patching", () => {
    const distDir = makeDist(
      "<!doctype html><html><head><title>Collectables</title></head><body></body></html>",
    );
    buildSpaFallback(distDir);
    const indexHtml = readFileSync(path.join(distDir, "index.html"), "utf8");
    assert.match(indexHtml, /<title>Collectables<\/title>/);
  });
});

describe("Deploy workflow + package.json wiring", () => {
  it("deploy workflow runs the SPA fallback script instead of cp", () => {
    assert.match(workflow, /node scripts\/build-spa-fallback\.js/);
    assert.doesNotMatch(workflow, /cp dist\/index\.html dist\/404\.html/);
  });

  it("package.json build script invokes the SPA fallback builder", () => {
    assert.match(packageJson, /node scripts\/build-spa-fallback\.js/);
  });

  it("package.json deploy script invokes the SPA fallback builder", () => {
    const parsed = JSON.parse(packageJson) as { scripts: Record<string, string> };
    assert.match(parsed.scripts.deploy, /node scripts\/build-spa-fallback\.js/);
    assert.doesNotMatch(parsed.scripts.deploy, /cp dist\/index\.html dist\/404\.html/);
  });
});
