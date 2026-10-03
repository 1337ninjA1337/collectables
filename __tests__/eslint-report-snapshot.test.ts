/**
 * The one number in the ESLint chain nothing could derive.
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
 * These cases are about the comparison: that it reports all three ways a
 * report can move, and that the replacement literal it prints is one a paste
 * can take.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINT_REPORT_SNAPSHOT,
  type LintReportMeasurement,
  formatSnapshotLiteral,
  snapshotDrift,
} from "@/lib/eslint-report-snapshot";

import { readRepoFile } from "./helpers/repo-file";

/** The committed snapshot, as a measurement, which is a clean run by definition. */
const AS_MEASURED: LintReportMeasurement = {
  findings: LINT_REPORT_SNAPSHOT.findings,
  errors: LINT_REPORT_SNAPSHOT.errors,
  byRule: LINT_REPORT_SNAPSHOT.byRule,
};

describe("the snapshot itself", () => {
  it("adds up: the per-rule counts are the total", () => {
    // Not a tautology — the three fields are typed by hand into one literal,
    // and a paste that took two lines of a three-line byRule block is exactly
    // the mistake `COMPOSITION_BASELINE`'s header warns about one toolchain
    // over.
    const summed = Object.values(LINT_REPORT_SNAPSHOT.byRule).reduce((a, b) => a + b, 0);
    assert.equal(
      summed,
      LINT_REPORT_SNAPSHOT.findings,
      "the rule rows and the total disagree, so at least one of them was hand-edited",
    );
  });

  it("records no more errors than findings, and carries a date", () => {
    assert.ok(LINT_REPORT_SNAPSHOT.errors <= LINT_REPORT_SNAPSHOT.findings);
    assert.match(LINT_REPORT_SNAPSHOT.takenOn, /^\d{4}-\d{2}-\d{2}$/);
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
});

describe("snapshotDrift", () => {
  it("says nothing when the run matches", () => {
    assert.deepEqual(snapshotDrift(AS_MEASURED), []);
  });

  it("reports a count that moved, naming both numbers and the date", () => {
    const drift = snapshotDrift(
      { ...AS_MEASURED, findings: LINT_REPORT_SNAPSHOT.findings + 1 },
      LINT_REPORT_SNAPSHOT,
    );
    assert.equal(drift.length, 1);
    assert.match(drift[0], new RegExp(`${String(LINT_REPORT_SNAPSHOT.findings + 1)} finding`));
    assert.match(drift[0], new RegExp(`records ${String(LINT_REPORT_SNAPSHOT.findings)}`));
    assert.match(drift[0], new RegExp(`taken ${LINT_REPORT_SNAPSHOT.takenOn}`));
  });

  it("reports the error count separately from the finding count", () => {
    const drift = snapshotDrift({ ...AS_MEASURED, errors: 0 });
    assert.deepEqual(drift.length, 1);
    assert.match(drift[0], /0 error\(s\)/);
  });

  it("reports a rule that arrived, which is the new-population case", () => {
    const drift = snapshotDrift({
      findings: LINT_REPORT_SNAPSHOT.findings + 2,
      errors: LINT_REPORT_SNAPSHOT.errors,
      byRule: { ...LINT_REPORT_SNAPSHOT.byRule, "import/order": 2 },
    });
    assert.ok(drift.some((line) => /import\/order reports 2 finding\(s\) and is not in the snapshot at all/.test(line)));
  });

  it("reports a rule that WENT, which a drift check usually forgets", () => {
    // The direction that matters most here: a rule cleared to zero drops out
    // of the tally entirely, so "the report got smaller" and "a rule stopped
    // being reported" are one event seen from two sides — and a snapshot that
    // only looked forward would keep describing a population somebody cleared.
    const [first] = Object.keys(LINT_REPORT_SNAPSHOT.byRule);
    const without = { ...LINT_REPORT_SNAPSHOT.byRule };
    delete without[first];
    const drift = snapshotDrift({
      findings: LINT_REPORT_SNAPSHOT.findings - LINT_REPORT_SNAPSHOT.byRule[first],
      errors: 0,
      byRule: without,
    });
    assert.ok(
      drift.some((line) => line.includes(`${first} is in the snapshot at`) && line.includes("reports nothing now")),
      drift.join("\n"),
    );
  });
});

describe("formatSnapshotLiteral", () => {
  it("prints the committed literal back, byte for byte", () => {
    // The strongest form this case can take: the formatter's output for a
    // clean run has to BE what is in the file, or "paste all of it" is an
    // instruction that introduces a diff.
    const printed = formatSnapshotLiteral(AS_MEASURED, LINT_REPORT_SNAPSHOT.takenOn);
    assert.ok(
      readRepoFile("lib/eslint-report-snapshot.ts").includes(printed),
      `the printed literal is not what the module holds:\n${printed}`,
    );
  });

  it("orders the rules most findings first, then by name", () => {
    const printed = formatSnapshotLiteral(
      { findings: 4, errors: 0, byRule: { zebra: 1, alpha: 1, middle: 2 } },
      "2026-01-01",
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
    assert.match(formatSnapshotLiteral(AS_MEASURED, "1999-12-31"), /takenOn: "1999-12-31"/);
    assert.ok(!readRepoFile("lib/eslint-report-snapshot.ts").includes("new Date("));
  });
});

describe("the gate is the thing that keeps it fresh", () => {
  it("check-eslint-gate compares the live run and prints the replacement", () => {
    const wrapper = readRepoFile("scripts/check-eslint-gate.ts");
    assert.match(wrapper, /snapshotDrift\(measured, LINT_REPORT_SNAPSHOT\)/);
    assert.match(wrapper, /formatSnapshotLiteral\(measured, new Date\(\)/);
    // And it reports a real finding BEFORE drift: a contributor with a gated
    // bug must not be told to paste a literal.
    assert.ok(
      wrapper.indexOf("if (gateFails(partition))") < wrapper.indexOf("if (drift.length > 0)"),
      "drift is reported before the findings it is a side effect of",
    );
  });
});
