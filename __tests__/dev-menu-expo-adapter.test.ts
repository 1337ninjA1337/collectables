import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { adaptExpoDevMenu, registerDevMenu } from "../lib/dev-menu";

describe("adaptExpoDevMenu", () => {
  it("returns null when the module is missing or has no registerDevMenuItems", () => {
    assert.equal(adaptExpoDevMenu(null), null);
    assert.equal(adaptExpoDevMenu(undefined), null);
    assert.equal(adaptExpoDevMenu({}), null);
    assert.equal(
      adaptExpoDevMenu({ registerDevMenuItems: "not a function" as unknown as undefined }),
      null,
    );
  });

  it("adapts the real expo-dev-menu API into the addDevMenuItems shape", () => {
    type Item = { name: string; callback: () => void; shouldCollapse?: boolean };
    const received: Item[] = [];
    const fakePackage = {
      registerDevMenuItems: (items: Item[]) => {
        received.push(...items);
        return Promise.resolve();
      },
    };

    const adapter = adaptExpoDevMenu(fakePackage);
    assert.ok(adapter, "adapter must be non-null when registerDevMenuItems exists");
    assert.equal(typeof adapter!.addDevMenuItems, "function");

    let invoked = 0;
    adapter!.addDevMenuItems!({
      "Clear runtime Supabase config": () => {
        invoked += 1;
      },
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].name, "Clear runtime Supabase config");
    assert.equal(typeof received[0].callback, "function");
    received[0].callback();
    assert.equal(invoked, 1);
  });

  it("plugs into registerDevMenu so labelled actions reach expo-dev-menu", () => {
    const captured: Array<{ name: string; callback: () => void }> = [];
    const fakePackage = {
      registerDevMenuItems: (items: Array<{ name: string; callback: () => void }>) => {
        captured.push(...items);
      },
    };
    const devMenu = adaptExpoDevMenu(fakePackage);

    let invoked = 0;
    const result = registerDevMenu({
      isDev: true,
      globalScope: null,
      devMenu,
      actions: {
        clearRuntimeSupabaseConfig: {
          label: "Clear runtime Supabase config",
          run: () => {
            invoked += 1;
          },
        },
      },
    });

    assert.equal(result.devMenuRegistered, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].name, "Clear runtime Supabase config");
    captured[0].callback();
    assert.equal(invoked, 1);
  });
});

describe("expo-dev-menu peer dep + plugin wiring", () => {
  it("declares expo-dev-menu in package.json dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    assert.ok(
      pkg.dependencies && typeof pkg.dependencies["expo-dev-menu"] === "string",
      "expo-dev-menu must be listed as a runtime dependency for the native DevMenu path",
    );
  });

  it("registers expo-dev-menu in the app.json plugins array", () => {
    const appJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "app.json"), "utf8"),
    ) as { expo?: { plugins?: Array<string | [string, unknown]> } };
    const plugins = appJson.expo?.plugins ?? [];
    const flat = plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    assert.ok(
      flat.includes("expo-dev-menu"),
      "app.json expo.plugins must include 'expo-dev-menu' so prebuild wires the native module",
    );
  });
});
