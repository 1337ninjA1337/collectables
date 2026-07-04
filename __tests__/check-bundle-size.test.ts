import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_BUNDLE_BUDGET_BYTES,
  evaluateBundleBudget,
  formatBundleSizeReport,
  formatMegabytes,
  resolveBundleBudgetBytes,
} from "../lib/check-bundle-size";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const MB = 1024 * 1024;

describe("resolveBundleBudgetBytes", () => {
  it("returns the fallback when unset", () => {
    assert.equal(resolveBundleBudgetBytes(undefined), DEFAULT_BUNDLE_BUDGET_BYTES);
  });

  it("parses a positive integer override (trimmed)", () => {
    assert.equal(resolveBundleBudgetBytes(" 6291456 "), 6 * MB);
  });

  it("falls back on blank, non-numeric, zero, negative, fractional, overflow", () => {
    for (const bad of ["", "  ", "4.5MB", "5e6", "0", "-1", "3.5", "9007199254740993"]) {
      assert.equal(
        resolveBundleBudgetBytes(bad),
        DEFAULT_BUNDLE_BUDGET_BYTES,
        `expected fallback for ${JSON.stringify(bad)}`,
      );
    }
  });

  it("honours a custom fallback", () => {
    assert.equal(resolveBundleBudgetBytes("junk", 7), 7);
  });
});

describe("evaluateBundleBudget", () => {
  const files = [
    { file: "dist/a.js", bytes: 1 * MB },
    { file: "dist/entry.js", bytes: 4 * MB },
  ];

  it("sums files and sorts largest-first without mutating input", () => {
    const result = evaluateBundleBudget(files, 6 * MB);
    assert.equal(result.totalBytes, 5 * MB);
    assert.deepEqual(result.files.map((f) => f.file), ["dist/entry.js", "dist/a.js"]);
    assert.equal(files[0].file, "dist/a.js");
  });

  it("flags over budget strictly (at budget is still green)", () => {
    assert.equal(evaluateBundleBudget(files, 5 * MB).overBudget, false);
    assert.equal(evaluateBundleBudget(files, 5 * MB - 1).overBudget, true);
  });

  it("defaults to the 5MB budget with documented headroom over today's bundle", () => {
    assert.equal(DEFAULT_BUNDLE_BUDGET_BYTES, 5 * MB);
    // Today's real bundle is ~4.53MB — the default must sit above it (or
    // CI fails on day one) while staying tight enough to trip on a
    // vendored-SDK regression. If this fails after a legit size change,
    // re-justify the budget in lib/check-bundle-size.ts.
    const result = evaluateBundleBudget([{ file: "entry", bytes: 4_525_889 }]);
    assert.equal(result.overBudget, false);
  });
});

describe("formatBundleSizeReport", () => {
  it("one-line summary when under budget", () => {
    const report = formatBundleSizeReport(
      evaluateBundleBudget([{ file: "dist/entry.js", bytes: 2 * MB }], 5 * MB),
    );
    assert.match(report, /^check-bundle-size: Web bundle total 2\.00MB vs budget 5\.00MB/);
    assert.ok(!report.includes("\n"));
  });

  it("failure report lists files largest-first with the fix hint", () => {
    const report = formatBundleSizeReport(
      evaluateBundleBudget(
        [
          { file: "dist/a.js", bytes: 1 * MB },
          { file: "dist/entry.js", bytes: 5 * MB },
        ],
        4 * MB,
      ),
    );
    assert.match(report, /exceeds the size budget/);
    assert.ok(report.indexOf("dist/entry.js") < report.indexOf("dist/a.js"));
    assert.match(report, /posthog-js/);
    assert.match(report, /6\.00MB vs budget 4\.00MB/);
  });

  it("formatMegabytes renders two decimals", () => {
    assert.equal(formatMegabytes(4_525_889), "4.32MB");
    assert.equal(formatMegabytes(5 * MB), "5.00MB");
  });
});

describe("CI wiring", () => {
  it("package.json exposes lint:bundle-size", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts["lint:bundle-size"], "tsx scripts/check-bundle-size.ts");
  });

  it("ci.yml runs the budget AFTER the web build (post-build check)", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /npm run lint:bundle-size/);
    assert.ok(
      ci.indexOf("npm run build") < ci.indexOf("npm run lint:bundle-size"),
      "budget step must follow the build step",
    );
  });

  it("the script wrapper targets the exported bundle dir and fails without a build", () => {
    const script = read("scripts/check-bundle-size.ts");
    assert.match(script, /from "\.\.\/lib\/check-bundle-size"/);
    assert.match(script, /"dist", "_expo", "static", "js", "web"/);
    assert.match(script, /BUNDLE_BUDGET_BYTES/);
    assert.match(script, /process\.exit\(1\)/);
  });
});
