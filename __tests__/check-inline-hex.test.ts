import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  HEX_ALLOWLIST,
  INLINE_HEX_PATTERN,
  INLINE_HEX_SHORT_PATTERN,
  findInlineHexLiterals,
  formatGitHubAnnotations,
  formatHexReport,
  isHexAllowlisted,
} from "../lib/check-inline-hex";
import { LINT_GUARDS } from "../lib/lint-guards";

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

  it("does NOT match bare 3-digit shorthand — that is the short pattern's job", () => {
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

describe("INLINE_HEX_SHORT_PATTERN", () => {
  const fresh = () => new RegExp(INLINE_HEX_SHORT_PATTERN.source, "g");

  it("matches quoted 3-digit shorthand in every quote style", () => {
    assert.deepEqual('color: "#fff",'.match(fresh()), ['"#fff"']);
    assert.deepEqual("color: '#abc',".match(fresh()), ["'#abc'"]);
    assert.deepEqual("`#0aF`".match(fresh()), ["`#0aF`"]);
  });

  it("matches quoted 4-digit alpha shorthand", () => {
    assert.deepEqual('"#fffa"'.match(fresh()), ['"#fffa"']);
  });

  it("does NOT match unquoted shorthand (comment prose stays exempt)", () => {
    // Doc blocks legitimately mention #fff or issue refs like #15b in prose;
    // an actual RN style value is always a string literal.
    assert.equal("the #fff shorthand".match(fresh()), null);
    assert.equal("Analytics #15b) helper".match(fresh()), null);
  });

  it("does NOT match mismatched quotes or quoted 6-digit literals", () => {
    assert.equal("\"#fff'".match(fresh()), null);
    // Quoted 6-digit is the main pattern's territory — no double-report.
    assert.equal('"#aabbcc"'.match(fresh()), null);
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

  it("flags quoted 3-digit shorthand with column on the # (not the quote)", () => {
    const source = '  color: "#fff",';
    const matches = findInlineHexLiterals("foo.tsx", source);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].value, "#fff");
    assert.equal(matches[0].column, source.indexOf("#") + 1);
  });

  it("sorts mixed 6-digit and shorthand matches by column within a line", () => {
    const source = '  borderColor: "#abc", backgroundColor: "#123456",';
    const matches = findInlineHexLiterals("foo.tsx", source);
    assert.deepEqual(
      matches.map((m) => m.value),
      ["#abc", "#123456"],
    );
    assert.ok(matches[0].column < matches[1].column);
  });

  it("does NOT flag shorthand mentions in comment prose", () => {
    const source = "// the #fff shorthand and task #15b are prose, not styles";
    assert.deepEqual(findInlineHexLiterals("foo.tsx", source), []);
  });

  it("flags JSX-literal gradient stops (<LinearGradient colors={[...]}>)", () => {
    // The scanner is line-based, not StyleSheet-based, so inline JSX hex
    // arrays are caught too — pinned here so a future "only scan
    // StyleSheet.create blocks" refactor can't silently open this backdoor.
    const source = '      <LinearGradient colors={["#001122", "#334455"]} start={{ x: 0, y: 0 }} />';
    const matches = findInlineHexLiterals("foo.tsx", source);
    assert.deepEqual(
      matches.map((m) => m.value),
      ["#001122", "#334455"],
    );
  });

  it("flags shorthand gradient stops in JSX via the short pattern", () => {
    const source = '      <LinearGradient colors={["#abc", "#def"]} />';
    const matches = findInlineHexLiterals("foo.tsx", source);
    assert.deepEqual(
      matches.map((m) => m.value),
      ["#abc", "#def"],
    );
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

describe("formatGitHubAnnotations", () => {
  it("returns empty array for no matches", () => {
    assert.deepEqual(formatGitHubAnnotations([]), []);
  });

  it("emits one ::error workflow command per finding with file/line/col", () => {
    const out = formatGitHubAnnotations([
      { file: "app/foo.tsx", line: 12, column: 5, value: "#aabbcc" },
      { file: "components/bar.tsx", line: 3, column: 9, value: "#fff" },
    ]);
    assert.equal(out.length, 2);
    assert.equal(
      out[0],
      "::error file=app/foo.tsx,line=12,col=5::Inline hex literal #aabbcc — route it through a named export from lib/design-tokens.ts",
    );
    assert.match(out[1], /^::error file=components\/bar\.tsx,line=3,col=9::/);
    assert.match(out[1], /#fff/);
  });

  it("escapes workflow-command metacharacters in properties and message", () => {
    const [out] = formatGitHubAnnotations([
      // A path carrying every property metacharacter (%, :, ,) — impossible
      // for real repo files, but the escaping must never corrupt the command.
      { file: "app/a:b,c%.tsx", line: 1, column: 1, value: "#abcdef" },
    ]);
    assert.match(out, /^::error file=app\/a%3Ab%2Cc%25\.tsx,line=1,col=1::/);
  });
});

describe("check-inline-hex script wiring", () => {
  it("scripts/check-inline-hex.ts imports the pure helpers from lib/check-inline-hex", () => {
    const src = read("scripts/check-inline-hex.ts");
    assert.match(src, /from\s+"\.\.\/lib\/check-inline-hex"/);
    assert.match(src, /\bfindInlineHexLiterals\b/);
    assert.match(src, /\bformatHexReport\b/);
  });

  it("scripts/check-inline-hex.ts scans app/, components/ AND lib/", () => {
    const src = read("scripts/check-inline-hex.ts");
    // The SCAN_ROOTS literal — keep the test loose enough to survive a future
    // refactor (e.g. adding `hooks/`) but strict enough to catch a missing root.
    assert.match(src, /["']app["']/);
    assert.match(src, /["']components["']/);
    assert.match(src, /["']lib["']/);
  });

  it("scripts/check-inline-hex.ts exits with code 1 on findings", () => {
    const src = read("scripts/check-inline-hex.ts");
    assert.match(src, /process\.exit\(1\)/);
  });

  it("scripts/check-inline-hex.ts emits PR annotations under GitHub Actions", () => {
    const src = read("scripts/check-inline-hex.ts");
    assert.match(src, /\bformatGitHubAnnotations\b/);
    // Gated on the Actions env so local runs stay noise-free.
    assert.match(src, /GITHUB_ACTIONS/);
  });

  it("scripts/check-inline-hex.ts walks .ts AND .tsx files", () => {
    // The walker matches both extensions so utility modules that hard-code
    // a color value are caught too (the intentional producers are exempted
    // via HEX_ALLOWLIST instead of being skipped by extension).
    const src = read("scripts/check-inline-hex.ts");
    assert.match(src, /\\\.tsx\?\$/);
  });

  it("allowlisted files are skipped by the matcher itself", () => {
    const source = 'const PALETTE = ["#8B6F5E"];';
    assert.equal(
      findInlineHexLiterals("lib/placeholder-color.ts", source).length,
      0,
    );
    // The same source under a NON-allowlisted path still flags.
    assert.equal(findInlineHexLiterals("lib/new-util.ts", source).length, 1);
  });

  it("every allowlist entry exists on disk and actually carries hex literals", () => {
    // A stale entry (file deleted/renamed or migrated to tokens) must be
    // pruned so the exemption surface never outgrows its justification.
    for (const rel of HEX_ALLOWLIST) {
      assert.ok(isHexAllowlisted(rel));
      const source = read(rel);
      const re = new RegExp(INLINE_HEX_PATTERN.source, "g");
      assert.ok(
        re.test(source),
        `${rel} is allowlisted but carries no hex literal — remove the stale entry`,
      );
    }
  });

  it("package.json wires lint:hex and the lint:all registry enforces it", () => {
    const raw = read("package.json");
    const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
    assert.equal(typeof pkg.scripts["lint:hex"], "string");
    assert.match(pkg.scripts["lint:hex"], /scripts\/check-inline-hex\.ts/);
    // Registry membership means lint:ci and the ci.yml "Code-style guards"
    // step both run the guard via the lint:all aggregator (wiring pinned
    // in lint-guards.test.ts).
    assert.ok(LINT_GUARDS.some((g) => g.npmScript === "lint:hex"));
  });

  it("app/**, components/** and lib/** are clean today (regression baseline)", () => {
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
        else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          const rel = path.relative(REPO_ROOT, full);
          allMatches.push(...findInlineHexLiterals(rel, source));
        }
      }
    };
    walk(path.join(REPO_ROOT, "app"));
    walk(path.join(REPO_ROOT, "components"));
    walk(path.join(REPO_ROOT, "lib"));
    assert.deepEqual(
      allMatches,
      [],
      `unexpected inline hex literals in app/**, components/** or lib/**:\n${formatHexReport(allMatches)}`,
    );
  });
});
