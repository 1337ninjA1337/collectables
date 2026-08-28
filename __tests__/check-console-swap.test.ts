import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSOLE_SWAP,
  CONSOLE_SWAP_FIXTURES,
  CONSOLE_SWAP_PROBE,
  CONSOLE_SWAP_SUBJECT,
  consoleSwapFixture,
  findConsoleSwaps,
  formatConsoleSwapReport,
} from "../lib/check-console-swap";
import { LINT_GUARDS } from "../lib/lint-guards";

import { readRepoFile as read } from "./helpers/repo-file";
import { SUITES_REL } from "./helpers/suite-files";

/**
 * `"console"`, kept out of this file as a literal.
 *
 * This suite has to write the banned form to test the matcher, and
 * `__tests__/default-console-seams.test.ts` bans exactly that form across every
 * top-level suite with no exemption list. Building each fixture through this
 * constant keeps both rules true at once. The shared table now carries the
 * lines that BOTH suites walk; what is left here is the per-property loop,
 * which is derived from a list of names rather than fixed.
 */
const C = "console";

/**
 * The suite-only ban, given the two directories the suite sweep cannot see.
 *
 * `__tests__/default-console-seams.test.ts` has banned the hand-rolled console
 * swap since the capture helper landed, and it sweeps `__tests__/` because that
 * is where the helper's adopters live. Nothing in `app/`, `components/`, `lib/`
 * or `scripts/` swaps a console method — and nothing said it may not, which is
 * the difference between a tree that is clean and a tree that is kept clean.
 * The rule now runs in `lint:all`, which is the output a contributor reads
 * before a test run.
 */
describe("findConsoleSwaps — matcher", () => {
  it("flags the dotted form on any property, not on an enumerated list", () => {
    // `dir`, `table` and `group` are the point. The dotted half used to name
    // six streams while the bracket half beside it matched anything between
    // the brackets — one pattern, two answers to "what is the rule", and the
    // narrower half was the one a `console.dir = () => {}` walked through. The
    // rule is assigning to the global console at all; the seven names here are
    // a sample of the property space, not the space.
    for (const method of [
      "log",
      "error",
      "warn",
      "info",
      "debug",
      "trace",
      "dir",
      "table",
      "group",
      "somethingNodeAddsNextYear",
    ]) {
      const source = `${C}.${method} = () => {};`;
      assert.equal(
        findConsoleSwaps("lib/x.ts", source).length,
        1,
        `must flag: ${source}`,
      );
    }
  });

  it("reaches the stated verdict on every line of the shared fixture table", () => {
    // Both sides of the rule, walked here through the scanner and in
    // __tests__/default-console-seams.test.ts through the pattern. The two
    // suites used to keep their own lists — this one pinned the read form, the
    // comparison form and the wrapper form, the ban's pinned three lines
    // chosen to be the ones a widening would break — so a rule that grew could
    // break one list and leave the other green. One table, two walks.
    for (const fixture of CONSOLE_SWAP_FIXTURES) {
      assert.equal(
        findConsoleSwaps("lib/x.ts", fixture.line).length,
        fixture.offends ? 1 : 0,
        `${fixture.offends ? "must flag" : "must not flag"} ${fixture.why}: ${fixture.line}`,
      );
    }
  });

  it("has a fixture table with both sides on it, so neither walk is vacuous", () => {
    // The premise the two walks rest on. A table that lost its must-not-match
    // half is a table both suites still pass, having asserted nothing about
    // over-reading — which is the failure the shared table exists to prevent.
    const offenders = CONSOLE_SWAP_FIXTURES.filter((f) => f.offends);
    const innocents = CONSOLE_SWAP_FIXTURES.filter((f) => !f.offends);
    assert.ok(
      offenders.length >= 5,
      `the must-match half of the table is down to ${offenders.length} lines`,
    );
    assert.ok(
      innocents.length >= 5,
      `the must-not-match half of the table is down to ${innocents.length} lines`,
    );
    assert.equal(
      new Set(CONSOLE_SWAP_FIXTURES.map((f) => f.line)).size,
      CONSOLE_SWAP_FIXTURES.length,
      "the table lists a line twice, so one of the counts above is padded",
    );
  });

  it("flags the global under a qualified name, because the identifier ENDS at console", () => {
    // `\bconsole` reads as "the identifier must be exactly console" and says
    // "the identifier must END at console" — so `window.console.log = x` and
    // `globalThis.console.warn = x` are offenders (correctly: both ARE the
    // global) while `myconsole.log = x` is not. The table carries all three;
    // this names the asymmetry, because it is the half a reader gets wrong.
    assert.equal(
      findConsoleSwaps("lib/x.ts", `window.${consoleSwapFixture("log")}`).length,
      1,
    );
    assert.equal(
      findConsoleSwaps("lib/x.ts", `globalThis.${consoleSwapFixture("warn")}`)
        .length,
      1,
    );
    assert.equal(
      findConsoleSwaps("lib/x.ts", `my${consoleSwapFixture("log")}`).length,
      0,
    );
  });

  it("does not flag a whole line of default seams, which is the shape it argues for", () => {
    // The table's rows are one construct apiece; this is the crowded line the
    // rule meets in real code, where three reads sit inside an object literal
    // whose own `=` is nowhere near a console property.
    assert.deepEqual(
      findConsoleSwaps(
        "lib/x.ts",
        `const streams = { warn: ${C}.warn, log: ${C}.log, error: ${C}.error };`,
      ),
      [],
    );
  });

  it("ignores comments, so a rule can be explained where it is enforced", () => {
    const source = [
      `// never write ${C}.warn = () => {} here`,
      `/** Not this either: ${C}.error = noop; */`,
      "const ok = true;",
    ].join("\n");
    assert.deepEqual(findConsoleSwaps("lib/x.ts", source), []);
  });

  it("names the file and the 1-indexed line", () => {
    const swap = `${C}.warn = () => {};`;
    const source = ["const a = 1;", "", swap].join("\n");
    assert.deepEqual(findConsoleSwaps("scripts/x.ts", source), [
      { file: "scripts/x.ts", line: 3, snippet: swap },
    ]);
  });

  it("carries no `g` flag, because it is `.test`ed once per line", () => {
    // `.test` on a global pattern advances `lastIndex` between calls, so a
    // shared pattern skips every other line and the sweep goes green having
    // read half of each file. The scanner calls `.test` per line, which is
    // exactly that hazard — asserted here rather than left to the doc comment,
    // because the sibling rule one directory over has a case for the same
    // property and this one had a paragraph.
    assert.equal(CONSOLE_SWAP.global, false);
    assert.equal(CONSOLE_SWAP.sticky, false);
    const repeated = Array.from({ length: 4 }, () => `${C}.warn = noop;`);
    assert.equal(findConsoleSwaps("lib/x.ts", repeated.join("\n")).length, 4);
  });
});

describe("the guard's own positive control", () => {
  it("flags the probe, which is what lets a clean tree mean anything", () => {
    // A ban is satisfied by a pattern that has stopped matching at all, and a
    // clean tree looks identical either way. There is no file outside
    // __tests__/ that legitimately does the banned thing, so the guard carries
    // its own offender and checks it before vouching for the tree.
    assert.equal(findConsoleSwaps("<probe>", CONSOLE_SWAP_PROBE).length, 1);
  });

  it("keeps the probe out of the scanned source of its own module", () => {
    // The alternative to splitting the literal was exempting
    // lib/check-console-swap.ts from a sweep that walks lib/ — a hole in the
    // shape of a whole file, and the one place a genuine swap could then hide.
    assert.deepEqual(
      findConsoleSwaps(
        "lib/check-console-swap.ts",
        read("lib/check-console-swap.ts"),
      ),
      [],
      "the declaring module now trips its own rule, so the sweep it is part of needs an exemption covering every line in it",
    );
  });

  it("is run by the wrapper before it reports a clean tree", () => {
    // Order matters: a control checked after the report is a control on a run
    // that has already said the tree is clean.
    const wrapper = read("scripts/check-console-swap.ts");
    const probeAt = wrapper.indexOf("CONSOLE_SWAP_PROBE");
    // Anchored on the fragment the pass line still writes out, since the
    // subject itself is now interpolated from CONSOLE_SWAP_SUBJECT and its
    // first occurrence in this file is the import.
    const cleanAt = wrapper.indexOf("no assignments to");
    assert.ok(probeAt !== -1, "the wrapper no longer runs the probe");
    assert.ok(
      probeAt < cleanAt,
      "the wrapper reports a clean tree before checking that its scanner still matches anything",
    );
  });
});

describe("formatConsoleSwapReport", () => {
  it("says nothing when there is nothing to report", () => {
    assert.equal(formatConsoleSwapReport("check-console-swap", []), "");
  });

  it("names every offender and points at the seam that replaces it", () => {
    const report = formatConsoleSwapReport("check-console-swap", [
      { file: "lib/a.ts", line: 4, snippet: `${C}.warn = noop;` },
      { file: "app/b.tsx", line: 9, snippet: `${C}.log = collect;` },
    ]);
    assert.ok(report.includes("lib/a.ts:4"), report);
    assert.ok(report.includes("app/b.tsx:9"), report);
    assert.ok(
      report.includes("2 assignment(s)"),
      `the report does not count the offenders: ${report}`,
    );
    assert.ok(
      report.includes("injected writer") &&
        report.includes("captureConsole"),
      `the report does not name the two seams a reader should reach for: ${report}`,
    );
  });
});

describe("the guard is enforced rather than merely written", () => {
  it("is registered with lint:all, so lint:ci runs it", () => {
    const guard = LINT_GUARDS.find(
      (entry) => entry.npmScript === "lint:console-swap",
    );
    assert.ok(guard !== undefined, "lint:console-swap is not in LINT_GUARDS");
    assert.equal(guard.scriptPath, "scripts/check-console-swap.ts");
  });

  it("says what the rule is in the same words everywhere it is said", () => {
    // Four strings state this rule: the scanner's heading, the wrapper's
    // clean-tree line, the wrapper's probe refusal and the registry blurb.
    // Three of them interpolate CONSOLE_SWAP_SUBJECT; the fourth cannot,
    // because LINT_GUARDS is a pure data module that imports no guard and
    // inverting that for one phrase would grow its imports with the guard
    // count. So the fourth is asserted here instead of remembered.
    const guard = LINT_GUARDS.find(
      (entry) => entry.npmScript === "lint:console-swap",
    );
    assert.ok(guard !== undefined);
    assert.ok(
      guard.description.includes(CONSOLE_SWAP_SUBJECT),
      `the registry blurb no longer says "${CONSOLE_SWAP_SUBJECT}": ${guard.description}`,
    );
    // And the three that do interpolate it still reach the reader with the
    // phrase in them — a constant renamed to something else would compile.
    assert.ok(
      formatConsoleSwapReport("check-console-swap", [
        { file: "lib/a.ts", line: 1, snippet: consoleSwapFixture("warn") },
      ]).includes(CONSOLE_SWAP_SUBJECT),
    );
    const wrapper = read("scripts/check-console-swap.ts");
    assert.equal(
      wrapper.split("CONSOLE_SWAP_SUBJECT").length - 1,
      3,
      "the wrapper no longer states the rule through the shared subject in both its pass line and its probe refusal",
    );
  });

  it("does not sweep __tests__/, which has the sharper rule", () => {
    // The suites are the one place the swap is legitimate — the capture helper
    // does exactly this, deliberately, in one file. Sweeping them here would
    // mean carrying an exemption for a rule already enforced next door, with
    // the positive control this walk cannot borrow.
    const wrapper = read("scripts/check-console-swap.ts");
    assert.doesNotMatch(
      wrapper.slice(wrapper.indexOf("const SCANNED_DIRS")),
      new RegExp(`"${SUITES_REL}"`),
      "the guard walks __tests__/, where the capture helper legitimately swaps a console method",
    );
  });
});
