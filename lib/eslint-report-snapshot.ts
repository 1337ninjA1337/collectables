/**
 * What `npm run lint` reports, the last time the gate measured it.
 *
 * ## The problem this is
 *
 * Two documents state the size of the full ESLint report in prose —
 * CLAUDE.md's Commands section and the `lint:eslint-gate` row in
 * `lib/lint-guards.ts` — and on 2026-10-03 both were hand-edited FOUR times
 * in one morning: 91 findings, then 85, then 69, then 43, then 41. Every one
 * of those numbers was correct for about an hour, every one was typed from a
 * terminal by a person who had just run the command, and the only reason none
 * of them shipped stale is that the same person was editing both files each
 * time.
 *
 * That is the shape `gate-legs-restated.test.ts` and `gated-rules-restated.test.ts`
 * exist to close, and neither could reach this one: a RULE count can be
 * derived from a list in the tree, and a FINDING count can only be derived
 * from running ESLint — 22 seconds, which no suite can pay on every run.
 *
 * So the number is committed here, the gate re-derives it from the real run it
 * is already doing, and the prose is held against this literal rather than
 * against a memory of a terminal.
 *
 * ## Why it cannot go stale
 *
 * `check-eslint-gate` fails when the live run disagrees with these fields, the
 * way `check-audit-baseline` fails on an entry the audit no longer reports. So
 * a snapshot nobody re-took is a red gate, not a quiet lie — which is the
 * whole difference between this and the four hand-edits it replaces.
 *
 * **Re-taking it is a copy, not a transcription**: `npm run lint:eslint-gate`
 * prints the replacement literal on the failing path. Paste all of it. A
 * snapshot with one fresh number among stale ones reports drift that never
 * happened, which is the mistake `COMPOSITION_BASELINE`'s header spells out
 * one toolchain over.
 *
 * ## What it deliberately does not hold
 *
 * Per RULE, not per file and not per line. The per-file question already has
 * two owners that answer it better — `TriagedRule.expected` holds the read
 * rules' findings per file, and `GATED_RULES`/`ZEROED_RULES` hold their rules
 * at zero outright — and a snapshot keyed on files would go red for a rename.
 * What is left over, and the only thing this adds, is the TOTAL: the sentence
 * a reader meets in CLAUDE.md before they have run anything.
 */

/** The report's shape at one measurement. */
export interface LintReportSnapshot {
  /** The date the numbers below came off a real run, `YYYY-MM-DD`. */
  readonly takenOn: string;
  /** Every finding ESLint reported, at any severity, gated or not. */
  readonly findings: number;
  /** Of those, severity 2. */
  readonly errors: number;
  /** Rule id to its finding count, most findings first then by name. */
  readonly byRule: Readonly<Record<string, number>>;
}

/**
 * Re-taken on 2026-10-03, after `no-require-imports` cleared the last
 * population in the report with no reading behind it.
 *
 * Both remaining rules have committed registries and the gate holds each
 * complete per file, so these two numbers can only move by a verdict being
 * written or withdrawn — which is the state the report was driven to and the
 * thing this records.
 */
export const LINT_REPORT_SNAPSHOT: LintReportSnapshot = {
  takenOn: "2026-10-03",
  findings: 41,
  errors: 30,
  byRule: {
    "react-hooks/set-state-in-effect": 30,
    "react-hooks/exhaustive-deps": 11,
  },
};

/** What a live run says, in the shape {@link LINT_REPORT_SNAPSHOT} records. */
export interface LintReportMeasurement {
  readonly findings: number;
  readonly errors: number;
  readonly byRule: Readonly<Record<string, number>>;
}

/**
 * Every way a measurement disagrees with a snapshot, one sentence each.
 *
 * All three directions, because each is a different edit somebody made and a
 * different thing to be told: a count that moved, a rule that arrived, and a
 * rule that went. The third is the one a drift check usually forgets, and it
 * is the one that matters here — a rule cleared to zero drops out of the
 * tally entirely, so "the report got smaller" and "a rule stopped being
 * reported" are the same event seen from two sides.
 */
export function snapshotDrift(
  measured: LintReportMeasurement,
  snapshot: LintReportSnapshot = LINT_REPORT_SNAPSHOT,
): string[] {
  const problems: string[] = [];
  if (measured.findings !== snapshot.findings) {
    problems.push(
      `the report has ${String(measured.findings)} finding(s) and the snapshot records ${String(snapshot.findings)} (taken ${snapshot.takenOn})`,
    );
  }
  if (measured.errors !== snapshot.errors) {
    problems.push(
      `the report has ${String(measured.errors)} error(s) and the snapshot records ${String(snapshot.errors)}`,
    );
  }
  for (const rule of [...new Set([...Object.keys(measured.byRule), ...Object.keys(snapshot.byRule)])].sort()) {
    const now = measured.byRule[rule] ?? 0;
    const then = snapshot.byRule[rule] ?? 0;
    if (now === then) continue;
    if (then === 0) problems.push(`${rule} reports ${String(now)} finding(s) and is not in the snapshot at all`);
    else if (now === 0) problems.push(`${rule} is in the snapshot at ${String(then)} and reports nothing now`);
    else problems.push(`${rule} reports ${String(now)} finding(s) and the snapshot records ${String(then)}`);
  }
  return problems;
}

/**
 * The replacement literal, printed on the failing path so re-taking the
 * snapshot is a paste.
 *
 * `takenOn` is today's date from the caller rather than from a clock in here:
 * a module that reads the date is a module whose output changes when nothing
 * did, and the suite that checks this formatter would have to mock it.
 */
export function formatSnapshotLiteral(
  measured: LintReportMeasurement,
  takenOn: string,
): string {
  const rows = Object.entries(measured.byRule)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([rule, count]) => `    "${rule}": ${String(count)},`);
  return [
    "export const LINT_REPORT_SNAPSHOT: LintReportSnapshot = {",
    `  takenOn: "${takenOn}",`,
    `  findings: ${String(measured.findings)},`,
    `  errors: ${String(measured.errors)},`,
    "  byRule: {",
    ...rows,
    "  },",
    "};",
  ].join("\n");
}
