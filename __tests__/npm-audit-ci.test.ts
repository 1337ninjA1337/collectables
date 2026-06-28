import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const CI = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const SECURITY = readFileSync(join(ROOT, "SECURITY.md"), "utf8");

describe("SEC-8: npm audit triage", () => {
  it("CI runs a high-level dependency audit", () => {
    assert.match(CI, /npm audit --audit-level=high/);
  });

  it("the audit step is non-blocking", () => {
    // The audit step and its non-blocking marker must travel together: locate
    // the `npm audit` step block and assert it carries continue-on-error: true.
    const idx = CI.indexOf("npm audit --audit-level=high");
    assert.ok(idx >= 0, "expected an npm audit step in CI");
    // Look at the step header preceding the run line (a step is `- name:` …).
    const stepStart = CI.lastIndexOf("- name:", idx);
    const block = CI.slice(stepStart, idx);
    assert.match(
      block,
      /continue-on-error:\s*true/,
      "the npm audit step must be non-blocking (continue-on-error: true)",
    );
  });

  it("SECURITY.md documents the audit triage", () => {
    assert.match(SECURITY, /##\s+Dependency advisory triage/i);
    // Names the CI gate and that it is non-blocking.
    assert.match(SECURITY, /npm audit --audit-level=high/);
    assert.match(SECURITY, /non-blocking|continue-on-error/i);
  });

  it("records the resolved high/critical advisories and the accepted remainder", () => {
    assert.match(SECURITY, /Resolved/i);
    assert.match(SECURITY, /Accepted|unfixable/i);
    // The packages whose high/critical advisories were cleared by `npm audit fix`.
    for (const pkg of ["shell-quote", "xmldom", "undici", "ws", "protobufjs"]) {
      assert.ok(
        SECURITY.includes(pkg),
        `triage must list the resolved advisory for ${pkg}`,
      );
    }
    // The accepted remainder (build-time tooling, breaking-bump-only fixes).
    for (const pkg of ["js-yaml", "postcss", "uuid", "esbuild"]) {
      assert.ok(
        SECURITY.includes(pkg),
        `triage must list the accepted advisory for ${pkg}`,
      );
    }
  });
});
