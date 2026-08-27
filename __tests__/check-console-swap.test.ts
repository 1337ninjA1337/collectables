import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSOLE_SWAP,
  CONSOLE_SWAP_PROBE,
  findConsoleSwaps,
  formatConsoleSwapReport,
} from "../lib/check-console-swap";
import { LINT_GUARDS } from "../lib/lint-guards";

import { readRepoFile as read } from "./helpers/repo-file";
import { SUITES_REL } from "./helpers/suite-files";

/**
 * `"console"`, kept out of the fixtures as a literal.
 *
 * This suite has to write the banned form to test the matcher, and
 * `__tests__/default-console-seams.test.ts` bans exactly that form across every
 * top-level suite with no exemption list. Building each fixture through this
 * constant keeps both rules true at once, and it is the same trick
 * `CONSOLE_SWAP_PROBE` uses for the same reason one directory over.
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

  it("flags the bracket form, which a loop over method names writes", () => {
    // The spelling the suite ban had to learn the hard way: a rule that knew
    // only the dotted form is dodged by a bracket that means the same thing,
    // and the computed form is exactly what a `for (const method of …)` writes.
    for (const source of [
      `${C}["warn"] = noop;`,
      `${C}[method] = collect;`,
      `${C} [ method ] = collect;`,
    ]) {
      assert.equal(
        findConsoleSwaps("lib/x.ts", source).length,
        1,
        `must flag: ${source}`,
      );
    }
  });

  it("does not flag a comparison, however many equals signs it has", () => {
    for (const source of [
      `if (${C}.warn === undefined) return;`,
      `if (${C}.warn !== original) throw new Error("swapped");`,
      `const swapped = ${C}[method] === undefined;`,
    ]) {
      assert.deepEqual(
        findConsoleSwaps("lib/x.ts", source),
        [],
        `must not flag: ${source}`,
      );
    }
  });

  it("does not flag an identifier that merely ENDS in the word", () => {
    // Reachable only since the dotted half widened to any property: without
    // the `\b`, `myconsole.log = noop` — a local wrapper being configured
    // rather than the global being replaced — was an offender the report could
    // only describe as one. Nothing in this tree is named that way, which is
    // why the first person to do it would have found this.
    for (const source of [
      `const my${C} = {}; my${C}.log = () => {};`,
      `fake${C}["warn"] = collect;`,
    ]) {
      assert.deepEqual(
        findConsoleSwaps("lib/x.ts", source),
        [],
        `must not flag: ${source}`,
      );
    }
    // And the global still is, on the same line shape.
    assert.equal(findConsoleSwaps("lib/x.ts", `${C}.log = () => {};`).length, 1);
  });

  it("does not flag READING a console method, which is the seam it argues for", () => {
    // The whole point of the rule is to push callers towards an injected
    // writer, and `write = console.log` is how every default seam in this tree
    // is written. Banning it would ban the fix.
    for (const source of [
      "const write = console.log;",
      "export function log(write: Writer = console.error) {}",
      "const streams = { warn: console.warn, log: console.log };",
    ]) {
      assert.deepEqual(
        findConsoleSwaps("lib/x.ts", source),
        [],
        `must not flag: ${source}`,
      );
    }
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
    const cleanAt = wrapper.indexOf("no assignments to a property of the global console");
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
