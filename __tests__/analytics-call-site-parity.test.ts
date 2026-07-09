import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";

/**
 * Walks every `trackEvent("...")` call site in app code and asserts the
 * first-arg literal is a registered event name. The type system already
 * enforces this at compile time against the `AnalyticsEventName` union, but
 * the event *metadata* lives separately in `lib/analytics-events.ts` — this
 * regex-level parity test catches a rename that updates the union (and thus
 * compiles) while the events registry, Power BI schema doc, and privacy
 * disclosure still describe the old name.
 */

const ROOT = path.join(__dirname, "..");
const SCAN_ROOTS = ["app", "components", "lib", "data"];

function walkSources(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
}

function collectCallSites(): { file: string; line: number; name: string }[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walkSources(path.join(ROOT, root), files);
  const sites: { file: string; line: number; name: string }[] = [];
  for (const file of files.sort()) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const re = /trackEvent\(\s*"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lines[i])) !== null) {
        sites.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          name: m[1],
        });
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
