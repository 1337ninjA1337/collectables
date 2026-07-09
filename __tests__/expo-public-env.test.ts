import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { readAnalyticsEnvFromProcess, ANALYTICS_ENV_VAR_NAMES } from "../lib/analytics-config";
import { readCloudinaryEnvFromProcess, CLOUDINARY_ENV_VAR_NAMES } from "../lib/cloudinary-config";
import {
  __resetExpoPublicEnvWarningsForTests,
  makeExpoPublicEnvReader,
  type ExpoPublicEnv,
} from "../lib/expo-public-env";
import { readSentryEnvFromProcess, SENTRY_ENV_VAR_NAMES } from "../lib/sentry-config";

afterEach(() => {
  __resetExpoPublicEnvWarningsForTests();
  mock.restoreAll();
});

describe("makeExpoPublicEnvReader", () => {
  it("returns the producer's object when keys match the declared tuple", () => {
    const read = makeExpoPublicEnvReader("test-module", ["EXPO_PUBLIC_A", "EXPO_PUBLIC_B"], () => ({
      EXPO_PUBLIC_A: "a",
      EXPO_PUBLIC_B: undefined,
    }));
    assert.deepStrictEqual(read(), { EXPO_PUBLIC_A: "a", EXPO_PUBLIC_B: undefined });
  });

  it("does not warn when keys match", () => {
    const warn = mock.method(console, "warn", () => {});
    const read = makeExpoPublicEnvReader("test-module", ["EXPO_PUBLIC_A"], () => ({
      EXPO_PUBLIC_A: undefined,
    }));
    read();
    assert.equal(warn.mock.callCount(), 0);
  });

  it("warns (once) when the producer's keys drift from the tuple, but still returns the object", () => {
    const warn = mock.method(console, "warn", () => {});
    const lyingProducer = (() => ({
      EXPO_PUBLIC_A: "a",
      EXPO_PUBLIC_EXTRA: "oops",
    })) as unknown as () => ExpoPublicEnv<readonly ["EXPO_PUBLIC_A"]>;
    const read = makeExpoPublicEnvReader("drift-module", ["EXPO_PUBLIC_A"], lyingProducer);
    const env = read();
    read();
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /drift-module/);
    assert.match(String(warn.mock.calls[0].arguments[0]), /EXPO_PUBLIC_EXTRA/);
    assert.equal((env as Record<string, string | undefined>).EXPO_PUBLIC_A, "a");
  });

  it("warns again for a different module label", () => {
    const warn = mock.method(console, "warn", () => {});
    const lie = (() => ({})) as unknown as () => ExpoPublicEnv<readonly ["EXPO_PUBLIC_A"]>;
    makeExpoPublicEnvReader("module-one", ["EXPO_PUBLIC_A"], lie)();
    makeExpoPublicEnvReader("module-two", ["EXPO_PUBLIC_A"], lie)();
    assert.equal(warn.mock.callCount(), 2);
  });
});

describe("config modules use the shared reader with exact tuple parity", () => {
  const cases = [
    ["sentry", SENTRY_ENV_VAR_NAMES, readSentryEnvFromProcess],
    ["analytics", ANALYTICS_ENV_VAR_NAMES, readAnalyticsEnvFromProcess],
    ["cloudinary", CLOUDINARY_ENV_VAR_NAMES, readCloudinaryEnvFromProcess],
  ] as const;

  for (const [label, names, read] of cases) {
    it(`${label}: reader keys equal the declared tuple and never warn`, () => {
      const warn = mock.method(console, "warn", () => {});
      const keys = Object.keys(read()).sort();
      assert.deepStrictEqual(keys, [...names].sort());
      assert.equal(warn.mock.callCount(), 0);
    });

    it(`${label}: every declared name is an EXPO_PUBLIC_ var`, () => {
      for (const name of names) {
        assert.match(name, /^EXPO_PUBLIC_[A-Z0-9_]+$/);
      }
    });
  }
});
