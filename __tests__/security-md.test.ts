import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const SECURITY = readFileSync(join(ROOT, "SECURITY.md"), "utf8");

describe("SEC-21: SECURITY.md", () => {
  it("declares supported versions and a private reporting channel", () => {
    assert.match(SECURITY, /##\s+Supported versions/);
    assert.match(SECURITY, /##\s+Reporting a vulnerability/);
    // Must steer reporters away from public issues toward a private channel.
    assert.match(SECURITY, /private vulnerability reporting|security\/advisories/i);
    assert.match(SECURITY, /do not open a public github issue/i);
  });

  it("includes an incident runbook that revokes sessions", () => {
    assert.match(SECURITY, /##\s+Incident runbook/i);
    assert.match(SECURITY, /revoke|sign out|JWT secret/i);
    assert.match(SECURITY, /Revoke active Supabase sessions/i);
  });

  it("documents rotation for every server-only secret", () => {
    for (const secret of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "CLOUDINARY_API_SECRET",
      "POSTHOG_WEBHOOK_SECRET",
    ]) {
      assert.ok(
        SECURITY.includes(secret),
        `runbook must reference ${secret} rotation`,
      );
    }
    // Both vendor rotation sections the task calls out explicitly.
    assert.match(SECURITY, /Rotate Supabase keys/i);
    assert.match(SECURITY, /Rotate Cloudinary credentials/i);
  });

  it("references the incident-response kill-switches", () => {
    assert.match(SECURITY, /EXPO_PUBLIC_REALTIME_DISABLED/);
    assert.match(SECURITY, /EXPO_PUBLIC_ANALYTICS_DISABLED/);
  });

  it("flags service-only secrets as never client-exposed", () => {
    assert.match(SECURITY, /server only/i);
  });
});
