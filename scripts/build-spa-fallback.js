#!/usr/bin/env node
/*
 * Builds the GitHub-Pages SPA fallback pair (rafgraph/spa-github-pages):
 *   1. dist/404.html — minimal redirector that encodes the requested path
 *      into a single-query-string parameter and rewrites the URL to
 *      `<baseUrl>/?/<segments>`. GitHub Pages serves index.html for that root
 *      URL with a 200 status, so iOS Safari's "problem repeatedly occurred"
 *      guard never fires.
 *   2. dist/index.html — patched with a tiny head-script that decodes the
 *      `/?/<segments>` query back into a real URL via history.replaceState
 *      before the Expo Router bundle boots, so the SPA routes as if the deep
 *      link had been served directly.
 *
 * Idempotent: re-running the script will not double-inject the restorer.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DIST = path.join(__dirname, "..", "dist");
const RESTORE_MARKER = "__collectables_spa_path_restore__";

function buildRedirectScript(baseUrl) {
  // Number of leading path segments that belong to the project base (e.g. for
  // `/collectables` it's 1). 0 means GitHub Pages served from a user/org root.
  const segmentCount = baseUrl.split("/").filter(Boolean).length;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Redirecting…</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <script>
      // rafgraph/spa-github-pages style redirect. Encodes the requested path
      // into a single query parameter and rewrites the URL to <baseUrl>/?/...
      // so GitHub Pages serves index.html (200 OK) instead of 404.
      (function () {
        var pathSegmentsToKeep = ${segmentCount};
        var l = window.location;
        var base = l.pathname.split("/").slice(0, 1 + pathSegmentsToKeep).join("/");
        l.replace(
          l.protocol + "//" + l.hostname + (l.port ? ":" + l.port : "") +
          base + "/?/" +
          l.pathname.slice(1).split("/").slice(pathSegmentsToKeep).join("/").replace(/&/g, "~and~") +
          (l.search ? "&" + l.search.slice(1).replace(/&/g, "~and~") : "") +
          l.hash
        );
      })();
    </script>
  </head>
  <body></body>
</html>
`;
}

const RESTORE_SCRIPT = `<script id="${RESTORE_MARKER}">
  // Decodes the single-query-string path written by 404.html back into a real
  // URL via history.replaceState so expo-router sees the original deep link.
  (function () {
    if (window.location.search.indexOf("?/") === 0 || window.location.search.indexOf("&/") !== -1) {
      var l = window.location;
      var decoded = l.search.slice(1).split("&").map(function (s) {
        return s.replace(/~and~/g, "&");
      });
      var route = decoded.shift();
      if (route && route.charAt(0) === "/") {
        var query = decoded.length ? "?" + decoded.join("&") : "";
        window.history.replaceState(null, "", l.pathname.replace(/\\/$/, "") + route + query + l.hash);
      }
    }
  })();
</script>`;

function injectRestoreScript(html) {
  if (html.includes(RESTORE_MARKER)) return html;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${RESTORE_SCRIPT}\n</head>`);
  }
  // Fallback: prepend to the body so the snippet still runs before the bundle.
  return html.replace(/<body([^>]*)>/i, `<body$1>${RESTORE_SCRIPT}`);
}

function readBaseUrlFromAppJson() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "app.json"), "utf8");
    const parsed = JSON.parse(raw);
    const baseUrl = parsed?.expo?.experiments?.baseUrl;
    return typeof baseUrl === "string" && baseUrl.startsWith("/") ? baseUrl : "";
  } catch {
    return "";
  }
}

function buildSpaFallback(distDir) {
  const indexPath = path.join(distDir, "index.html");
  const fallbackPath = path.join(distDir, "404.html");
  const baseUrl = readBaseUrlFromAppJson();

  const indexHtml = fs.readFileSync(indexPath, "utf8");
  const patched = injectRestoreScript(indexHtml);
  fs.writeFileSync(indexPath, patched, "utf8");
  fs.writeFileSync(fallbackPath, buildRedirectScript(baseUrl), "utf8");
}

if (require.main === module) {
  const distDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_DIST;
  buildSpaFallback(distDir);
  console.log(`SPA fallback written to ${distDir}`);
}

module.exports = {
  buildSpaFallback,
  buildRedirectScript,
  injectRestoreScript,
  RESTORE_MARKER,
};
