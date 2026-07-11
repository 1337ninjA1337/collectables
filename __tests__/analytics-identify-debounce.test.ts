import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Structural only — importing lib/analytics-provider.tsx at runtime would pull
// the react-native context tree (AsyncStorage, supabase) into node.
const ROOT = join(__dirname, "..");
const src = readFileSync(join(ROOT, "lib/analytics-provider.tsx"), "utf8");

// The identify effect must be debounced so a rapid premium-flag flip +
// language switch in one render cycle (or a Strict-Mode double-mount)
// collapses into a single PostHog identify instead of two.
describe("AnalyticsProvider — identifyUser debounce", () => {
  it("exports a 500ms debounce window constant", () => {
    assert.match(
      src,
      /export const IDENTIFY_DEBOUNCE_MS = 500;/,
      "the window must be a named exported constant, not an inline magic number",
    );
  });

  it("wraps identifyUser in a setTimeout keyed on the constant", () => {
    assert.match(
      src,
      /setTimeout\(\(\) => \{\s*identifyUser\(/,
      "identifyUser must fire inside the debounce timer",
    );
    assert.match(
      src,
      /\}, IDENTIFY_DEBOUNCE_MS\)/,
      "the timer must use IDENTIFY_DEBOUNCE_MS, not an inline literal",
    );
  });

  it("cancels the pending identify on dep change / unmount via effect cleanup", () => {
    assert.match(
      src,
      /return \(\) => clearTimeout\(timer\)/,
      "the effect must return a cleanup that clears the pending timer",
    );
  });

  it("moves lastUserIdRef assignment inside the timer so a cancelled identify leaves no phantom identity", () => {
    assert.match(
      src,
      /setTimeout\(\(\) => \{\s*identifyUser\([^)]*\);\s*lastUserIdRef\.current = user\.id;/,
      "lastUserIdRef must only be set once the identify actually fired",
    );
  });

  it("keeps resetUser synchronous (sign-out must not be debounced)", () => {
    const resetIdx = src.indexOf("resetUser()");
    assert.ok(resetIdx >= 0, "resetUser() call missing");
    // No setTimeout( between the sign-out branch start and the resetUser call.
    const branch = src.slice(src.indexOf("if (lastUserIdRef.current)"), resetIdx);
    assert.ok(
      !branch.includes("setTimeout"),
      "resetUser must fire immediately on the signed-in→signed-out edge",
    );
  });
});
