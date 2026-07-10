import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  resolveSentryConfig,
  isValidSentryDsn,
  resolveTracesSampleRate,
  DEFAULT_TRACES_SAMPLE_RATE,
  __resetSentryConfigWarningForTests,
} from "../lib/sentry-config";

const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
);
const APP_VERSION: string = packageJson.version;

describe("resolveSentryConfig", () => {
  it("disables the SDK when no DSN is provided", () => {
    const cfg = resolveSentryConfig({});
    assert.equal(cfg.dsn, "");
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.environment, "production");
  });

  it("disables the SDK in development even if a DSN is provided", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "development",
    });
    assert.equal(cfg.dsn, "https://abc@o0.ingest.sentry.io/1");
    assert.equal(cfg.environment, "development");
    assert.equal(cfg.enabled, false);
  });

  it("enables the SDK in production when DSN is provided", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.environment, "production");
  });

  it("treats staging as enabled when DSN is provided", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "staging",
    });
    assert.equal(cfg.environment, "staging");
    assert.equal(cfg.enabled, true);
  });

  it("falls back to production when SENTRY_ENV is unset or unknown", () => {
    assert.equal(
      resolveSentryConfig({
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o0.ingest.sentry.io/1",
      }).environment,
      "production",
    );
    assert.equal(
      resolveSentryConfig({
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o0.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "qa",
      }).environment,
      "production",
    );
  });

  it("trims whitespace around the DSN", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "   https://x@o0.ingest.sentry.io/1   ",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    });
    assert.equal(cfg.dsn, "https://x@o0.ingest.sentry.io/1");
    assert.equal(cfg.enabled, true);
  });

  it("treats whitespace-only DSN as missing", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "   ",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    });
    assert.equal(cfg.dsn, "");
    assert.equal(cfg.enabled, false);
  });

  it("derives release from EXPO_PUBLIC_APP_VERSION when set", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_APP_VERSION: "2.4.1",
    });
    assert.equal(cfg.release, "collectables@2.4.1");
  });

  it("falls back to package.json version when EXPO_PUBLIC_APP_VERSION is unset", () => {
    const cfg = resolveSentryConfig({});
    assert.equal(cfg.release, `collectables@${APP_VERSION}`);
  });

  it("honours defaultRelease override when EXPO_PUBLIC_APP_VERSION is unset", () => {
    const cfg = resolveSentryConfig(
      {},
      { defaultRelease: "collectables@override" },
    );
    assert.equal(cfg.release, "collectables@override");
  });

  it("EXPO_PUBLIC_APP_VERSION takes precedence over defaultRelease", () => {
    const cfg = resolveSentryConfig(
      { EXPO_PUBLIC_APP_VERSION: "9.9.9" },
      { defaultRelease: "collectables@override" },
    );
    assert.equal(cfg.release, "collectables@9.9.9");
  });
});

describe("resolveTracesSampleRate", () => {
  it("defaults when unset or empty", () => {
    assert.equal(resolveTracesSampleRate(undefined), DEFAULT_TRACES_SAMPLE_RATE);
    assert.equal(resolveTracesSampleRate("   "), DEFAULT_TRACES_SAMPLE_RATE);
  });

  it("parses a valid in-range value (incl. the 0 and 1 bounds)", () => {
    assert.equal(resolveTracesSampleRate("0"), 0);
    assert.equal(resolveTracesSampleRate("1"), 1);
    assert.equal(resolveTracesSampleRate("0.25"), 0.25);
    assert.equal(resolveTracesSampleRate("  0.5  "), 0.5);
  });

  it("falls back to the default for out-of-range or non-numeric values", () => {
    assert.equal(resolveTracesSampleRate("-0.1"), DEFAULT_TRACES_SAMPLE_RATE);
    assert.equal(resolveTracesSampleRate("1.5"), DEFAULT_TRACES_SAMPLE_RATE);
    assert.equal(resolveTracesSampleRate("abc"), DEFAULT_TRACES_SAMPLE_RATE);
    assert.equal(resolveTracesSampleRate("NaN"), DEFAULT_TRACES_SAMPLE_RATE);
  });

  it("is threaded onto SentryConfig.tracesSampleRate", () => {
    assert.equal(resolveSentryConfig({}).tracesSampleRate, 0.1);
    assert.equal(
      resolveSentryConfig({
        EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "0.42",
      }).tracesSampleRate,
      0.42,
    );
    assert.equal(
      resolveSentryConfig({
        EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "9",
      }).tracesSampleRate,
      0.1,
    );
  });
});

describe("isValidSentryDsn", () => {
  it("accepts a canonical https DSN", () => {
    assert.equal(isValidSentryDsn("https://abc@o0.ingest.sentry.io/1"), true);
  });

  it("accepts a numeric-only project id and trims whitespace", () => {
    assert.equal(isValidSentryDsn("  https://k@host/123456  "), true);
  });

  it("rejects a Slack webhook pasted into the DSN slot", () => {
    assert.equal(
      isValidSentryDsn("https://hooks.slack.com/services/T00/B00/xyz"),
      false,
    );
  });

  it("rejects a DSN with no public key", () => {
    assert.equal(isValidSentryDsn("https://o0.ingest.sentry.io/1"), false);
  });

  it("rejects a DSN with a non-numeric project id", () => {
    assert.equal(isValidSentryDsn("https://abc@host/project"), false);
  });

  it("rejects an empty string", () => {
    assert.equal(isValidSentryDsn(""), false);
  });
});

describe("resolveSentryConfig — DSN validation gate", () => {
  it("disables the SDK when the DSN is present but malformed", () => {
    __resetSentryConfigWarningForTests();
    const original = console.error;
    const errs: string[] = [];
    console.error = (msg?: unknown) => {
      errs.push(String(msg));
    };
    try {
      const cfg = resolveSentryConfig({
        EXPO_PUBLIC_SENTRY_DSN: "https://hooks.slack.com/services/T/B/x",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      });
      assert.equal(cfg.enabled, false);
    } finally {
      console.error = original;
    }
    assert.equal(errs.length, 1);
    assert.match(errs[0], /malformed/i);
  });

  it("warns at most once across repeated malformed resolves", () => {
    __resetSentryConfigWarningForTests();
    const original = console.error;
    let count = 0;
    console.error = () => {
      count += 1;
    };
    try {
      const env = {
        EXPO_PUBLIC_SENTRY_DSN: "not-a-dsn",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      };
      resolveSentryConfig(env);
      resolveSentryConfig(env);
      resolveSentryConfig(env);
    } finally {
      console.error = original;
    }
    assert.equal(count, 1);
  });

  it("still enables the SDK for a valid production DSN (no warning)", () => {
    __resetSentryConfigWarningForTests();
    const original = console.error;
    let count = 0;
    console.error = () => {
      count += 1;
    };
    try {
      const cfg = resolveSentryConfig({
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      });
      assert.equal(cfg.enabled, true);
    } finally {
      console.error = original;
    }
    assert.equal(count, 0);
  });
});

describe("lib/sentry-config.ts purity", () => {
  it("does not import react-native or any RN module", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib", "sentry-config.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      src,
      /from\s+["']react-native["']/,
      "lib/sentry-config.ts must remain pure (no react-native import)",
    );
    assert.doesNotMatch(
      src,
      /from\s+["']@sentry\/react-native["']/,
      "lib/sentry-config.ts must not import the Sentry SDK directly",
    );
  });
});
