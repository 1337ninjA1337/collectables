import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  createIdentifyScheduler,
  DEFAULT_IDENTIFY_DEBOUNCE_MS,
} from "../lib/identify-scheduler";

type Call = { userId: string; traits?: unknown };

function makeHarness(debounceMs?: number) {
  const identifies: Call[] = [];
  let resets = 0;
  const scheduler = createIdentifyScheduler({
    identify: (userId, traits) => void identifies.push({ userId, traits }),
    reset: () => void resets++,
    debounceMs,
  });
  return { scheduler, identifies, getResets: () => resets };
}

describe("createIdentifyScheduler", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  it("defaults the window to 500ms", () => {
    assert.equal(DEFAULT_IDENTIFY_DEBOUNCE_MS, 500);
    const { identifies } = (() => {
      const h = makeHarness();
      h.scheduler.update("u1", { language: "ru" });
      mock.timers.tick(499);
      assert.equal(h.identifies.length, 0, "must not fire before the window");
      mock.timers.tick(1);
      return h;
    })();
    assert.equal(identifies.length, 1);
  });

  it("collapses two rapid updates into exactly one identify (Strict-Mode double-mount invariant)", () => {
    const { scheduler, identifies } = makeHarness(500);
    scheduler.update("u1", { language: "ru", isPremium: false });
    scheduler.update("u1", { language: "ru", isPremium: true });
    mock.timers.tick(500);
    assert.equal(identifies.length, 1, "double-schedule must fire once");
    assert.deepEqual(identifies[0], {
      userId: "u1",
      traits: { language: "ru", isPremium: true },
    });
  });

  it("only the settled traits fire — earlier values within the window are dropped", () => {
    const { scheduler, identifies } = makeHarness(500);
    scheduler.update("u1", { language: "ru" });
    mock.timers.tick(300);
    scheduler.update("u1", { language: "en" });
    mock.timers.tick(499);
    assert.equal(identifies.length, 0, "re-arm must restart the window");
    mock.timers.tick(1);
    assert.equal(identifies.length, 1);
    assert.deepEqual(identifies[0].traits, { language: "en" });
  });

  it("fires separate identifies for changes settled outside the window", () => {
    const { scheduler, identifies } = makeHarness(500);
    scheduler.update("u1", { isPremium: false });
    mock.timers.tick(500);
    scheduler.update("u1", { isPremium: true });
    mock.timers.tick(500);
    assert.equal(identifies.length, 2);
  });

  it("update(null) after a fired identify resets synchronously (not debounced)", () => {
    const { scheduler, identifies, getResets } = makeHarness(500);
    scheduler.update("u1");
    mock.timers.tick(500);
    assert.equal(identifies.length, 1);
    scheduler.update(null);
    assert.equal(getResets(), 1, "reset must fire without any tick");
  });

  it("update(null) cancelling a pending identify leaves no phantom identity — no reset, no identify", () => {
    const { scheduler, identifies, getResets } = makeHarness(500);
    scheduler.update("u1", { language: "ru" });
    scheduler.update(null); // signed out inside the window
    mock.timers.tick(1000);
    assert.equal(identifies.length, 0, "cancelled identify must never fire");
    assert.equal(getResets(), 0, "nothing was identified, nothing to reset");
  });

  it("does not reset twice for repeated update(null)", () => {
    const { scheduler, getResets } = makeHarness(500);
    scheduler.update("u1");
    mock.timers.tick(500);
    scheduler.update(null);
    scheduler.update(null);
    assert.equal(getResets(), 1);
  });

  it("dispose cancels the pending identify (unmount cleanup)", () => {
    const { scheduler, identifies } = makeHarness(500);
    scheduler.update("u1");
    scheduler.dispose();
    mock.timers.tick(1000);
    assert.equal(identifies.length, 0);
  });

  it("a new sign-in after sign-out identifies the new user", () => {
    const { scheduler, identifies, getResets } = makeHarness(500);
    scheduler.update("u1");
    mock.timers.tick(500);
    scheduler.update(null);
    scheduler.update("u2", { language: "pl" });
    mock.timers.tick(500);
    assert.equal(getResets(), 1);
    assert.equal(identifies.length, 2);
    assert.equal(identifies[1].userId, "u2");
  });
});
