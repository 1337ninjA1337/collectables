import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
  evaluateBundleSize,
  formatBundleSizeReport,
  resolveBundleSizeBudget,
} from "../lib/bundle-size";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("resolveBundleSizeBudget", () => {
  it("defaults to 4.5 MiB when the env var is unset or empty", () => {
    assert.equal(DEFAULT_BUNDLE_SIZE_BUDGET_BYTES, 4.5 * 1024 * 1024);
    assert.equal(resolveBundleSizeBudget({}), DEFAULT_BUNDLE_SIZE_BUDGET_BYTES);
    assert.equal(
      resolveBundleSizeBudget({ BUNDLE_SIZE_BUDGET_BYTES: "" }),
      DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
    );
  });

  it("accepts a positive integer override", () => {
    assert.equal(
      resolveBundleSizeBudget({ BUNDLE_SIZE_BUDGET_BYTES: "5000000" }),
      5_000_000,
    );
  });

  it("falls back to the default on malformed values instead of disabling the gate", () => {
    for (const raw of ["-1", "0", "4.5MB", "abc", "1.5"]) {
      assert.equal(
        resolveBundleSizeBudget({ BUNDLE_SIZE_BUDGET_BYTES: raw }),
        DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
        `expected fallback for ${JSON.stringify(raw)}`,
      );
    }
  });
});

describe("evaluateBundleSize", () => {
  const files = [
    { path: "a.js", bytes: 3_000_000 },
    { path: "b.js", bytes: 1_000_000 },
  ];

  it("sums file sizes and passes under budget", () => {
    const result = evaluateBundleSize(files, 4_500_000);
    assert.equal(result.totalBytes, 4_000_000);
    assert.equal(result.overBudget, false);
    assert.equal(result.headroomBytes, 500_000);
  });

  it("fails when the total exceeds the budget", () => {
    const result = evaluateBundleSize(files, 3_999_999);
    assert.equal(result.overBudget, true);
    assert.equal(result.headroomBytes, -1);
  });

  it("a total exactly at the budget passes (budget is inclusive)", () => {
    const result = evaluateBundleSize(files, 4_000_000);
    assert.equal(result.overBudget, false);
    assert.equal(result.headroomBytes, 0);
  });
});

describe("formatBundleSizeReport", () => {
  it("reports OK with headroom when under budget", () => {
    const files = [{ path: "entry.js", bytes: 1024 }];
    const report = formatBundleSizeReport(files, evaluateBundleSize(files, 2048));
    assert.match(report, /entry\.js/);
    assert.match(report, /check-bundle-size: OK/);
    assert.match(report, /1\.0 KiB of headroom/);
  });

  it("reports FAIL with the overshoot and the lazy-import hint when over budget", () => {
    const files = [{ path: "entry.js", bytes: 3072 }];
    const report = formatBundleSizeReport(files, evaluateBundleSize(files, 1024));
    assert.match(report, /check-bundle-size: FAIL/);
    assert.match(report, /exceeds budget by 2\.0 KiB/);
    assert.match(report, /lazy `import\(\)`/);
  });
});

describe("CI wiring", () => {
  it("package.json exposes lint:bundle-size", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(
      pkg.scripts["lint:bundle-size"],
      "tsx scripts/check-bundle-size.ts",
    );
  });

  it("ci.yml runs the gate after the web build", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /npm run lint:bundle-size/);
    const buildIdx = ci.indexOf("npm run build");
    const gateIdx = ci.indexOf("npm run lint:bundle-size");
    assert.ok(buildIdx >= 0 && gateIdx > buildIdx, "gate must run after the build step");
  });
});
