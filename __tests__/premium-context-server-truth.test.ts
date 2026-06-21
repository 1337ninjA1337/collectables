import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

/**
 * BE-22c — premium-context pulls server-authoritative truth on authed load and
 * LWW-merges it over the AsyncStorage cache (server wins). These structural
 * guards pin the wiring: the pure merge/validation helpers + the cloud wrapper
 * are imported and composed inside the load effect, and a transient failure
 * (null) does not downgrade the cached entitlement.
 */
describe("premium-context wires server truth over the cache (BE-22c)", () => {
  const src = read("lib/premium-context.tsx");

  it("imports the cloud validate wrapper", () => {
    assert.match(
      src,
      /import\s*\{\s*cloudValidatePremium\s*\}\s*from\s*["']@\/lib\/supabase-subscriptions["']/,
    );
  });

  it("imports validationToPremiumState + mergePremiumState", () => {
    assert.match(
      src,
      /import\s*\{\s*validationToPremiumState\s*\}\s*from\s*["']@\/lib\/subscriptions["']/,
    );
    assert.match(src, /\bmergePremiumState\b/);
  });

  it("calls cloudValidatePremium with the validate action", () => {
    assert.match(src, /cloudValidatePremium\(\s*["']validate["']\s*\)/);
  });

  it("LWW-merges the validated entitlement over previous state", () => {
    assert.match(
      src,
      /setState\(\s*\(prev\)\s*=>\s*mergePremiumState\(\s*prev\s*,\s*validationToPremiumState\(\s*validation\s*\)\s*\)\s*\)/,
    );
  });

  it("preserves the cache on a transient failure (null short-circuit)", () => {
    assert.match(src, /if\s*\(\s*cancelled\s*\|\|\s*!validation\s*\)\s*return;/);
  });

  it("runs the server pull inside the load effect after setReady(true)", () => {
    const readyIdx = src.indexOf("setReady(true)");
    const validateIdx = src.indexOf("cloudValidatePremium(");
    assert.ok(readyIdx !== -1, "setReady(true) present");
    assert.ok(validateIdx !== -1, "cloudValidatePremium call present");
    assert.ok(validateIdx > readyIdx, "server pull comes after the cache load resolves");
  });
});
