import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  readSentryEnvFromProcess,
  resolveSentryConfig,
} from "../lib/sentry-config";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("sentry env-var inlining (Metro/babel)", () => {
  it("readSentryEnvFromProcess reads each EXPO_PUBLIC_* var as a literal member access", () => {
    // Metro / babel-preset-expo only inlines `process.env.EXPO_PUBLIC_*` when
    // the access is a literal member expression. If a future refactor swaps
    // these for an indirect access (`(process.env as any).X` or
    // `process.env[key]`), values become `undefined` in the production bundle
    // and `dsnPresent` flips to `false` even though the secret was set in CI.
    const src = read("lib/sentry-config.ts");
    for (const name of [
      "EXPO_PUBLIC_SENTRY_DSN",
      "EXPO_PUBLIC_SENTRY_ENV",
      "EXPO_PUBLIC_SENTRY_RELEASE",
      "EXPO_PUBLIC_APP_VERSION",
    ]) {
      assert.match(
        src,
        new RegExp(`process\\.env\\.${name}\\b`),
        `lib/sentry-config.ts must reference process.env.${name} literally so Metro inlines it`,
      );
    }
  });

  it("readSentryEnvFromProcess does not pass `process.env` whole into resolveSentryConfig", () => {
    const src = read("lib/sentry-config.ts");
    // The previous bug: `resolveSentryConfig(process.env as Record<...>)` —
    // Metro can't see the keys at build time so the bundle reads undefined.
    assert.doesNotMatch(
      src,
      /resolveSentryConfig\(\s*process\.env\b/,
      "Do not pass process.env directly — use readSentryEnvFromProcess() so each EXPO_PUBLIC_* is referenced literally",
    );
  });

  it("initSentry uses readSentryEnvFromProcess instead of passing process.env whole", () => {
    const src = read("lib/sentry.ts");
    assert.match(
      src,
      /readSentryEnvFromProcess\(\)/,
      "lib/sentry.ts:initSentry must call readSentryEnvFromProcess() so EXPO_PUBLIC_* vars are inlined",
    );
    assert.doesNotMatch(
      src,
      /options\.env\s*\?\?\s*\(\s*process\.env\s+as\b/,
      "lib/sentry.ts must not fall back to passing `process.env` as a Record — Metro won't inline EXPO_PUBLIC_* keys",
    );
  });

  it("readSentryEnvFromProcess returns the four supported keys", () => {
    const env = readSentryEnvFromProcess();
    const keys = Object.keys(env).sort();
    assert.deepStrictEqual(keys, [
      "EXPO_PUBLIC_APP_VERSION",
      "EXPO_PUBLIC_SENTRY_DSN",
      "EXPO_PUBLIC_SENTRY_ENV",
      "EXPO_PUBLIC_SENTRY_RELEASE",
    ]);
  });

  it("resolveSentryConfig still accepts the helper output and produces a valid config", () => {
    const env = {
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/0",
      EXPO_PUBLIC_SENTRY_ENV: "production",
      EXPO_PUBLIC_SENTRY_RELEASE: "collectables@deadbeef",
      EXPO_PUBLIC_APP_VERSION: undefined,
    };
    const cfg = resolveSentryConfig(env);
    assert.equal(cfg.dsn, "https://abc@o0.ingest.sentry.io/0");
    assert.equal(cfg.environment, "production");
    assert.equal(cfg.release, "collectables@deadbeef");
    assert.equal(cfg.enabled, true);
  });
});
