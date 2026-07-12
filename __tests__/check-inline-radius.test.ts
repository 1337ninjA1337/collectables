import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  findInlineRadiusLiterals,
  formatRadiusReport,
} from "../lib/check-inline-radius";

const ROOT = process.cwd();

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("findInlineRadiusLiterals — matcher", () => {
  it("flags StyleSheet and JSX-inline pill-radius literals", () => {
    const cases = [
      "const s = StyleSheet.create({ chip: { borderRadius: 999 } });",
      "const s = { borderRadius: 999, padding: 4 };",
      '<View style={{ borderRadius: 999 }} />',
      "chip: {\n  borderRadius:999,\n},",
    ];
    for (const src of cases) {
      assert.equal(
        findInlineRadiusLiterals("app/x.tsx", src).length,
        1,
        `must flag: ${src}`,
      );
    }
  });

  it("does not flag token usage, other radii, or 999-prefixed values", () => {
    const clean = [
      "chip: { borderRadius: RADIUS_PILL },",
      "card: { borderRadius: 22 },",
      "weird: { borderRadius: 9990 },",
      "const height = 999;",
    ];
    for (const src of clean) {
      assert.equal(
        findInlineRadiusLiterals("app/x.tsx", src).length,
        0,
        `must NOT flag: ${src}`,
      );
    }
  });

  it("ignores commented-out literals but reports real ones with line numbers", () => {
    const src = [
      "// borderRadius: 999 used to live here",
      "/* borderRadius: 999 */",
      "chip: {",
      "  borderRadius: 999,",
      "},",
    ].join("\n");
    const matches = findInlineRadiusLiterals("app/x.tsx", src);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 4);
    assert.equal(matches[0].snippet, "borderRadius: 999,");
  });

  it("formats a report naming file:line and stays empty when clean", () => {
    const report = formatRadiusReport([
      { file: "app/settings.tsx", line: 7, snippet: "borderRadius: 999," },
    ]);
    assert.match(report, /app\/settings\.tsx:7/);
    assert.match(report, /RADIUS_PILL/);
    assert.equal(formatRadiusReport([]), "");
  });
});

describe("lint:radius — wiring", () => {
  const pkg = read("package.json");
  const ci = read(".github/workflows/ci.yml");

  it("package.json declares the script and chains it into lint:ci", () => {
    assert.match(
      pkg,
      /"lint:radius":\s*"tsx scripts\/check-inline-radius\.ts"/,
    );
    assert.match(pkg, /lint:ci[^\n]*npm run lint:radius/);
  });

  it("ci.yml runs the gate as a blocking step", () => {
    assert.match(ci, /run:\s*npm run lint:radius/);
    const step = ci.slice(ci.indexOf("No inline pill-radius literals"));
    assert.ok(
      !/continue-on-error/.test(step.slice(0, 200)),
      "the CI step must be blocking",
    );
  });

  it("the real tree stays clean (heaviest migrated screens sampled)", () => {
    // The CLI scans app/ + components/ recursively; sample the screens with
    // the highest pre-migration counts to keep this suite filesystem-cheap.
    for (const rel of [
      "app/settings.tsx",
      "app/item/[id].tsx",
      "components/item-filters.tsx",
    ]) {
      assert.equal(
        findInlineRadiusLiterals(rel, read(rel)).length,
        0,
        `${rel} must route pill radii through RADIUS_PILL`,
      );
    }
  });
});
