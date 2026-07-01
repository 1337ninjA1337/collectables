import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initSentry,
  setSentryUser,
  __resetSentryForTests,
} from "../lib/sentry";

type Call = { method: string; args: unknown[] };

function makeFakeSdk() {
  const calls: Call[] = [];
  return {
    sdk: {
      init: (options: Record<string, unknown>) => {
        calls.push({ method: "init", args: [options] });
      },
      captureException: () => undefined,
      addBreadcrumb: () => undefined,
      setUser: (user: Record<string, unknown> | null) => {
        calls.push({ method: "setUser", args: [user] });
      },
    },
    calls,
  };
}

describe("setSentryUser — disabled paths", () => {
  beforeEach(() => __resetSentryForTests());

  it("is a no-op before initSentry()", () => {
    assert.doesNotThrow(() =>
      setSentryUser({ id: "u1", email: "a@b.c" }),
    );
  });

  it("is a no-op when SDK initialised but disabled (dev env)", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "development",
      },
      loader: async () => sdk,
    });
    setSentryUser({ id: "u1", email: "a@b.c" });
    const setUserCalls = calls.filter((c) => c.method === "setUser");
    assert.equal(setUserCalls.length, 0);
  });
});

describe("setSentryUser — enabled paths", () => {
  beforeEach(() => __resetSentryForTests());

  async function bootEnabled() {
    const fake = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => fake.sdk,
    });
    return fake;
  }

  it("forwards { id, email } to sdk.setUser", async () => {
    const { calls } = await bootEnabled();
    setSentryUser({ id: "u1", email: "a@b.c" });
    const last = calls[calls.length - 1];
    assert.equal(last.method, "setUser");
    assert.deepEqual(last.args[0], { id: "u1", email: "a@b.c" });
  });

  it("omits the email field when email is null", async () => {
    const { calls } = await bootEnabled();
    setSentryUser({ id: "u2", email: null });
    const last = calls[calls.length - 1];
    assert.deepEqual(last.args[0], { id: "u2" });
  });

  it("omits the email field when email is undefined", async () => {
    const { calls } = await bootEnabled();
    setSentryUser({ id: "u3" });
    const last = calls[calls.length - 1];
    assert.deepEqual(last.args[0], { id: "u3" });
  });

  it("forwards null on signOut to clear identity", async () => {
    const { calls } = await bootEnabled();
    setSentryUser({ id: "u1", email: "a@b.c" });
    setSentryUser(null);
    const last = calls[calls.length - 1];
    assert.equal(last.method, "setUser");
    assert.equal(last.args[0], null);
  });

  it("swallows SDK exceptions instead of rethrowing", async () => {
    __resetSentryForTests();
    const sdk = {
      init: () => undefined,
      captureException: () => undefined,
      addBreadcrumb: () => undefined,
      setUser: () => {
        throw new Error("sdk crashed");
      },
    };
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    assert.doesNotThrow(() => setSentryUser({ id: "u1", email: "a@b.c" }));
  });
});

describe("Crash #5 — auth-context wiring", () => {
  const src = readFileSync(
    path.join(process.cwd(), "lib", "auth-context.tsx"),
    "utf8",
  );

  it("imports setSentryUser from @/lib/sentry", () => {
    assert.match(
      src,
      /import\s*\{\s*setSentryUser\s*\}\s*from\s*["']@\/lib\/sentry["']/,
      "auth-context.tsx must import setSentryUser",
    );
  });

  it("subscribes to session changes via a useEffect that calls setSentryUser", () => {
    assert.match(
      src,
      /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?setSentryUser\(\s*\{\s*id:\s*session\.user\.id[\s\S]*?\}\s*\)[\s\S]*?\}\s*,\s*\[\s*session\?\.user\?\.id/,
      "auth-context.tsx must call setSentryUser({ id, email }) on session change",
    );
  });

  it("clears Sentry identity (setSentryUser(null)) when session becomes null", () => {
    assert.match(
      src,
      /setSentryUser\(\s*null\s*\)/,
      "auth-context.tsx must call setSentryUser(null) on signOut",
    );
  });
});
