import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";

import { readSource, sourceFiles } from "./helpers/source-files";

/**
 * Walks every `trackEvent("...")` call site in app code and asserts the
 * first-arg literal is a registered event name. The type system already
 * enforces this at compile time against the `AnalyticsEventName` union, but
 * the event *metadata* lives separately in `lib/analytics-events.ts` — this
 * regex-level parity test catches a rename that updates the union (and thus
 * compiles) while the events registry, Power BI schema doc, and privacy
 * disclosure still describe the old name.
 */

const SCAN_ROOTS = ["app", "components", "lib", "data"] as const;

function collectCallSites(): { file: string; line: number; name: string }[] {
  const sites: { file: string; line: number; name: string }[] = [];
  for (const file of sourceFiles(...SCAN_ROOTS)) {
    const lines = readSource(file).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const re = /trackEvent\(\s*"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lines[i])) !== null) {
        sites.push({ file, line: i + 1, name: m[1] });
      }
    }
  }
  return sites;
}

describe("analytics call-site ↔ events-registry parity", () => {
  const sites = collectCallSites();
  const registered = new Set(Object.keys(ANALYTICS_EVENTS));

  it("finds the known call sites (guards the scanner itself)", () => {
    assert.ok(
      sites.length >= 10,
      `expected at least 10 trackEvent call sites, found ${sites.length} — did the scanner roots or the call pattern change?`,
    );
  });

  it("every trackEvent literal is registered in ANALYTICS_EVENTS", () => {
    for (const site of sites) {
      assert.ok(
        registered.has(site.name),
        `${site.file}:${site.line} tracks "${site.name}" which is missing from lib/analytics-events.ts — update the registry (and regenerate the Power BI schema doc)`,
      );
    }
  });

  it("every registered event is fired from at least one call site", () => {
    const fired = new Set(sites.map((s) => s.name));
    for (const name of registered) {
      assert.ok(
        fired.has(name),
        `ANALYTICS_EVENTS declares "${name}" but no app code fires it — dead registry entries drift into the privacy disclosure and dashboards`,
      );
    }
  });
});
