import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "deploy.yml"),
  "utf8",
);

describe("Crash #8 — deploy workflow injects Sentry env into build", () => {
  it("passes EXPO_PUBLIC_SENTRY_DSN to the build step", () => {
    assert.match(
      workflow,
      /EXPO_PUBLIC_SENTRY_DSN:\s*\$\{\{\s*secrets\.EXPO_PUBLIC_SENTRY_DSN\s*\}\}/,
    );
  });

  it("passes EXPO_PUBLIC_SENTRY_ENV to the build step", () => {
    assert.match(
      workflow,
      /EXPO_PUBLIC_SENTRY_ENV:\s*\$\{\{\s*secrets\.EXPO_PUBLIC_SENTRY_ENV\s*\}\}/,
    );
  });

  it("builds with --source-maps so Sentry can map stack frames", () => {
    assert.match(
      workflow,
      /npx expo export --platform web --source-maps/,
    );
  });

  it("strips .map files from the public artifact", () => {
    assert.match(
      workflow,
      /find dist -name "\*\.map"[^\n]*-delete/,
    );
  });
});

describe("Crash #8 — sourcemap upload step", () => {
  it("uses the official getsentry/action-release action", () => {
    assert.match(workflow, /uses:\s*getsentry\/action-release@v1/);
  });

  it("is gated on SENTRY_AUTH_TOKEN being non-empty", () => {
    assert.match(
      workflow,
      /if:\s*\$\{\{\s*env\.SENTRY_AUTH_TOKEN\s*!=\s*''\s*\}\}/,
    );
  });

  it("forwards SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT", () => {
    assert.match(
      workflow,
      /SENTRY_AUTH_TOKEN:\s*\$\{\{\s*secrets\.SENTRY_AUTH_TOKEN\s*\}\}/,
    );
    assert.match(
      workflow,
      /SENTRY_ORG:\s*\$\{\{\s*secrets\.SENTRY_ORG\s*\}\}/,
    );
    assert.match(
      workflow,
      /SENTRY_PROJECT:\s*\$\{\{\s*secrets\.SENTRY_PROJECT\s*\}\}/,
    );
  });

  it("points the action at ./dist (the expo export output)", () => {
    assert.match(workflow, /sourcemaps:\s*\.\/dist/);
  });
});

describe("Crash #10 — release tagging by commit SHA", () => {
  it("sets EXPO_PUBLIC_SENTRY_RELEASE to collectables@<sha> in build env", () => {
    assert.match(
      workflow,
      /EXPO_PUBLIC_SENTRY_RELEASE:\s*collectables@\$\{\{\s*github\.sha\s*\}\}/,
    );
  });

  it("uses the same version tag for the action-release upload", () => {
    assert.match(
      workflow,
      /version:\s*collectables@\$\{\{\s*github\.sha\s*\}\}/,
    );
  });
});

describe("Crash #10 — sentry-config honours EXPO_PUBLIC_SENTRY_RELEASE", () => {
  const cfgSrc = readFileSync(
    path.join(process.cwd(), "lib", "sentry-config.ts"),
    "utf8",
  );

  it("reads EXPO_PUBLIC_SENTRY_RELEASE first when present", () => {
    assert.match(
      cfgSrc,
      /env\.EXPO_PUBLIC_SENTRY_RELEASE/,
      "sentry-config must read EXPO_PUBLIC_SENTRY_RELEASE",
    );
  });

  it("EXPO_PUBLIC_SENTRY_RELEASE wins over EXPO_PUBLIC_APP_VERSION", async () => {
    const { resolveSentryConfig } = await import("../lib/sentry-config");
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_RELEASE: "collectables@deadbeef",
      EXPO_PUBLIC_APP_VERSION: "9.9.9",
    });
    assert.equal(cfg.release, "collectables@deadbeef");
  });

  it("falls back to APP_VERSION when SENTRY_RELEASE is empty", async () => {
    const { resolveSentryConfig } = await import("../lib/sentry-config");
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_APP_VERSION: "2.0.0",
    });
    assert.equal(cfg.release, "collectables@2.0.0");
  });
});
