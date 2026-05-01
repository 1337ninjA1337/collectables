import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("PremiumGate component", () => {
  const src = read("components/premium-gate.tsx");

  it("uses usePremium hook", () => {
    assert.match(src, /usePremium/);
  });

  it("checks both ready and isPremium before rendering children", () => {
    assert.match(src, /if\s*\(\s*!ready\s*\)/);
    assert.match(src, /if\s*\(\s*!isPremium\s*\)/);
  });

  it("exports PremiumGate", () => {
    assert.match(src, /export function PremiumGate/);
  });
});

describe("item detail screen gates overFreeCap on premiumReady", () => {
  const src = read("app/item/[id].tsx");

  it("destructures ready from usePremium()", () => {
    assert.match(src, /ready\s*:\s*premiumReady/);
  });

  it("includes premiumReady in overFreeCap calculation", () => {
    assert.match(src, /overFreeCap\s*=\s*premiumReady\s*&&/);
  });
});
