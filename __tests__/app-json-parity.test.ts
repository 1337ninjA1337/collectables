import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Generic app.json plugin/extra parity walker.
 *
 * Some Expo config plugins require the same values to be declared twice in
 * app.json: once as the plugin's config (`expo.plugins` array entry) and once
 * under `expo.extra.<key>` for runtime/tooling access (Sentry today; a future
 * Reanimated/Notifications block would follow the same shape). Hand-editing
 * one side and forgetting the other is silent config drift — the build uses
 * one value, the runtime another.
 *
 * This suite pairs every object-valued `expo.extra.<key>` block with the
 * plugin whose package name contains that key and asserts every field
 * present on BOTH sides is identical. New paired plugins get the guard for
 * free; nothing needs registering here.
 */

const ROOT = join(__dirname, "..");
const appJson = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8")) as {
  expo: {
    plugins?: Array<string | [string, Record<string, unknown>?]>;
    extra?: Record<string, unknown>;
  };
};

type PluginEntry = { name: string; config: Record<string, unknown> | null };

/** Normalise every expo.plugins entry into {name, config}. Exported shape kept local — test-only. */
function pluginEntries(): PluginEntry[] {
  return (appJson.expo.plugins ?? []).map((p) =>
    typeof p === "string"
      ? { name: p, config: null }
      : { name: p[0], config: (p[1] as Record<string, unknown>) ?? null },
  );
}

/**
 * Pair `expo.extra.<key>` blocks with plugins whose package name contains the
 * key (case-insensitive): `sentry` ↔ `@sentry/react-native/expo`,
 * a future `reanimated` ↔ `react-native-reanimated`, etc.
 */
function parityPairs(): Array<{
  key: string;
  extra: Record<string, unknown>;
  plugin: PluginEntry;
}> {
  const extra = appJson.expo.extra ?? {};
  const plugins = pluginEntries();
  const pairs: Array<{
    key: string;
    extra: Record<string, unknown>;
    plugin: PluginEntry;
  }> = [];
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const plugin = plugins.find((p) =>
      p.name.toLowerCase().includes(key.toLowerCase()),
    );
    if (plugin) {
      pairs.push({ key, extra: value as Record<string, unknown>, plugin });
    }
  }
  return pairs;
}

describe("app.json plugin/extra parity (generic walker)", () => {
  it("finds at least the sentry pairing (walker must never silently no-op)", () => {
    const pairs = parityPairs();
    assert.ok(
      pairs.some((p) => p.key === "sentry"),
      "expected expo.extra.sentry to pair with the @sentry/react-native/expo plugin — if the block was intentionally removed, update this test",
    );
  });

  it("every paired plugin declares a config object to compare against", () => {
    for (const { key, plugin } of parityPairs()) {
      assert.ok(
        plugin.config,
        `plugin '${plugin.name}' paired with expo.extra.${key} must use the [name, {…}] array form so duplicated fields are comparable`,
      );
    }
  });

  it("fields duplicated between a plugin config and its expo.extra block are identical", () => {
    for (const { key, extra, plugin } of parityPairs()) {
      if (!plugin.config) continue;
      const shared = Object.keys(extra).filter((f) => f in plugin.config!);
      assert.ok(
        shared.length > 0,
        `expo.extra.${key} and plugin '${plugin.name}' share no fields — either the duplication is gone (drop the extra block) or a field was renamed on one side only`,
      );
      for (const field of shared) {
        assert.deepEqual(
          plugin.config[field],
          extra[field],
          `app.json drift: plugins['${plugin.name}'].${field} !== expo.extra.${key}.${field}`,
        );
      }
    }
  });
});
