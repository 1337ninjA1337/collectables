import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  type AnalyticsEventDefinition,
} from "../lib/analytics-events";
import type { AnalyticsEventName } from "../lib/analytics";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const EXPECTED_NAMES: readonly AnalyticsEventName[] = [
  "signup_completed",
  "collection_created",
  "item_added",
  "item_photo_attached",
  "listing_created",
  "listing_claimed",
  "chat_opened",
  "friend_requested",
  "premium_activated",
  "language_switched",
];

describe("ANALYTICS_EVENTS — taxonomy contents", () => {
  it("covers every event name from Analytics #4..#10", () => {
    const keys = Object.keys(ANALYTICS_EVENTS).sort();
    const expected = [...EXPECTED_NAMES].sort();
    assert.deepStrictEqual(keys, expected);
  });

  it("every entry has a non-empty description", () => {
    for (const [name, def] of Object.entries(ANALYTICS_EVENTS)) {
      assert.equal(
        typeof def.description,
        "string",
        `${name}.description must be a string`,
      );
      assert.ok(
        def.description.trim().length > 0,
        `${name}.description must be non-empty`,
      );
    }
  });

  it("every entry has at least one allowed prop", () => {
    for (const [name, def] of Object.entries(ANALYTICS_EVENTS)) {
      assert.ok(
        Array.isArray(def.props),
        `${name}.props must be an array`,
      );
      assert.ok(
        def.props.length > 0,
        `${name}.props must list at least one prop key (got 0)`,
      );
    }
  });

  it("every prop key is a non-empty snake_case-or-camelCase identifier", () => {
    const valid = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    for (const [name, def] of Object.entries(ANALYTICS_EVENTS)) {
      for (const prop of def.props) {
        assert.match(
          prop,
          valid,
          `${name}.props contains invalid identifier "${prop}"`,
        );
      }
    }
  });

  it("prop keys within an event are unique", () => {
    for (const [name, def] of Object.entries(ANALYTICS_EVENTS)) {
      const set = new Set(def.props);
      assert.equal(
        set.size,
        def.props.length,
        `${name}.props contains duplicates`,
      );
    }
  });
});

describe("ANALYTICS_EVENT_NAMES — sorted view", () => {
  it("contains every key from ANALYTICS_EVENTS", () => {
    const fromObject = Object.keys(ANALYTICS_EVENTS).sort();
    assert.deepStrictEqual([...ANALYTICS_EVENT_NAMES], fromObject);
  });

  it("is sorted alphabetically", () => {
    const sorted = [...ANALYTICS_EVENT_NAMES].slice().sort();
    assert.deepStrictEqual([...ANALYTICS_EVENT_NAMES], sorted);
  });

  it("is frozen so consumers cannot mutate it accidentally", () => {
    assert.equal(Object.isFrozen(ANALYTICS_EVENT_NAMES), true);
  });
});

describe("ANALYTICS_EVENTS — parity with AnalyticsEventName union", () => {
  it("every union member has a taxonomy entry (compile-time + runtime check)", () => {
    // Compile-time: this satisfies type-check only if every AnalyticsEventName
    // exists as a key in ANALYTICS_EVENTS. A new union member added without a
    // taxonomy entry would fail `tsc --noEmit`.
    const _exhaustive: Record<AnalyticsEventName, AnalyticsEventDefinition> =
      ANALYTICS_EVENTS;
    void _exhaustive;
    // Runtime: every expected name resolves to a definition object.
    for (const name of EXPECTED_NAMES) {
      const def = ANALYTICS_EVENTS[name];
      assert.ok(def, `ANALYTICS_EVENTS missing entry for "${name}"`);
    }
  });

  it("every taxonomy key is also referenced as a literal in lib/analytics.ts AnalyticsEventName union", () => {
    const src = read("lib/analytics.ts");
    for (const key of Object.keys(ANALYTICS_EVENTS)) {
      assert.match(
        src,
        new RegExp(`["']${key}["']`),
        `lib/analytics.ts AnalyticsEventName union must include "${key}"`,
      );
    }
  });
});

describe("lib/analytics-events — purity", () => {
  it("does not import react-native or platform SDKs", () => {
    const src = read("lib/analytics-events.ts");
    assert.doesNotMatch(
      src,
      /from\s+["'](react-native|@react-native|posthog-react-native|posthog-js)/,
      "lib/analytics-events.ts must remain pure so non-RN tests + the Power BI schema doc tooling can import it without a metro shim",
    );
  });

  it("only imports the AnalyticsEventName type from lib/analytics", () => {
    const src = read("lib/analytics-events.ts");
    // The import must be type-only or import only AnalyticsEventName so the
    // taxonomy module stays free of the SDK-loader runtime side effects.
    assert.match(
      src,
      /import\s+type\s*\{\s*AnalyticsEventName\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "lib/analytics-events.ts must use a type-only import for AnalyticsEventName",
    );
  });
});
