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
 * ## What it holds, and what it takes from somewhere else
 *
 * It held a per-rule row for every reported rule, which meant the two rules
 * with registries were counted twice: `lib/set-state-in-effect-triage.ts`
 * holds 30 findings across its files and this module held `30` beside the
 * rule's name. One verdict written into a registry moved both, so one edit
 * produced TWO red checks with two different instructions — "write a verdict"
 * and "paste this literal" — for one thing somebody did.
 *
 * Now `byRule` holds only rules NOBODY has read: a population with no
 * registry, which is the thing the tally is for and the thing no other list
 * in the chain can describe. A read rule's total comes from
 * `registryTotals()` in `lib/triaged-rules.ts`, summed out of the per-file
 * map a person actually edits. {@link expectedByRule} is the two put
 * together, and it is what a run is compared against.
 *
 * What is left here that is genuinely only here: the TOTAL, and how many of
 * it are errors. Neither is derivable — the total because a rule with no
 * registry has no count anywhere else, the errors because severity is not
 * something a registry records.
 *
 * ## Why it cannot go stale
 *
 * `check-eslint-gate` fails when the live run disagrees with these fields, the
 * way `check-audit-baseline` fails on an entry the audit no longer reports. So
 * a snapshot nobody re-took is a red gate, not a quiet lie — which is the
 * whole difference between this and the four hand-edits it replaces.
 *
 * {@link snapshotArithmetic} is the half that needs no run at all: the total
 * has to equal the rows plus the registries, so a hand-edit to any one of the
 * three is a red suite in 20 milliseconds rather than a red gate in 22
 * seconds.
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
 */

/** The report's shape at one measurement. */
export interface LintReportSnapshot {
  /** The date the numbers below came off a real run, `YYYY-MM-DD`. */
  readonly takenOn: string;
  /** Every finding ESLint reported, at any severity, gated or not. */
  readonly findings: number;
  /** Of those, severity 2. */
  readonly errors: number;
  /**
   * Rule id to its finding count, for rules with NO registry, most findings
   * first then by name.
   *
   * A read rule's total is summed out of its registry by `registryTotals()`
   * instead of being copied here; see {@link expectedByRule}. Empty is the
   * healthy state and says something: every population in the report has a
   * reading behind it.
   */
  readonly byRule: Readonly<Record<string, number>>;
}

/**
 * Re-taken on 2026-10-03, after `no-require-imports` cleared the last
 * population in the report with no reading behind it — which is why `byRule`
 * is empty, and why an entry appearing in it is news rather than noise.
 *
 * The 41 are `react-hooks/set-state-in-effect` (30) and
 * `react-hooks/exhaustive-deps` (11), both summed from their registries at
 * comparison time. These two numbers can only move by a verdict being
 * written or withdrawn, or by a rule nobody has read starting to report.
 */
export const LINT_REPORT_SNAPSHOT: LintReportSnapshot = {
  takenOn: "2026-10-03",
  findings: 41,
  errors: 30,
  byRule: {},
};

/** What a live run says, in the shape {@link LINT_REPORT_SNAPSHOT} records. */
export interface LintReportMeasurement {
  readonly findings: number;
  readonly errors: number;
  /** Every reported rule, read rules included — this is a whole run. */
  readonly byRule: Readonly<Record<string, number>>;
}

/**
 * Every per-rule count a clean run should report: the snapshot's own rows
 * plus each registry's sum.
 *
 * The two halves cannot overlap, and that is checked rather than assumed —
 * see {@link snapshotArithmetic}. A rule in both would be a rule whose count
 * has two owners, which is the state this function exists to end.
 */
export function expectedByRule(
  registryTotals: ReadonlyMap<string, number>,
  snapshot: LintReportSnapshot = LINT_REPORT_SNAPSHOT,
): Record<string, number> {
  const expected: Record<string, number> = { ...snapshot.byRule };
  for (const [rule, total] of registryTotals) {
    if (total === 0) continue;
    expected[rule] = (expected[rule] ?? 0) + total;
  }
  return expected;
}

/**
 * Whether the snapshot's own three fields agree with each other and with the
 * registries, with no ESLint run involved.
 *
 * This is the case the per-rule rows used to buy and no longer have to: the
 * total is a number a person types off a terminal, the registries are lists a
 * person edits, and the two have to add up. A verdict added without the
 * snapshot being re-taken fails here — in milliseconds, from a suite, with
 * "re-take the snapshot" as the only instruction — instead of surviving until
 * the next 22-second gate run.
 *
 * `errors` is held to the weaker claim it can support: no more errors than
 * findings. Severity is not something a registry records, so nothing here can
 * derive it.
 */
export function snapshotArithmetic(
  registryTotals: ReadonlyMap<string, number>,
  snapshot: LintReportSnapshot = LINT_REPORT_SNAPSHOT,
): string[] {
  const problems: string[] = [];
  for (const rule of Object.keys(snapshot.byRule)) {
    if (!registryTotals.has(rule)) continue;
    problems.push(
      `${rule} has a registry AND a snapshot row — its count has two owners, so drop the row and let registryTotals() carry it`,
    );
  }
  const expected = expectedByRule(registryTotals, snapshot);
  const summed = Object.values(expected).reduce((a, b) => a + b, 0);
  if (summed !== snapshot.findings) {
    problems.push(
      `the snapshot records ${String(snapshot.findings)} finding(s) and its rows plus the registries come to ${String(summed)} — one of the three was edited without the others`,
    );
  }
  if (snapshot.errors > snapshot.findings) {
    problems.push(
      `the snapshot records ${String(snapshot.errors)} error(s) out of ${String(snapshot.findings)} finding(s)`,
    );
  }
  return problems;
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
 *
 * A read rule's expected count comes from its registry, so a drift line
 * naming one is a line about a registry that was not updated — which
 * `untriagedFindings` says better and says first. The gate's order is
 * deliberate for that reason.
 */
export function snapshotDrift(
  measured: LintReportMeasurement,
  registryTotals: ReadonlyMap<string, number>,
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
  const expected = expectedByRule(registryTotals, snapshot);
  for (const rule of [...new Set([...Object.keys(measured.byRule), ...Object.keys(expected)])].sort()) {
    const now = measured.byRule[rule] ?? 0;
    const then = expected[rule] ?? 0;
    if (now === then) continue;
    const source = registryTotals.has(rule) ? "its registry" : "the snapshot";
    if (then === 0) problems.push(`${rule} reports ${String(now)} finding(s) and is not in the snapshot at all`);
    else if (now === 0) problems.push(`${rule} is in ${source} at ${String(then)} and reports nothing now`);
    else problems.push(`${rule} reports ${String(now)} finding(s) and ${source} records ${String(then)}`);
  }
  return problems;
}

/**
 * The replacement literal, printed on the failing path so re-taking the
 * snapshot is a paste.
 *
 * Rules with a registry are left OUT of the printed rows, because that is
 * where their count lives now: a literal that printed them back would be the
 * second owner this module just stopped being. A run whose read rules have
 * drifted is a run `untriagedFindings` has already failed with a better
 * instruction, so there is no case where those rows would be the thing to
 * paste.
 *
 * `takenOn` is today's date from the caller rather than from a clock in here:
 * a module that reads the date is a module whose output changes when nothing
 * did, and the suite that checks this formatter would have to mock it.
 */
export function formatSnapshotLiteral(
  measured: LintReportMeasurement,
  takenOn: string,
  registryTotals: ReadonlyMap<string, number>,
): string {
  const rows = Object.entries(measured.byRule)
    .filter(([rule]) => !registryTotals.has(rule))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([rule, count]) => `    "${rule}": ${String(count)},`);
  return [
    "export const LINT_REPORT_SNAPSHOT: LintReportSnapshot = {",
    `  takenOn: "${takenOn}",`,
    `  findings: ${String(measured.findings)},`,
    `  errors: ${String(measured.errors)},`,
    ...(rows.length === 0 ? ["  byRule: {},"] : ["  byRule: {", ...rows, "  },"]),
    "};",
  ].join("\n");
}
