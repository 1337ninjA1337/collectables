import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  findAnalyticsEventsImports,
  formatAnalyticsImportReport,
} from "../lib/check-analytics-imports";

const ROOT = process.cwd();

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("findAnalyticsEventsImports — matcher", () => {
  it("flags the alias import, relative paths, require and dynamic import", () => {
    const cases = [
      'import { ANALYTICS_EVENTS } from "@/lib/analytics-events";',
      'import type { AnalyticsEventDefinition } from "../lib/analytics-events";',
      'export { ANALYTICS_EVENT_NAMES } from "@/lib/analytics-events";',
      'const mod = require("@/lib/analytics-events");',
      'const mod = await import("@/lib/analytics-events");',
      'import x from "@/lib/analytics-events.ts";',
    ];
    for (const src of cases) {
      assert.equal(
        findAnalyticsEventsImports("app/x.tsx", src).length,
        1,
        `must flag: ${src}`,
      );
    }
  });

  it("does not flag longer module names or unrelated imports", () => {
    const clean = [
      'import { trackEvent } from "@/lib/analytics";',
      'import { helper } from "@/lib/analytics-helpers";',
      'import { m } from "./analytics-events-migration";',
      'const label = "analytics-events";',
    ];
    for (const src of clean) {
      assert.equal(
        findAnalyticsEventsImports("app/x.tsx", src).length,
        0,
        `must NOT flag: ${src}`,
      );
    }
  });

  it("ignores commented-out imports but reports real ones with line numbers", () => {
    const src = [
      '// import { ANALYTICS_EVENTS } from "@/lib/analytics-events";',
      "const a = 1;",
      'import { ANALYTICS_EVENTS } from "@/lib/analytics-events";',
    ].join("\n");
    const matches = findAnalyticsEventsImports("app/x.tsx", src);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 3);
  });

  it("formats a report naming file:line and stays empty when clean", () => {
    const report = formatAnalyticsImportReport([
      { file: "app/settings.tsx", line: 7, snippet: "import ..." },
    ]);
    assert.match(report, /app\/settings\.tsx:7/);
    assert.match(report, /lib\/analytics\.ts/);
    assert.equal(formatAnalyticsImportReport([]), "");
  });
});

describe("lint:analytics-imports — wiring", () => {
  const pkg = read("package.json");
  const ci = read(".github/workflows/ci.yml");

  it("package.json declares the script and chains it into lint:ci", () => {
    assert.match(
      pkg,
      /"lint:analytics-imports":\s*"tsx scripts\/check-analytics-imports\.ts"/,
    );
    assert.match(pkg, /lint:ci[^\n]*npm run lint:analytics-imports/);
  });

  it("ci.yml runs the gate as a blocking step", () => {
    assert.match(ci, /run:\s*npm run lint:analytics-imports/);
    const step = ci.slice(ci.indexOf("No direct analytics-events imports"));
    assert.ok(
      !/continue-on-error/.test(step.slice(0, 200)),
      "the CI step must be blocking",
    );
  });

  it("lib/analytics.ts remains the only runtime UI gateway (real-tree sample)", () => {
    // The CLI scans app/ + components/ recursively; sample the two screens
    // that consume the taxonomy today to keep this suite filesystem-cheap.
    for (const rel of ["app/settings.tsx", "app/_layout.tsx"]) {
      assert.equal(
        findAnalyticsEventsImports(rel, read(rel)).length,
        0,
        `${rel} must consume the taxonomy via lib/analytics.ts`,
      );
    }
  });
});
