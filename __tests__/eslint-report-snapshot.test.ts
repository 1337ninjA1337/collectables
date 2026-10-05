/**
 * The one number in the ESLint chain nothing could derive — and the rows that
 * turned out to be derivable after all.
 *
 * `gate-legs-restated.test.ts` holds the sentences about `verify`'s legs to
 * the script chain. `gated-rules-restated.test.ts` holds the sentences about
 * the gated and zeroed lists to those lists. Neither could reach the sentence
 * a reader meets FIRST — "the full report: N findings, M of them errors" in
 * CLAUDE.md — because a finding count only exists after ESLint has run over
 * 1027 files, which is 22 seconds and is not a thing a suite can do.
 *
 * On 2026-10-03 that sentence was hand-edited four times in one morning: 91,
 * 85, 69, 43, 41. Each was correct for about an hour. None shipped stale only
 * because one session happened to be editing both copies each time.
 *
 * So the measurement is committed, `check-eslint-gate` re-derives it from the
 * run it is already paying for, and the prose is held against the literal.
 *
 * What these cases are about NOW is the second copy that snapshot introduced:
 * its per-rule rows restated the two registries' totals, so writing one
 * verdict moved two numbers and failed two checks with two instructions. The
 * rows for read rules are summed out of the registries, `byRule` holds only
 * populations nobody has read, and {@link snapshotArithmetic} is the half
 * that needs no ESLint run — which is what lets a suite catch a stale total
 * in milliseconds.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINT_REPORT_SNAPSHOT,
  type LintReportMeasurement,
  expectedByRule,
  formatSnapshotLiteral,
  snapshotArithmetic,
  snapshotDrift,
} from "@/lib/eslint-report-snapshot";
import { TRIAGED_RULES, registryTotals } from "@/lib/triaged-rules";

import { readRepoFile } from "./helpers/repo-file";

/** The live registry sums, which is what the gate compares against. */
const TOTALS = registryTotals(TRIAGED_RULES);

/** The committed snapshot, as a measurement, which is a clean run by definition. */
const AS_MEASURED: LintReportMeasurement = {
  findings: LINT_REPORT_SNAPSHOT.findings,
  errors: LINT_REPORT_SNAPSHOT.errors,
  byRule: expectedByRule(TOTALS),
};

describe("the snapshot itself", () => {
  it("adds up: its own rows plus the registries are the total", () => {
    // The case the per-rule rows used to buy, now holding something stronger.
    // It was `sum(byRule) === findings`, which compared a literal against
    // itself; it compares the typed total against the two registries a person
    // edits, so a verdict written without a re-take is red here rather than
    // 22 seconds into the gate.
    assert.deepEqual(snapshotArithmetic(TOTALS), []);
  });

  it("records no more errors than findings, and carries a date", () => {
    assert.ok(LINT_REPORT_SNAPSHOT.errors <= LINT_REPORT_SNAPSHOT.findings);
    assert.match(LINT_REPORT_SNAPSHOT.takenOn, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("holds no row for a rule that has a registry", () => {
    // The invariant the rewrite is for: a read rule's count has one owner.
    // Reported as a problem rather than asserted on the literal, so the
    // failure says what to do with the row.
    for (const rule of Object.keys(LINT_REPORT_SNAPSHOT.byRule)) {
      assert.ok(
        !TOTALS.has(rule),
        `${rule} has a registry and should not also have a snapshot row`,
      );
    }
  });

  it("holds only rules the gate does not already hold at zero", () => {
    // A rule on `GATED_RULES` or `ZEROED_RULES` is held at zero outright, so a
    // snapshot row for one would be a row that can only ever be 0 — and a
    // non-zero one would mean two checks failing for one finding with two
    // different instructions.
    const gate = readRepoFile("lib/eslint-gate.ts");
    for (const rule of Object.keys(LINT_REPORT_SNAPSHOT.byRule)) {
      assert.ok(
        !gate.includes(`rule: "${rule}"`),
        `${rule} is ratcheted at zero in lib/eslint-gate.ts and should not have a snapshot row`,
      );
    }
  });

  it("is at zero rows today, which is the claim the report was driven to", () => {
    // Not decoration: an empty `byRule` says every population in the report
    // has a reading behind it, and the day that stops being true is the day a
    // row appears. Asserting it makes the row a decision somebody records
    // rather than a line that arrives with a paste.
    assert.deepEqual(LINT_REPORT_SNAPSHOT.byRule, {});
  });
});

describe("expectedByRule", () => {
  it("merges the snapshot's own rows with the registry sums", () => {
    const expected = expectedByRule(
      new Map([["read/rule", 7]]),
      { takenOn: "2026-01-01", findings: 9, errors: 0, byRule: { "unread/rule": 2 } },
    );
    assert.deepEqual(expected, { "unread/rule": 2, "read/rule": 7 });
  });

  it("leaves out a registry whose findings are all fixed", () => {
    // A registry at zero is a rule that reports nothing, and a 0 row would
    // make `snapshotDrift` compare 0 against 0 for a rule not in the report —
    // noise in the one place the output has to stay readable.
    assert.deepEqual(
      expectedByRule(new Map([["read/rule", 0]]), {
        takenOn: "2026-01-01",
        findings: 0,
        errors: 0,
        byRule: {},
      }),
      {},
    );
  });

  it("derives the two live rules at the counts the report states", () => {
    assert.deepEqual(expectedByRule(TOTALS), {
      "react-hooks/set-state-in-effect": 30,
      "react-hooks/exhaustive-deps": 11,
    });
  });
});

describe("snapshotArithmetic", () => {
  it("reports a total that no longer matches the registries", () => {
    const problems = snapshotArithmetic(new Map([["read/rule", 7]]), {
      takenOn: "2026-01-01",
      findings: 8,
      errors: 0,
      byRule: {},
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /records 8 finding\(s\) and its rows plus the registries come to 7/);
  });

  it("reports a rule that owns its count twice", () => {
    const problems = snapshotArithmetic(new Map([["read/rule", 7]]), {
      takenOn: "2026-01-01",
      findings: 10,
      errors: 0,
      byRule: { "read/rule": 3 },
    });
    assert.ok(problems.some((line) => /read\/rule has a registry AND a snapshot row/.test(line)));
  });

  it("reports more errors than findings", () => {
    const problems = snapshotArithmetic(new Map(), {
      takenOn: "2026-01-01",
      findings: 1,
      errors: 2,
      byRule: { "unread/rule": 1 },
    });
    assert.ok(problems.some((line) => /2 error\(s\) out of 1 finding\(s\)/.test(line)));
  });
});

describe("snapshotDrift", () => {
  it("says nothing when the run matches", () => {
    assert.deepEqual(snapshotDrift(AS_MEASURED, TOTALS), []);
  });

  it("reports a count that moved, naming both numbers and the date", () => {
    const drift = snapshotDrift(
      { ...AS_MEASURED, findings: LINT_REPORT_SNAPSHOT.findings + 1 },
      TOTALS,
      LINT_REPORT_SNAPSHOT,
    );
    assert.equal(drift.length, 1);
    assert.match(drift[0], new RegExp(`${String(LINT_REPORT_SNAPSHOT.findings + 1)} finding`));
    assert.match(drift[0], new RegExp(`records ${String(LINT_REPORT_SNAPSHOT.findings)}`));
    assert.match(drift[0], new RegExp(`taken ${LINT_REPORT_SNAPSHOT.takenOn}`));
  });

  it("reports the error count separately from the finding count", () => {
    const drift = snapshotDrift({ ...AS_MEASURED, errors: 0 }, TOTALS);
    assert.deepEqual(drift.length, 1);
    assert.match(drift[0], /0 error\(s\)/);
  });

  it("reports a rule that arrived, which is the new-population case", () => {
    const drift = snapshotDrift(
      {
        findings: LINT_REPORT_SNAPSHOT.findings + 2,
        errors: LINT_REPORT_SNAPSHOT.errors,
        byRule: { ...AS_MEASURED.byRule, "import/order": 2 },
      },
      TOTALS,
    );
    assert.ok(drift.some((line) => /import\/order reports 2 finding\(s\) and is not in the snapshot at all/.test(line)));
  });

  it("reports a rule that WENT, which a drift check usually forgets", () => {
    // The direction that matters most here: a rule cleared to zero drops out
    // of the tally entirely, so "the report got smaller" and "a rule stopped
    // being reported" are one event seen from two sides — and a snapshot that
    // only looked forward would keep describing a population somebody cleared.
    const [first] = Object.keys(AS_MEASURED.byRule);
    const without = { ...AS_MEASURED.byRule };
    delete without[first];
    const drift = snapshotDrift(
      {
        findings: LINT_REPORT_SNAPSHOT.findings - AS_MEASURED.byRule[first],
        errors: 0,
        byRule: without,
      },
      TOTALS,
    );
    assert.ok(
      drift.some((line) => line.includes(`${first} is in its registry at`) && line.includes("reports nothing now")),
      drift.join("\n"),
    );
  });

  it("names the registry, not the snapshot, for a read rule's count", () => {
    // What the contributor needs to know is WHICH list to edit, and for these
    // two rules it is never this module.
    const drift = snapshotDrift(
      { ...AS_MEASURED, byRule: { ...AS_MEASURED.byRule, "react-hooks/exhaustive-deps": 12 }, findings: 42 },
      TOTALS,
    );
    assert.ok(
      drift.some((line) => line.includes("react-hooks/exhaustive-deps reports 12 finding(s) and its registry records 11")),
      drift.join("\n"),
    );
  });

  it("names the snapshot for a rule with no registry", () => {
    const drift = snapshotDrift(
      { findings: 1, errors: 0, byRule: { "unread/rule": 1 } },
      new Map(),
      { takenOn: "2026-01-01", findings: 2, errors: 0, byRule: { "unread/rule": 2 } },
    );
    assert.ok(
      drift.some((line) => line.includes("unread/rule reports 1 finding(s) and the snapshot records 2")),
      drift.join("\n"),
    );
  });
});

describe("formatSnapshotLiteral", () => {
  it("prints the committed literal back, byte for byte", () => {
    // The strongest form this case can take: the formatter's output for a
    // clean run has to BE what is in the file, or "paste all of it" is an
    // instruction that introduces a diff.
    const printed = formatSnapshotLiteral(AS_MEASURED, LINT_REPORT_SNAPSHOT.takenOn, TOTALS);
    assert.ok(
      readRepoFile("lib/eslint-report-snapshot.ts").includes(printed),
      `the printed literal is not what the module holds:\n${printed}`,
    );
  });

  it("leaves out the rules whose counts belong to a registry", () => {
    // The whole point of the rewrite, from the printing side: a paste that
    // brought the read rules back would restore the second owner.
    const printed = formatSnapshotLiteral(
      { findings: 41, errors: 30, byRule: { ...AS_MEASURED.byRule, "import/order": 2 } },
      "2026-01-01",
      TOTALS,
    );
    assert.ok(!printed.includes("set-state-in-effect"), printed);
    assert.ok(printed.includes('"import/order": 2,'), printed);
  });

  it("prints an empty byRule on one line, which is what the file holds", () => {
    const printed = formatSnapshotLiteral(AS_MEASURED, "2026-01-01", TOTALS);
    assert.match(printed, /^ {2}byRule: \{\},$/m);
  });

  it("orders the rules most findings first, then by name", () => {
    const printed = formatSnapshotLiteral(
      { findings: 4, errors: 0, byRule: { zebra: 1, alpha: 1, middle: 2 } },
      "2026-01-01",
      new Map(),
    );
    assert.deepEqual(
      printed.split("\n").filter((line) => line.includes('": ')).map((line) => line.trim()),
      ['"middle": 2,', '"alpha": 1,', '"zebra": 1,'],
    );
  });

  it("takes the date from its caller rather than reading a clock", () => {
    // A formatter that read the date would change its output when nothing did,
    // and the case above — which compares against the committed file — could
    // only pass on one day of the year.
    assert.match(formatSnapshotLiteral(AS_MEASURED, "1999-12-31", TOTALS), /takenOn: "1999-12-31"/);
    assert.ok(!readRepoFile("lib/eslint-report-snapshot.ts").includes("new Date("));
  });
});

describe("the gate is the thing that keeps it fresh", () => {
  it("check-eslint-gate compares the live run and prints the replacement", () => {
    const wrapper = readRepoFile("scripts/check-eslint-gate.ts");
    assert.match(wrapper, /snapshotDrift\(measured, totals, LINT_REPORT_SNAPSHOT\)/);
    assert.match(wrapper, /formatSnapshotLiteral\(measured, new Date\(\)/);
    // And it checks the arithmetic too, so a stale total fails the leg even on
    // a run where every rule happens to match.
    assert.match(wrapper, /snapshotArithmetic\(totals, LINT_REPORT_SNAPSHOT\)/);
    // And it reports a real finding BEFORE drift: a contributor with a gated
    // bug must not be told to paste a literal.
    assert.ok(
      wrapper.indexOf("if (gateFails(partition))") < wrapper.indexOf("if (arithmetic.length > 0 || drift.length > 0)"),
      "drift is reported before the findings it is a side effect of",
    );
  });
});
