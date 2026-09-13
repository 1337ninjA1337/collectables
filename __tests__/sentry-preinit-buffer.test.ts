import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  __resetSentryForTests,
  captureException,
  getSentryStatus,
  initSentry,
  setSentryOptOut,
  shutdownSentry,
} from "../lib/sentry";

/**
 * Captures taken before the SDK resolves, and what happens to them.
 *
 * The window used to be a few frames — the SDK was in the entry chunk and
 * `initSentry` only waited on a stored flag. `components/crash-boundary.web.tsx`
 * took it off the page load, so the wait is a network fetch now, and a crash
 * during startup is the one most worth keeping.
 *
 * Every case here is about a GATE as much as about the queue: a buffered event
 * is replayed only down the path that would have sent it live.
 */

const ENABLED_ENV = {
  EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
  EXPO_PUBLIC_SENTRY_ENV: "production",
};

type Call = { error: unknown; context?: Record<string, unknown> };

/** An SDK whose load can be held open, so "before init" is a real state. */
function makeHeldSdk() {
  const calls: Call[] = [];
  const sdk = {
    init: () => undefined,
    captureException: (error: unknown, context?: Record<string, unknown>) => {
      calls.push({ error, context });
    },
    addBreadcrumb: () => undefined,
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loader = async () => {
    await gate;
    return sdk;
  };
  return { calls, loader, release };
}

beforeEach(() => {
  __resetSentryForTests();
});

describe("captures taken before the SDK lands", () => {
  it("are replayed once init succeeds, oldest first", async () => {
    const { calls, loader, release } = makeHeldSdk();
    const booting = initSentry({ env: ENABLED_ENV, loader });

    captureException(new Error("first"), { scope: "crash-boundary" });
    captureException(new Error("second"));
    assert.equal(calls.length, 0, "nothing can be sent before the SDK exists");
    assert.equal(getSentryStatus().bufferedEvents, 2);

    release();
    await booting;

    assert.equal(calls.length, 2);
    assert.equal((calls[0].error as Error).message, "first");
    assert.equal((calls[1].error as Error).message, "second");
    assert.deepEqual(calls[0].context, { tags: { scope: "crash-boundary" } });
    assert.equal(getSentryStatus().bufferedEvents, 0);
  });

  it("are dropped when the user has opted out, not held for a later yes", async () => {
    const { calls, loader, release } = makeHeldSdk();
    const booting = initSentry({ env: ENABLED_ENV, loader });
    captureException(new Error("before the choice"));
    assert.equal(getSentryStatus().bufferedEvents, 1);

    // The user flips the diagnostics switch off while the chunk is in flight.
    setSentryOptOut(true);
    assert.equal(getSentryStatus().bufferedEvents, 0);

    release();
    await booting;
    assert.equal(calls.length, 0);
    setSentryOptOut(false);
  });

  it("are dropped when the config turns out to be disabled", async () => {
    // No DSN: `runInit` sets `activeConfig` and returns. Nothing queued was
    // ever going to be sent, so it is not kept for a retry that cannot come.
    const { calls, loader, release } = makeHeldSdk();
    const booting = initSentry({ env: {}, loader });
    captureException(new Error("no dsn"));
    release();
    await booting;

    assert.equal(calls.length, 0);
    assert.equal(getSentryStatus().bufferedEvents, 0);
  });

  it("are not queued at all once a disabled config has answered", async () => {
    await initSentry({ env: {}, loader: async () => makeHeldSdk().loader() });
    captureException(new Error("after the answer"));
    assert.equal(getSentryStatus().bufferedEvents, 0);
  });

  it("are dropped when the SDK fails to load", async () => {
    const failing = async () => {
      throw new Error("chunk 404");
    };
    captureException(new Error("during a doomed fetch"));
    await initSentry({ env: ENABLED_ENV, loader: failing });

    assert.equal(getSentryStatus().bufferedEvents, 0);
    assert.equal(getSentryStatus().reason, "init-failed");
  });

  it("do not survive a shutdown into the next session's init", async () => {
    const { calls, loader, release } = makeHeldSdk();
    const booting = initSentry({ env: ENABLED_ENV, loader });
    captureException(new Error("last session"));
    shutdownSentry();
    release();
    await booting;

    const second = makeHeldSdk();
    await initSentry({ env: ENABLED_ENV, loader: second.loader });
    second.release();

    assert.equal(calls.length, 0);
    assert.equal(second.calls.length, 0);
  });
});

describe("the buffer has a ceiling", () => {
  it("keeps the first events and counts what it refused", async () => {
    // A runaway render loop throws the same error thousands of times; the
    // first few are the ones that say what broke.
    const { calls, loader, release } = makeHeldSdk();
    const booting = initSentry({ env: ENABLED_ENV, loader });
    for (let i = 0; i < 25; i += 1) captureException(new Error(`e${String(i)}`));

    const status = getSentryStatus();
    assert.equal(status.bufferedEvents, 20);
    assert.equal(status.bufferOverflowed, 5);

    release();
    await booting;
    assert.equal(calls.length, 20);
    assert.equal((calls[0].error as Error).message, "e0");
    assert.equal((calls[19].error as Error).message, "e19");
    assert.equal(getSentryStatus().bufferOverflowed, 0);
  });
});

describe("what the queue does not change", () => {
  it("a live capture still goes straight out", async () => {
    const { calls, loader, release } = makeHeldSdk();
    const booting = initSentry({ env: ENABLED_ENV, loader });
    release();
    await booting;

    captureException(new Error("live"));
    assert.equal(calls.length, 1);
    assert.equal(getSentryStatus().bufferedEvents, 0);
  });

  it("an opted-out capture is not even queued", () => {
    setSentryOptOut(true);
    captureException(new Error("never"));
    assert.equal(getSentryStatus().bufferedEvents, 0);
    setSentryOptOut(false);
  });
});
