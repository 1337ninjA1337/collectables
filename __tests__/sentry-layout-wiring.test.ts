import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const layoutSrc = readFileSync(
  path.join(process.cwd(), "app", "_layout.tsx"),
  "utf8",
);

const fallbackSrc = readFileSync(
  path.join(process.cwd(), "components", "crash-fallback.tsx"),
  "utf8",
);

describe("Crash #4 — Sentry provider wiring", () => {
  it("imports initSentry from lib/sentry", () => {
    assert.match(
      layoutSrc,
      /import\s*\{\s*initSentry\s*\}\s*from\s*["']@\/lib\/sentry["']/,
      "_layout.tsx must import initSentry from @/lib/sentry",
    );
  });

  it("calls initSentry() inside a useEffect at the top of RootLayout", () => {
    assert.match(
      layoutSrc,
      /useEffect\(\s*\(\)\s*=>\s*\{\s*void\s+initSentry\(\)\s*;?\s*\}\s*,\s*\[\]\s*\)/,
      "_layout.tsx must call initSentry() inside a top-level useEffect with empty deps",
    );
  });

  it("imports Sentry's ErrorBoundary", () => {
    assert.match(
      layoutSrc,
      /import\s*\{\s*ErrorBoundary\s*\}\s*from\s*["']@sentry\/react-native["']/,
      "_layout.tsx must import ErrorBoundary from @sentry/react-native",
    );
  });

  it("wraps the provider tree with <ErrorBoundary>", () => {
    assert.match(
      layoutSrc,
      /<ErrorBoundary[\s\S]*?<I18nProvider>/,
      "ErrorBoundary must wrap the I18nProvider (and the rest of the tree)",
    );
    assert.match(
      layoutSrc,
      /<\/I18nProvider>[\s\S]*?<\/ErrorBoundary>/,
      "ErrorBoundary closing tag must come after I18nProvider's",
    );
  });

  it("passes a fallback that renders CrashFallback with error + resetError", () => {
    assert.match(
      layoutSrc,
      /fallback=\{\(\{\s*error,\s*resetError\s*\}\)\s*=>\s*\(\s*<CrashFallback[\s\S]*?error=\{error\}[\s\S]*?resetError=\{resetError\}/,
      "<ErrorBoundary> must pass error + resetError to <CrashFallback>",
    );
  });

  it("imports the CrashFallback component", () => {
    assert.match(
      layoutSrc,
      /import\s*\{\s*CrashFallback\s*\}\s*from\s*["']@\/components\/crash-fallback["']/,
      "_layout.tsx must import CrashFallback",
    );
  });
});

describe("Crash #4 — CrashFallback component", () => {
  it("uses the EmptyState pattern with the 🪧 icon", () => {
    assert.match(fallbackSrc, /icon=["']🪧["']/, "CrashFallback must reuse the 🪧 not-found icon");
    assert.match(fallbackSrc, /<EmptyState/, "CrashFallback must render <EmptyState>");
  });

  it("accepts optional t() so future i18n integration is plug-in", () => {
    assert.match(
      fallbackSrc,
      /t\?:\s*\(key:\s*string\)\s*=>\s*string/,
      "CrashFallback must accept an optional t prop for future i18n",
    );
  });

  it("declares the three localisation keys for Crash #13 to fill in", () => {
    for (const key of [
      "crashFallbackTitle",
      "crashFallbackBody",
      "crashFallbackRetry",
    ]) {
      assert.ok(
        fallbackSrc.includes(key),
        `CrashFallback must declare the '${key}' fallback string`,
      );
    }
  });

  it("invokes resetError when the action button is pressed", () => {
    assert.match(
      fallbackSrc,
      /onAction=\{resetError\}/,
      "EmptyState's onAction must be the resetError callback",
    );
  });
});
