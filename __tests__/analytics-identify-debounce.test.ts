import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Structural only, and deliberately still so. The provider IS mountable now —
// __tests__/analytics-provider-strict-mode.test.ts renders it through the
// render harness with its four sibling contexts mocked — and that suite covers
// the observable behaviour. What a render cannot see is HOW the behaviour is
// achieved, and the wiring below is the part that must not drift: a provider
// that re-rolled an inline `setTimeout` with the same window would pass every
// runtime assertion while dropping the shared scheduler's reset semantics.
// The debounce/reset SEMANTICS themselves are covered by the mock-timer suite
// in __tests__/identify-scheduler.test.ts.
const ROOT = join(__dirname, "..");
const src = readFileSync(join(ROOT, "lib/analytics-provider.tsx"), "utf8");

describe("AnalyticsProvider — identify debounce via createIdentifyScheduler", () => {
  it("re-exports the scheduler's default as IDENTIFY_DEBOUNCE_MS (no drift)", () => {
    assert.match(
      src,
      /export const IDENTIFY_DEBOUNCE_MS = DEFAULT_IDENTIFY_DEBOUNCE_MS;/,
      "the window must re-export DEFAULT_IDENTIFY_DEBOUNCE_MS so provider and scheduler can never disagree",
    );
  });

  it("creates the scheduler with identifyUser/resetUser and the exported window", () => {
    assert.match(
      src,
      /createIdentifyScheduler\(\{\s*identify:\s*identifyUser,\s*reset:\s*resetUser,\s*debounceMs:\s*IDENTIFY_DEBOUNCE_MS,\s*\}\)/,
      "the scheduler must be wired to the module wrappers with the named debounce constant",
    );
  });

  it("creates the scheduler once per mount (lazy ref, not per render)", () => {
    assert.match(
      src,
      /const schedulerRef = useRef<IdentifyScheduler \| null>\(null\);\s*if \(!schedulerRef\.current\) \{/,
      "the scheduler must live in a lazily-initialised ref so re-renders reuse the same timer state",
    );
  });

  it("delegates the effect body to scheduler.update(user?.id ?? null, traits)", () => {
    assert.match(
      src,
      /scheduler\.update\(user\?\.id \?\? null, \{ language, isPremium \}\)/,
      "the identify effect must feed the scheduler instead of arming its own setTimeout",
    );
  });

  it("does not re-roll an inline debounce timer in the provider", () => {
    assert.ok(
      !src.includes("setTimeout"),
      "no inline setTimeout — the debounce lives in lib/identify-scheduler.ts",
    );
    assert.ok(
      !src.includes("clearTimeout"),
      "no inline clearTimeout — cancellation lives in the scheduler",
    );
  });

  it("disposes the scheduler in an unmount cleanup", () => {
    assert.match(
      src,
      /return \(\) => scheduler\.dispose\(\)/,
      "unmount must cancel any pending identify via scheduler.dispose()",
    );
  });

  it("leaves the fired-identity guard to the scheduler (no lastUserIdRef re-roll)", () => {
    assert.ok(
      !src.includes("lastUserIdRef"),
      "the signed-in→signed-out edge guard lives in the scheduler's identifiedUserId, not a provider ref",
    );
  });
});
