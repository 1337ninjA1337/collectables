import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { captureTimers, withCapturedTimers } from "./helpers/capture-timers";

/**
 * The harness that answers "what did this schedule?", checked against itself.
 *
 * It is worth its own suite for one reason: it swaps two globals, and the
 * failure mode of getting that wrong is not a red case here. It is a red case
 * in whatever file `tsx --test` happens to run next, wearing a message about
 * that file's own timers. The restore is the assertion that cannot be left to
 * the callers.
 *
 * The rest is the small contract two suites now depend on: a cleared timer
 * stops being live, a run timer stops being live too (a real `setTimeout` does
 * not stay armed after it fires), and `scheduled` keeps everything so a case
 * can count what was armed as well as what survived.
 */

describe("captureTimers puts the globals back", () => {
  it("restores setTimeout and clearTimeout when the body returns", async () => {
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    await withCapturedTimers(() => {
      assert.notEqual(globalThis.setTimeout, realSet, "the capture was never installed");
    });
    assert.equal(globalThis.setTimeout, realSet);
    assert.equal(globalThis.clearTimeout, realClear);
  });

  it("restores them when the body THROWS, which is the case that matters", async () => {
    // An assertion failing inside the window is the normal way a case ends,
    // and a hand-written `restore()` on the last line of a body is exactly the
    // thing that does not run when it does.
    const realSet = globalThis.setTimeout;
    await assert.rejects(
      withCapturedTimers(() => {
        throw new Error("assertion inside the window");
      }),
      /assertion inside the window/,
    );
    assert.equal(globalThis.setTimeout, realSet);
  });

  it("restores them when an AWAIT inside the body rejects", async () => {
    const realSet = globalThis.setTimeout;
    await assert.rejects(
      withCapturedTimers(async () => {
        await Promise.reject(new Error("async failure"));
      }),
      /async failure/,
    );
    assert.equal(globalThis.setTimeout, realSet);
  });

  it("is idempotent, so a double restore cannot install a stub as the real one", async () => {
    // Two captures nested by accident, each restoring twice, would otherwise
    // hand the outer one's stub back as `globalThis.setTimeout` forever.
    const realSet = globalThis.setTimeout;
    const timers = captureTimers();
    timers.restore();
    timers.restore();
    assert.equal(globalThis.setTimeout, realSet);
  });

  it("returns whatever the body returned", async () => {
    assert.equal(await withCapturedTimers(() => 41 + 1), 42);
    assert.equal(await withCapturedTimers(async () => "settled"), "settled");
  });
});

describe("what captureTimers reports", () => {
  it("records every timer in schedule order, with its delay", async () => {
    await withCapturedTimers((timers) => {
      setTimeout(() => {}, 10);
      setTimeout(() => {}, 300);
      assert.deepEqual(timers.liveDelays(), [10, 300]);
      assert.equal(timers.scheduled.length, 2);
    });
  });

  it("stops reporting a cleared timer as live, and keeps it in scheduled", async () => {
    // Both halves: a case that asserts "none standing" needs the first, and a
    // case that asserts "one per keystroke was armed" needs the second.
    await withCapturedTimers((timers) => {
      const handle = setTimeout(() => {}, 10);
      setTimeout(() => {}, 300);
      clearTimeout(handle);
      assert.deepEqual(timers.liveDelays(), [300]);
      assert.equal(timers.scheduled.length, 2);
    });
  });

  it("runs the callback once and retires the entry", async () => {
    // A fired timeout is not armed any more. An entry that kept reporting
    // itself live would make "and nothing is left over" pass on a component
    // that re-armed and fail on one that did not.
    await withCapturedTimers((timers) => {
      const ran: string[] = [];
      setTimeout(() => ran.push("fired"), 10);
      timers.live()[0].run();
      assert.deepEqual(ran, ["fired"]);
      assert.deepEqual(timers.live(), []);
    });
  });

  it("survives a clearTimeout for a handle it never issued", async () => {
    // Code under test can clear a handle from before the capture went in — a
    // module-level timer, or a ref held across cases. A throw there would be a
    // failure about the harness wearing the subject's name.
    await withCapturedTimers((timers) => {
      assert.doesNotThrow(() => clearTimeout(999 as unknown as ReturnType<typeof setTimeout>));
      assert.deepEqual(timers.scheduled, []);
    });
  });

  it("does not see timers scheduled after the restore", async () => {
    const timers = captureTimers();
    timers.restore();
    const handle = setTimeout(() => {}, 10);
    clearTimeout(handle);
    assert.deepEqual(timers.scheduled, []);
  });
});
