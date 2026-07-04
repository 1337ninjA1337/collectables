import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const DOC = "docs/analytics-cost-projection.md";
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("docs/analytics-cost-projection.md", () => {
  it("file exists at the canonical path", () => {
    assert.ok(existsSync(join(ROOT, DOC)));
  });

  const src = read(DOC);

  it("surfaces the per-DAU event model (27,000 events/DAU/month)", () => {
    assert.match(src, /27,000 events\/DAU\/month/);
  });

  it("derives the ~37 DAU free-tier ceiling and the ~30 DAU budgeting signal", () => {
    assert.match(src, /≈\s*37 DAU/);
    assert.match(src, /~30/);
    assert.match(src, /start budgeting/i);
  });

  it("uses the next-tier price from analytics-platform.md ($0.00031/event)", () => {
    assert.match(src, /\$0\.00031\/event/);
    // The same constant must still exist in the source doc so the two don't drift.
    assert.match(read("docs/analytics-platform.md"), /\$0\.00031\/event/);
  });

  it("has a linear projection table with DAU, events/month and price columns", () => {
    assert.match(src, /\| DAU \| Events\/month \|/);
    for (const dau of ["10", "30", "50", "100"]) {
      assert.match(
        src,
        new RegExp(`\\|\\s*${dau}\\s*\\|`),
        `projection table must include a ${dau}-DAU row`,
      );
    }
  });

  it("states the bill formula", () => {
    assert.match(src, /\(events − 1,000,000\) × \$0\.00031/);
  });

  it("names PostHog volume as the first paid trigger and rules out Clarity/Supabase/Power BI", () => {
    assert.match(src, /first paid trigger/i);
    for (const other of ["Clarity", "Supabase", "Power BI"]) {
      assert.ok(src.includes(other), `doc must rule out ${other} as the first trigger`);
    }
  });

  it("documents cost levers and the live-data re-derivation", () => {
    assert.match(src, /rate limiter/i);
    assert.match(src, /ingestion-only/i);
    assert.match(src, /EXPO_PUBLIC_ANALYTICS_MIRROR_DISABLED/);
    assert.match(src, /average\s*\nDAU|average DAU/);
  });

  it("cross-links both companion docs", () => {
    assert.match(src, /\.\/analytics-platform\.md/);
    assert.match(src, /\.\/powerbi-cost-projection\.md/);
  });
});
