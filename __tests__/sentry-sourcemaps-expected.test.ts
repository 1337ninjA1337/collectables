import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  resolveSentryConfig,
  resolveSourcemapsExpected,
} from "../lib/sentry-config";
import { initSentry, getSentryStatus } from "../lib/sentry";

const deployYml = readFileSync(
  join(__dirname, "..", ".github", "workflows", "deploy.yml"),
  "utf8",
);
const configSrc = readFileSync(
  join(__dirname, "..", "lib", "sentry-config.ts"),
  "utf8",
);

describe("resolveSourcemapsExpected", () => {
  it("accepts '1' and 'true' (any case)", () => {
    for (const v of ["1", "true", "TRUE", " True "]) {
      assert.equal(resolveSourcemapsExpected(v), true, `'${v}' must be true`);
    }
  });

  it("is false for unset, empty, and anything else", () => {
    for (const v of [undefined, "", "  ", "0", "false", "yes"]) {
      assert.equal(
        resolveSourcemapsExpected(v),
        false,
        `'${v}' must be false`,
      );
    }
  });

  it("flows through resolveSentryConfig without affecting enabled", () => {
    const base = {
      EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    };
    const withFlag = resolveSentryConfig({
      ...base,
      EXPO_PUBLIC_SENTRY_SOURCEMAPS: "1",
    });
    const withoutFlag = resolveSentryConfig(base);
    assert.equal(withFlag.sourcemapsExpected, true);
    assert.equal(withoutFlag.sourcemapsExpected, false);
    assert.equal(withFlag.enabled, true);
    assert.equal(
      withoutFlag.enabled,
      true,
      "runtime capture must never be gated on the sourcemaps flag (SENTRY_AUTH_TOKEN-not-required invariant)",
    );
  });
});

describe("getSentryStatus().sourcemapsExpected", () => {
  it("defaults to false before init", () => {
    assert.equal(getSentryStatus().sourcemapsExpected, false);
  });

  it("reflects the resolved config after init", async () => {
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
        EXPO_PUBLIC_SENTRY_SOURCEMAPS: "1",
      },
      loader: async () => ({
        init: () => {},
        captureException: () => {},
        addBreadcrumb: () => {},
        setUser: () => {},
      }),
    });
    const status = getSentryStatus();
    assert.equal(status.ready, true);
    assert.equal(status.sourcemapsExpected, true);
  });
});

describe("deploy workflow wiring", () => {
  it("build env inlines EXPO_PUBLIC_SENTRY_SOURCEMAPS from the SENTRY_AUTH_TOKEN gate", () => {
    assert.match(
      deployYml,
      /EXPO_PUBLIC_SENTRY_SOURCEMAPS: \$\{\{ secrets\.SENTRY_AUTH_TOKEN != '' && '1' \|\| '' \}\}/,
      "deploy.yml must inline the flag with the same condition that gates the sourcemap-upload step",
    );
  });

  it("the flag's gate matches the sourcemap-upload step's if-condition", () => {
    assert.match(
      deployYml,
      /if: \$\{\{ env\.SENTRY_AUTH_TOKEN != '' \}\}/,
      "the upload step's gate moved or was renamed — keep the inlined flag's condition in sync",
    );
  });

  it("readSentryEnvFromProcess reads the flag via a literal member access", () => {
    assert.match(
      configSrc,
      /EXPO_PUBLIC_SENTRY_SOURCEMAPS: process\.env\.EXPO_PUBLIC_SENTRY_SOURCEMAPS/,
      "the flag must be read literally or babel-preset-expo won't inline it",
    );
  });

  it("lib/sentry-config.ts codifies the SENTRY_AUTH_TOKEN-not-required invariant", () => {
    assert.match(
      configSrc,
      /INVARIANT — `SENTRY_AUTH_TOKEN` is never required for runtime capture/,
    );
  });
});
