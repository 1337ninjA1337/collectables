import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { deriveConnectionState } from "@/lib/realtime-status-context";

/**
 * Pure tests for the shared realtime-status surface. The React provider
 * itself can't be exercised here (no DOM), so we cover:
 *   1. `deriveConnectionState` — the pure reducer that decides idle/
 *      connecting/online from the topic snapshot.
 *   2. Structural wiring — the layout actually mounts the provider, the
 *      marketplace screen actually renders the pill, and the pill imports
 *      from the shared context (so a future refactor that detaches the
 *      surface breaks loudly here instead of silently).
 */

describe("deriveConnectionState — pure status reducer", () => {
  it("returns 'idle' when no topics are tracked", () => {
    assert.equal(deriveConnectionState(new Map()), "idle");
  });

  it("returns 'connecting' when topics exist but none are SUBSCRIBED", () => {
    const m = new Map<string, boolean>([
      ["chat:inbox:user-a", false],
      ["marketplace-listings-changes", false],
    ]);
    assert.equal(deriveConnectionState(m), "connecting");
  });

  it("returns 'online' when at least one topic is SUBSCRIBED", () => {
    const m = new Map<string, boolean>([
      ["chat:inbox:user-a", false],
      ["marketplace-listings-changes", true],
    ]);
    assert.equal(deriveConnectionState(m), "online");
  });

  it("returns 'online' even when only one topic exists and it is SUBSCRIBED", () => {
    const m = new Map<string, boolean>([["chat:inbox:user-a", true]]);
    assert.equal(deriveConnectionState(m), "online");
  });

  it("treats a freshly-cleared snapshot as 'idle' (not 'connecting')", () => {
    // A previously-tracked topic that has just been released should leave the
    // snapshot empty, which must collapse back to idle — otherwise a screen
    // would render a stale "reconnecting" pill after sign-out drops every
    // channel via closeSharedRealtimeClient.
    const m = new Map<string, boolean>();
    assert.equal(deriveConnectionState(m), "idle");
  });
});

describe("realtime-status-context wiring", () => {
  const root = process.cwd();
  const layoutSource = readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");
  const marketplaceSource = readFileSync(path.join(root, "app", "marketplace.tsx"), "utf8");
  const pillSource = readFileSync(
    path.join(root, "components", "realtime-status-pill.tsx"),
    "utf8",
  );
  const contextSource = readFileSync(
    path.join(root, "lib", "realtime-status-context.tsx"),
    "utf8",
  );
  const registrySource = readFileSync(
    path.join(root, "lib", "realtime-channel-registry.ts"),
    "utf8",
  );

  it("app/_layout.tsx imports RealtimeStatusProvider", () => {
    assert.match(layoutSource, /from\s+"@\/lib\/realtime-status-context"/);
    assert.match(layoutSource, /RealtimeStatusProvider/);
  });

  it("app/_layout.tsx mounts <RealtimeStatusProvider> in the provider tree", () => {
    assert.match(layoutSource, /<RealtimeStatusProvider>/);
    assert.match(layoutSource, /<\/RealtimeStatusProvider>/);
  });

  it("RealtimeStatusProvider is mounted above AuthProvider so the pill survives sign-out churn", () => {
    // The pill needs to remain mounted across auth transitions; placing the
    // provider above AuthProvider keeps the status surface alive when the
    // auth subtree remounts.
    const providerIdx = layoutSource.indexOf("<RealtimeStatusProvider>");
    const authIdx = layoutSource.indexOf("<AuthProvider>");
    assert.ok(providerIdx > 0 && authIdx > 0);
    assert.ok(providerIdx < authIdx, "RealtimeStatusProvider must wrap AuthProvider");
  });

  it("marketplace screen renders the shared RealtimeStatusPill", () => {
    assert.match(
      marketplaceSource,
      /from\s+"@\/components\/realtime-status-pill"/,
    );
    assert.match(marketplaceSource, /<RealtimeStatusPill\s*\/>/);
  });

  it("the pill component pulls status from the shared context (not its own listener)", () => {
    // A reverted refactor that re-introduces a bespoke `subscribeToInbox`-style
    // status listener inside the pill would defeat the whole point of this
    // task: the registry already publishes status; the pill must read it.
    assert.match(pillSource, /useOptionalRealtimeStatus|useRealtimeStatus/);
    assert.doesNotMatch(
      pillSource,
      /subscribeToInbox|subscribeToListings|getSharedRealtimeClient/,
    );
  });

  it("the context subscribes to the registry's status emitter", () => {
    assert.match(contextSource, /subscribeRegistryStatus/);
    assert.match(contextSource, /getRegistryStatusSnapshot/);
  });

  it("the context exposes useRealtimeStatus + useOptionalRealtimeStatus", () => {
    assert.match(contextSource, /export\s+function\s+useRealtimeStatus/);
    assert.match(contextSource, /export\s+function\s+useOptionalRealtimeStatus/);
  });

  it("registry exports the status emitter API", () => {
    assert.match(registrySource, /export\s+function\s+subscribeRegistryStatus/);
    assert.match(registrySource, /export\s+function\s+getRegistryStatusSnapshot/);
    assert.match(registrySource, /export\s+type\s+RegistryStatusSnapshot/);
  });

  it("registry resets the status snapshot on __resetChannelRegistryForTests", () => {
    // Without this, a previous test's leftover topics would bleed into the
    // next test's listener and break the "initial snapshot is empty" guarantee.
    assert.match(
      registrySource,
      /__resetChannelRegistryForTests[\s\S]{0,200}statusSnapshot\s*=\s*new\s+Map/,
    );
    assert.match(
      registrySource,
      /__resetChannelRegistryForTests[\s\S]{0,400}statusListeners\s*=\s*new\s+Set/,
    );
  });
});
