import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// useAnalytics() — the React-facing analytics surface. Call sites that need
// ad-hoc identify/track/reset go through the hook instead of importing
// @/lib/analytics directly, so `optedOut` stays a live React value.
describe("useAnalytics — context surface on AnalyticsProvider", () => {
  const src = read("lib/analytics-provider.tsx");

  it("creates an AnalyticsContext and exports the useAnalytics hook", () => {
    assert.match(
      src,
      /createContext<AnalyticsContextValue \| null>\(null\)/,
      "must create a nullable AnalyticsContext so the hook can detect a missing provider",
    );
    assert.match(
      src,
      /export function useAnalytics\(\): AnalyticsContextValue/,
      "must export useAnalytics() typed as AnalyticsContextValue",
    );
  });

  it("exposes { identify, reset, track, optedOut } on the context value", () => {
    for (const key of ["identify", "reset", "track", "optedOut"]) {
      assert.match(
        src,
        new RegExp(`\\b${key}\\b`),
        `AnalyticsContextValue must expose ${key}`,
      );
    }
    // The value must delegate to the module wrappers, not re-implement them.
    assert.match(
      src,
      /identify:\s*identifyUser/,
      "identify must delegate to identifyUser",
    );
    assert.match(src, /reset:\s*resetUser/, "reset must delegate to resetUser");
    assert.match(src, /track:\s*trackEvent/, "track must delegate to trackEvent");
  });

  it("derives optedOut from the diagnostics toggle (live React value)", () => {
    assert.match(
      src,
      /useDiagnostics\(\)/,
      "must subscribe to useDiagnostics() so optedOut re-renders on toggle flips",
    );
    assert.match(
      src,
      /optedOut:\s*!diagnosticsEnabled/,
      "optedOut must be the inverse of diagnosticsEnabled",
    );
  });

  it("memoises the context value keyed on the opt-out state", () => {
    assert.match(
      src,
      /useMemo<AnalyticsContextValue>/,
      "context value must be memoised so consumers do not re-render every provider render",
    );
    assert.match(
      src,
      /\[diagnosticsEnabled\]/,
      "the memo must depend on diagnosticsEnabled",
    );
  });

  it("throws a descriptive error when used outside the provider", () => {
    assert.match(
      src,
      /useAnalytics must be used inside <AnalyticsProvider>/,
      "hook must throw a message naming the missing provider",
    );
  });

  it("keeps the identify/reset identity wiring (thin wrapper, not a rewrite)", () => {
    assert.match(src, /identifyUser\(\s*user\.id/, "identity effect must remain");
    assert.match(src, /resetUser\(\)/, "sign-out reset must remain");
    assert.match(src, /lastUserIdRef/, "signed-in→signed-out edge guard must remain");
  });
});

describe("useAnalytics — provider-tree prerequisites", () => {
  const layoutSrc = read("app/_layout.tsx");

  it("mounts <AnalyticsProvider> inside <DiagnosticsProvider> so useDiagnostics resolves", () => {
    const diagOpen = layoutSrc.indexOf("<DiagnosticsProvider>");
    const analyticsOpen = layoutSrc.indexOf("<AnalyticsProvider>");
    assert.ok(diagOpen >= 0, "<DiagnosticsProvider> not found");
    assert.ok(analyticsOpen >= 0, "<AnalyticsProvider> not found");
    assert.ok(
      diagOpen < analyticsOpen,
      "<AnalyticsProvider> must mount inside <DiagnosticsProvider>",
    );
  });
});
