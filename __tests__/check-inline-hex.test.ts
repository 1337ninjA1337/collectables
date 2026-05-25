import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  INLINE_HEX_PATTERN,
  findInlineHexLiterals,
  formatHexReport,
} from "../lib/check-inline-hex";

const REPO_ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("INLINE_HEX_PATTERN", () => {
  it("matches 6-digit hex literals", () => {
    const re = new RegExp(INLINE_HEX_PATTERN.source, "g");
    const m = "#abcdef".match(re);
    assert.deepEqual(m, ["#abcdef"]);
  });

  it("matches uppercase + mixed case", () => {
    const re = new RegExp(INLINE_HEX_PATTERN.source, "g");
    const m = "#ABCDEF #aB12cD".match(re);
    assert.deepEqual(m, ["#ABCDEF", "#aB12cD"]);
  });

  it("does NOT match 3-digit shorthand (#fff)", () => {
    // Deliberately preserved per the migration call-outs — tagBadgeText, etc.
    const re = new RegExp(INLINE_HEX_PATTERN.source, "g");
    assert.equal("#fff".match(re), null);
    assert.equal("#abc".match(re), null);
  });

  it("does NOT match rgba() literals", () => {
    // Pending the OVERLAY_* family with withAlpha() helper.
    const re = new RegExp(INLINE_HEX_PATTERN.source, "g");
    assert.equal("rgba(38, 27, 20, 0.55)".match(re), null);
  });

  it("does NOT match 4-, 5-, 7-, or 8-digit forms", () => {
    const re = new RegExp(INLINE_HEX_PATTERN.source, "g");
    // 7-digit input still produces a 6-digit match (greedy {6})
    // so we test with explicit boundaries.
    assert.deepEqual("#abcd".match(re), null);
    assert.deepEqual("#abcde".match(re), null);
    // 7+ chars: the regex still finds the leading 6 — by design, since
    // `#abcdefg` is almost always a typo for a 6-digit token anyway.
    const sevenMatch = "#abcdef0".match(re);
    assert.deepEqual(sevenMatch, ["#abcdef"]);
  });
});

describe("findInlineHexLiterals", () => {
  it("returns empty array for source with no hex literals", () => {
    const matches = findInlineHexLiterals("foo.tsx", "const x = 1;\nimport {} from '@/lib/design-tokens';");
    assert.deepEqual(matches, []);
  });

  it("returns one entry per occurrence with 1-indexed line + column", () => {
    const source = ['import {} from "react-native";', '  backgroundColor: "#d8c7b1",'].join("\n");
    const matches = findInlineHexLiterals("foo.tsx", source);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].file, "foo.tsx");
    assert.equal(matches[0].line, 2);
    assert.equal(matches[0].value, "#d8c7b1");
    // Column is 1-indexed and points at the leading `#`.
    assert.equal(matches[0].column, source.split("\n")[1].indexOf("#") + 1);
  });

  it("captures multiple hex literals on the same line", () => {
    const source = '  borderColor: "#abcdef", backgroundColor: "#123456",';
    const matches = findInlineHexLiterals("foo.tsx", source);
    assert.equal(matches.length, 2);
    assert.equal(matches[0].value, "#abcdef");
    assert.equal(matches[1].value, "#123456");
    assert.equal(matches[0].line, 1);
    assert.equal(matches[1].line, 1);
    // Distinct columns.
    assert.notEqual(matches[0].column, matches[1].column);
  });

  it("captures hex literals across multiple lines", () => {
    const source = ["", "#aaaaaa", "", "#bbbbbb"].join("\n");
    const matches = findInlineHexLiterals("foo.tsx", source);
    assert.equal(matches.length, 2);
    assert.equal(matches[0].line, 2);
    assert.equal(matches[1].line, 4);
  });

  it("does not stash state between calls (the `g` flag pitfall)", () => {
    const src = '  color: "#deadbe",';
    const first = findInlineHexLiterals("a.tsx", src);
    const second = findInlineHexLiterals("a.tsx", src);
    assert.deepEqual(first, second, "subsequent calls must return identical results");
  });
});

describe("formatHexReport", () => {
  it("returns empty string for no matches", () => {
    assert.equal(formatHexReport([]), "");
  });

  it("groups matches by file and lists line:column value", () => {
    const report = formatHexReport([
      { file: "a.tsx", line: 1, column: 5, value: "#aaaaaa" },
      { file: "a.tsx", line: 4, column: 12, value: "#bbbbbb" },
      { file: "b.tsx", line: 2, column: 3, value: "#cccccc" },
    ]);
    assert.match(report, /Found 3 inline hex literal/);
    assert.match(report, /a\.tsx/);
    assert.match(report, /b\.tsx/);
    assert.match(report, /1:5\s+#aaaaaa/);
    assert.match(report, /4:12\s+#bbbbbb/);
    assert.match(report, /2:3\s+#cccccc/);
    // Points readers at the design-tokens convention.
    assert.match(report, /lib\/design-tokens\.ts/);
  });
});

describe("check-inline-hex script wiring", () => {
  it("scripts/check-inline-hex.ts imports the pure helpers from lib/check-inline-hex", () => {
    const src = read("scripts/check-inline-hex.ts");
    assert.match(src, /from\s+"\.\.\/lib\/check-inline-hex"/);
    assert.match(src, /\bfindInlineHexLiterals\b/);
    assert.match(src, /\bformatHexReport\b/);
  });

  it("scripts/check-inline-hex.ts scans both app/ and components/", () => {
    const src = read("scripts/check-inline-hex.ts");
    // The SCAN_ROOTS literal — keep the test loose enough to survive a future
    // refactor (e.g. adding `hooks/`) but strict enough to catch a missing root.
    assert.match(src, /["']app["']/);
    assert.match(src, /["']components["']/);
  });

  it("scripts/check-inline-hex.ts exits with code 1 on findings", () => {
    const src = read("scripts/check-inline-hex.ts");
    assert.match(src, /process\.exit\(1\)/);
  });

  it("scripts/check-inline-hex.ts walks only .tsx files", () => {
    // The walker uses .tsx suffix matching so it skips .ts/.json/.md
    // (those don't carry inline JSX style hex values).
    const src = read("scripts/check-inline-hex.ts");
    assert.match(src, /\.tsx/);
  });

  it("package.json wires lint:hex and lint:ci runs it before tests", () => {
    const raw = read("package.json");
    const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
    assert.equal(typeof pkg.scripts["lint:hex"], "string");
    assert.match(pkg.scripts["lint:hex"], /scripts\/check-inline-hex\.ts/);
    // lint:ci must call lint:hex so a regression fails CI before tests run.
    assert.match(pkg.scripts["lint:ci"], /lint:hex/);
  });

  it("ci.yml runs the lint:hex step", () => {
    const src = read(".github/workflows/ci.yml");
    assert.match(src, /lint:hex/);
  });

  it("app/** and components/** are clean today (regression baseline)", () => {
    // Empirical guard: re-runs the full scan against the working tree so a
    // PR that adds a stray inline hex fails this test even before CI runs.
    // We use Node fs directly rather than spawning the script to keep the
    // test fast and free of process management.
    const fs = require("node:fs") as typeof import("node:fs");
    const allMatches: { file: string; line: number; column: number; value: string }[] = [];
    const walk = (dir: string): void => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && full.endsWith(".tsx")) {
          const source = fs.readFileSync(full, "utf8");
          const rel = path.relative(REPO_ROOT, full);
          allMatches.push(...findInlineHexLiterals(rel, source));
        }
      }
    };
    walk(path.join(REPO_ROOT, "app"));
    walk(path.join(REPO_ROOT, "components"));
    assert.deepEqual(
      allMatches,
      [],
      `unexpected inline hex literals in app/** or components/**:\n${formatHexReport(allMatches)}`,
    );
  });
});
