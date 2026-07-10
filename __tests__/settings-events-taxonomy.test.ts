import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  getAnalyticsEventCatalog,
  type AnalyticsEventName,
} from "../lib/analytics";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
} from "../lib/analytics-events";

const settingsSrc = readFileSync(
  path.join(process.cwd(), "app", "settings.tsx"),
  "utf8",
);
const i18nSrc = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

describe("getAnalyticsEventCatalog", () => {
  it("returns one entry per taxonomy event, in sorted-name order", () => {
    const catalog = getAnalyticsEventCatalog();
    assert.deepEqual(
      catalog.map((e) => e.name),
      [...ANALYTICS_EVENT_NAMES],
    );
  });

  it("carries the taxonomy description and props verbatim — zero hardcoded copy", () => {
    for (const entry of getAnalyticsEventCatalog()) {
      const def = ANALYTICS_EVENTS[entry.name as AnalyticsEventName];
      assert.equal(entry.description, def.description);
      assert.deepEqual([...entry.props], [...def.props]);
      assert.ok(entry.description.length > 0);
      assert.ok(entry.props.length > 0);
    }
  });
});

describe("settings — Events captured by this app list", () => {
  it("shares the admin-or-dev gate with the DSN row", () => {
    assert.match(
      settingsSrc,
      /const showDsnInlinedRow = isDevEnvironment\(\) \|\| isAdmin/,
    );
    // The taxonomy block must be wrapped in the same gate variable.
    assert.match(
      settingsSrc,
      /\{showDsnInlinedRow && \(\s*<>\s*<Pressable[^]*?testID="diagnostics-events-toggle"/,
      "events list must render only behind the showDsnInlinedRow gate",
    );
  });

  it("derives the list from getAnalyticsEventCatalog, not a hardcoded copy", () => {
    assert.match(
      settingsSrc,
      /import \{ getAnalyticsEventCatalog \} from "@\/lib\/analytics"/,
      "settings must consume the taxonomy via lib/analytics.ts",
    );
    assert.doesNotMatch(
      settingsSrc,
      /@\/lib\/analytics-events/,
      "app code must not import the taxonomy module directly",
    );
    assert.match(settingsSrc, /eventCatalog\.map\(\(event\) =>/);
    assert.match(settingsSrc, /testID=\{`diagnostics-event-\$\{event\.name\}`\}/);
    assert.match(settingsSrc, /\{event\.description\}/);
    assert.match(settingsSrc, /\{event\.props\.join\(" · "\)\}/);
  });

  it("is collapsed behind an expandable toggle with a11y state", () => {
    assert.match(
      settingsSrc,
      /const \[eventsListOpen, setEventsListOpen\] = useState\(false\)/,
      "the list must start collapsed",
    );
    assert.match(
      settingsSrc,
      /accessibilityState=\{\{ expanded: eventsListOpen \}\}/,
    );
    assert.match(settingsSrc, /\{eventsListOpen &&\s*\n\s*eventCatalog\.map/);
  });

  it("has a diagnosticsEventsTitle translation in every language block", () => {
    const occurrences = i18nSrc.match(/diagnosticsEventsTitle:/g) ?? [];
    assert.equal(
      occurrences.length,
      6,
      "diagnosticsEventsTitle must exist in en, ru, be, pl, de, es",
    );
    assert.match(settingsSrc, /t\("diagnosticsEventsTitle"\)/);
  });
});
