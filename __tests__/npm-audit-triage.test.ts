import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const SECURITY = readFileSync(join(ROOT, "SECURITY.md"), "utf8");
const CI = readFileSync(
  join(ROOT, ".github", "workflows", "ci.yml"),
  "utf8",
);

describe("SEC-8: npm audit triage", () => {
  it("SECURITY.md documents the npm audit triage section", () => {
    assert.match(SECURITY, /##\s+Dependency advisories/i);
    assert.match(SECURITY, /npm audit/);
    // Every triaged high/critical package must be named so a future reviewer can
    // tell a re-triaged advisory apart from a brand-new one.
    for (const pkg of [
      "shell-quote",
      "@xmldom/xmldom",
      "protobufjs",
      "undici",
      "ws",
    ]) {
      assert.ok(
        SECURITY.includes(`\`${pkg}\``),
        `triage table must reference ${pkg}`,
      );
    }
    // Records the standing decision + the condition that flips accept → fix.
    assert.match(SECURITY, /Accepted risk/i);
    assert.match(SECURITY, /new.*package|direct.*dependency/i);
  });

  it("CI runs a non-blocking high-level dependency audit", () => {
    // The step must exist, gate on >=high, and never fail the build.
    assert.match(CI, /npm audit --audit-level=high/);
    assert.match(CI, /continue-on-error:\s*true/);

    // The audit step specifically (not some other step) carries continue-on-error.
    const auditIdx = CI.indexOf("npm audit --audit-level=high");
    assert.ok(auditIdx > 0, "audit step present");
    const after = CI.slice(auditIdx, auditIdx + 120);
    assert.match(
      after,
      /continue-on-error:\s*true/,
      "the audit step itself must be non-blocking",
    );
  });

  it("the audit step runs after deps are installed", () => {
    const installIdx = CI.indexOf("npm ci");
    const auditIdx = CI.indexOf("npm audit --audit-level=high");
    assert.ok(installIdx > 0 && auditIdx > installIdx, "audit must follow npm ci");
  });
});
