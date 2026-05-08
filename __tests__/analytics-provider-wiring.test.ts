import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("DiagnosticsProvider — initAnalytics is called after initSentry", () => {
  const src = read("lib/diagnostics-context.tsx");

  it("imports initAnalytics + setAnalyticsOptOut + shutdownAnalytics from @/lib/analytics", () => {
    assert.match(
      src,
      /from\s+["']@\/lib\/analytics["']/,
      "DiagnosticsProvider must import the analytics wrapper",
    );
    for (const symbol of [
      "initAnalytics",
      "setAnalyticsOptOut",
      "shutdownAnalytics",
    ]) {
      assert.match(
        src,
        new RegExp(`\\b${symbol}\\b`),
        `DiagnosticsProvider must reference ${symbol}`,
      );
    }
  });

  it("calls initAnalytics() *after* initSentry() in the hydration path", () => {
    // The hydration path is the AsyncStorage.getItem(...).then((raw) => ...) block.
    // initAnalytics() must follow initSentry() so the order documented in the task spec is preserved.
    const initSentryIdx = src.indexOf("initSentry()");
    const initAnalyticsIdx = src.indexOf("initAnalytics()");
    assert.ok(initSentryIdx >= 0, "initSentry() call missing");
    assert.ok(initAnalyticsIdx >= 0, "initAnalytics() call missing");
    assert.ok(
      initAnalyticsIdx > initSentryIdx,
      "initAnalytics() must appear after initSentry() so the order matches the task spec",
    );
  });

  it("calls shutdownAnalytics alongside shutdownSentry on opt-out", () => {
    assert.match(
      src,
      /shutdownSentry\(\);[\s\S]{0,80}shutdownAnalytics\(\)/,
      "shutdownAnalytics must be invoked when shutdownSentry is, on the diagnostics-disabled branch",
    );
  });

  it("flips setAnalyticsOptOut alongside setSentryOptOut", () => {
    const sentryFlips = (src.match(/setSentryOptOut\(/g) ?? []).length;
    const analyticsFlips = (src.match(/setAnalyticsOptOut\(/g) ?? []).length;
    assert.equal(
      analyticsFlips,
      sentryFlips,
      "setAnalyticsOptOut must be called everywhere setSentryOptOut is",
    );
  });
});

describe("AnalyticsProvider — provider tree wiring", () => {
  const layoutSrc = read("app/_layout.tsx");

  it("imports AnalyticsProvider from @/lib/analytics-provider", () => {
    assert.match(
      layoutSrc,
      /import\s*\{\s*AnalyticsProvider\s*\}\s*from\s*["']@\/lib\/analytics-provider["']/,
      "app/_layout.tsx must import { AnalyticsProvider }",
    );
  });

  it("renders <AnalyticsProvider> inside <PremiumProvider> so usePremium() resolves", () => {
    // PremiumProvider must wrap AnalyticsProvider — the hook would throw otherwise.
    const premiumOpen = layoutSrc.indexOf("<PremiumProvider>");
    const analyticsOpen = layoutSrc.indexOf("<AnalyticsProvider>");
    assert.ok(premiumOpen >= 0, "<PremiumProvider> not found");
    assert.ok(analyticsOpen >= 0, "<AnalyticsProvider> not found");
    assert.ok(
      premiumOpen < analyticsOpen,
      "<AnalyticsProvider> must mount inside <PremiumProvider>",
    );
  });

  it("renders <AnalyticsProvider> inside <AuthProvider> + <I18nProvider>", () => {
    const authOpen = layoutSrc.indexOf("<AuthProvider>");
    const i18nOpen = layoutSrc.indexOf("<I18nProvider>");
    const analyticsOpen = layoutSrc.indexOf("<AnalyticsProvider>");
    assert.ok(authOpen < analyticsOpen, "<AnalyticsProvider> must mount inside <AuthProvider>");
    assert.ok(i18nOpen < analyticsOpen, "<AnalyticsProvider> must mount inside <I18nProvider>");
  });
});

describe("AnalyticsProvider — hook usage + identify/reset behaviour", () => {
  const src = read("lib/analytics-provider.tsx");

  it("imports identifyUser + resetUser from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bidentifyUser\b[^}]*\bresetUser\b[^}]*\}\s*from\s*["']@\/lib\/analytics["']/,
      "analytics-provider must import identifyUser and resetUser from @/lib/analytics",
    );
  });

  it("subscribes to useAuth, useI18n, and usePremium", () => {
    for (const hook of ["useAuth", "useI18n", "usePremium"]) {
      assert.match(
        src,
        new RegExp(`\\b${hook}\\(\\)`),
        `analytics-provider must call ${hook}()`,
      );
    }
  });

  it("forwards { language, isPremium } as identifyUser traits", () => {
    assert.match(
      src,
      /identifyUser\(\s*[^,]+,\s*\{[^}]*language[^}]*isPremium[^}]*\}\s*\)/,
      "identifyUser must be invoked with { language, isPremium } traits",
    );
  });

  it("calls resetUser on the signed-in -> signed-out transition", () => {
    assert.match(
      src,
      /resetUser\(\)/,
      "analytics-provider must call resetUser() when the user signs out",
    );
    // Guard: do not call resetUser on every initial render where user starts as null
    assert.match(
      src,
      /lastUserIdRef/,
      "analytics-provider must track the previous user id so resetUser fires only on the signed-in→signed-out edge",
    );
  });
});
