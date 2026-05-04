import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { registerDevMenu } from "../lib/dev-menu";

describe("registerDevMenu", () => {
  it("does nothing in production builds", () => {
    const scope: Record<string, unknown> = {};
    let devMenuCalls = 0;
    const result = registerDevMenu({
      isDev: false,
      globalScope: scope,
      devMenu: { addDevMenuItems: () => { devMenuCalls += 1; } },
      actions: { clearRuntimeSupabaseConfig: () => {} },
    });
    assert.equal(result.devMenuRegistered, false);
    assert.deepEqual(result.globalsAttached, []);
    assert.equal(devMenuCalls, 0);
    assert.deepEqual(Object.keys(scope), []);
  });

  it("registers DevMenu items and global helpers in dev", () => {
    const scope: Record<string, unknown> = {};
    let registered: Record<string, () => void> | null = null;
    let invoked = 0;
    const action = () => { invoked += 1; };

    const result = registerDevMenu({
      isDev: true,
      globalScope: scope,
      devMenu: { addDevMenuItems: (items) => { registered = items; } },
      actions: { clearRuntimeSupabaseConfig: action },
    });

    assert.equal(result.devMenuRegistered, true);
    assert.deepEqual(result.globalsAttached, ["__clearRuntimeSupabaseConfig"]);
    assert.ok(registered, "expected DevMenu to be registered");
    assert.equal(typeof scope.__clearRuntimeSupabaseConfig, "function");
    (scope.__clearRuntimeSupabaseConfig as () => void)();
    assert.equal(invoked, 1);
  });

  it("falls back to global helpers when expo-dev-menu is unavailable", () => {
    const scope: Record<string, unknown> = {};
    const result = registerDevMenu({
      isDev: true,
      globalScope: scope,
      devMenu: null,
      actions: { clearRuntimeSupabaseConfig: () => {} },
    });
    assert.equal(result.devMenuRegistered, false);
    assert.deepEqual(result.globalsAttached, ["__clearRuntimeSupabaseConfig"]);
    assert.equal(typeof scope.__clearRuntimeSupabaseConfig, "function");
  });

  it("does not throw when DevMenu registration fails", () => {
    const scope: Record<string, unknown> = {};
    const result = registerDevMenu({
      isDev: true,
      globalScope: scope,
      devMenu: { addDevMenuItems: () => { throw new Error("not wired up"); } },
      actions: { clearRuntimeSupabaseConfig: () => {} },
    });
    assert.equal(result.devMenuRegistered, false);
    assert.deepEqual(result.globalsAttached, ["__clearRuntimeSupabaseConfig"]);
  });

  it("supports a custom global prefix", () => {
    const scope: Record<string, unknown> = {};
    const result = registerDevMenu({
      isDev: true,
      globalScope: scope,
      devMenu: null,
      actions: { ping: () => {} },
      globalPrefix: "$dev_",
    });
    assert.deepEqual(result.globalsAttached, ["$dev_ping"]);
    assert.equal(typeof scope.$dev_ping, "function");
  });

  it("skips global attachment when no global scope is provided", () => {
    const result = registerDevMenu({
      isDev: true,
      globalScope: null,
      devMenu: { addDevMenuItems: () => {} },
      actions: { ping: () => {} },
    });
    assert.equal(result.devMenuRegistered, true);
    assert.deepEqual(result.globalsAttached, []);
  });
});
