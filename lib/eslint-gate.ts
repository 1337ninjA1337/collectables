/**
 * Which ESLint rules `npm run verify` FAILS on, and why it is not all of them.
 *
 * ## The decision this module is
 *
 * `npm run lint` arrived on 2026-09-25 as a report: `eslint .` over the whole
 * tree, 251 findings, gating nothing. The argument for leaving it ungated was
 * never that the findings did not matter — it was that a tenth gate leg means
 * the errors are zero first, and 83 errors is not a thing one commit does.
 *
 * Two days of reading brought that to 34, and the reading is what decided the
 * shape of this. The findings are not one population:
 *
 *  - `react-hooks/refs`, `react-hooks/purity` and `react-hooks/rules-of-hooks`
 *    are React violations. Not style, not preference — a ref read during
 *    render is a component that does not update, an impure call during render
 *    is a value React may recompute, and a hook after an early return is
 *    "Rendered more hooks than during the previous render", which is a white
 *    screen. All three are at ZERO, and the work that got them there found
 *    three real bugs on the way: a scroll lock that never locked, a listing
 *    screen that re-fetched a missing listing forever, and the hook-order
 *    crash on the path that fix made reachable.
 *  - `react-hooks/globals` and `import/export` joined on 2026-10-03 and are
 *    the same kind of fact one site each. Both were single ERRORS nobody had
 *    read: the report had carried them since the day it was opened, next to
 *    thirty findings that had verdicts written for them, which is the one
 *    thing a counted report cannot fix about itself.
 *  - Everything else is either a style question with a real answer on both
 *    sides (`array-type`, `import/first`) or a correctness question whose
 *    answer is per-site (`set-state-in-effect` is 30 findings and
 *    `lib/set-state-in-effect-triage.ts` says 26 of them are correct as
 *    written).
 *  - `react-hooks/preserve-manual-memoization` is the one that was READ, driven
 *    to zero, and deliberately NOT gated — the decision the bar below exists
 *    to force. Its finding was real and worth taking (`app/listing/[id].tsx`
 *    hoisted one string above a `useMemo` and lost the whole 763-line screen
 *    its compilation), but what the rule reports is a MISSED OPTIMIZATION, and
 *    nothing in this tree turns React Compiler on: there is no `reactCompiler`
 *    experiment in `app.json` and no compiler plugin in the Babel config, so
 *    the cost it names is not a cost this build pays. A `why` sentence written
 *    for it would have to describe a toolchain that does not run here, which is
 *    exactly the "it is untidy" the report is for.
 *
 * Gating the first group is a ratchet on work that has been paid for. Gating
 * the second would mean 26 `eslint-disable` comments written to make a gate
 * green, which is the opposite of what a gate is for.
 *
 * So: a named subset FAILS, and everything else is COUNTED on every run. The
 * count is the half that stops this being a rule that quietly covers less and
 * less of what the linter finds — a gate that reports 30 errors it does not
 * fail on is a gate that keeps asking.
 *
 * ## The third thing it does: keep the two READINGS complete
 *
 * Two of the ungated rules have been read end to end — `set-state-in-effect`
 * on 2026-09-27 and `exhaustive-deps` on 2026-10-01 — and each reading is a
 * committed registry of verdicts. Both hold an anchor line per entry, so an
 * entry about code that has moved fails its own suite. Neither could see the
 * other direction: a NEW finding of either rule joined no registry and was
 * counted in the report beside thirty that had been decided. The gate now
 * holds the real run against both registries per file, so a new finding
 * fails this leg until somebody writes a verdict — which is a far smaller
 * ask than a fix, and is what stops a reading from being about the day it
 * was written.
 *
 * ## The anti-vacuous half
 *
 * A gated rule that the config does not actually enable passes for free, which
 * is the way a ratchet becomes decoration. `scripts/check-eslint-gate.ts` asks
 * ESLint for the resolved config and fails when a gated rule is off, so
 * dropping `eslint-config-expo`'s react-hooks plugin turns the gate red rather
 * than silent.
 */

/** One rule the gate fails on. */
export interface GatedRule {
  /** The ESLint rule id, e.g. `react-hooks/refs`. */
  readonly rule: string;
  /** ISO date the tree reached zero findings for it. */
  readonly since: string;
  /** What the rule catches, in terms of what breaks — not what it is called. */
  readonly why: string;
}

/**
 * The five gated rules, and the reason each one is here rather than in the report.
 *
 * A sixth is welcome and is a decision, not an addition: a rule joins this
 * list when the tree is at zero for it AND somebody can write the {@link
 * GatedRule.why} sentence in terms of what breaks. "It is untidy" is the
 * report's job — and `react-hooks/preserve-manual-memoization`, read to zero
 * on 2026-10-03 and left off this list, is the first rule that bar has
 * actually excluded rather than described.
 */
export const GATED_RULES: readonly GatedRule[] = [
  {
    rule: "react-hooks/refs",
    since: "2026-09-27",
    why: "A ref read during render is a component that does not update when the value does — 44 findings across eight files, and one of them was a scroll lock that never locked anything.",
  },
  {
    rule: "react-hooks/rules-of-hooks",
    since: "2026-09-27",
    why: 'A hook below an early return is "Rendered more hooks than during the previous render", which React throws — a white screen on the render after a deep-linked fetch lands.',
  },
  {
    rule: "react-hooks/purity",
    since: "2026-09-27",
    why: "An impure call in a render body is a value React may recompute at a moment nobody chose — `useRef(Date.now())` kept the first answer and paid for a new one every render.",
  },
  {
    rule: "react-hooks/globals",
    since: "2026-10-03",
    why: "A write to a variable outside the component from inside its render body is a value whose correctness depends on when React happens to re-render — it is dropped on a discarded pass and duplicated under StrictMode, and neither is a thing the call site can see.",
  },
  {
    rule: "import/export",
    since: "2026-10-03",
    why: "Two exports of one name is the second one silently winning for every importer, with no error at the import site — the one place this tree does it is legal TypeScript interface merging, and that site carries a scoped disable with a sentence rather than the rule being left off.",
  },
];

/** One ESLint message, flattened out of its file result. */
export interface EslintFinding {
  /** Repo-relative path. */
  readonly file: string;
  readonly line: number;
  /** `null` for a directive message, which has no rule of its own. */
  readonly rule: string | null;
  readonly message: string;
  /** ESLint's own: 2 is an error, 1 a warning. */
  readonly severity: 1 | 2;
}

export interface GatePartition {
  /** Findings from a gated rule, at any severity. */
  readonly gated: readonly EslintFinding[];
  /** Everything else, counted rather than failed on. */
  readonly reported: readonly EslintFinding[];
}

/**
 * Split findings into the ones that fail the gate and the ones it reports.
 *
 * Severity is deliberately not part of the split. A gated rule is one this
 * tree is at zero for; a finding from it at WARNING severity is still the
 * shape coming back, and the config having downgraded it is a change to argue
 * with rather than a reason to let it through.
 */
export function partitionFindings(
  findings: readonly EslintFinding[],
  rules: readonly GatedRule[] = GATED_RULES,
): GatePartition {
  const gatedIds = new Set(rules.map((r) => r.rule));
  const gated: EslintFinding[] = [];
  const reported: EslintFinding[] = [];
  for (const finding of findings) {
    (finding.rule !== null && gatedIds.has(finding.rule) ? gated : reported).push(finding);
  }
  return { gated, reported };
}

/** `[rule, errors, warnings]` per rule, most findings first then by name. */
export function ruleTally(
  findings: readonly EslintFinding[],
): readonly { rule: string; errors: number; warnings: number }[] {
  const byRule = new Map<string, { errors: number; warnings: number }>();
  for (const finding of findings) {
    const key = finding.rule ?? "(directive)";
    const row = byRule.get(key) ?? { errors: 0, warnings: 0 };
    if (finding.severity === 2) row.errors += 1;
    else row.warnings += 1;
    byRule.set(key, row);
  }
  return [...byRule.entries()]
    .map(([rule, row]) => ({ rule, ...row }))
    .sort((a, b) => b.errors + b.warnings - (a.errors + a.warnings) || a.rule.localeCompare(b.rule));
}

/** Whether the gate fails: any finding at all from a gated rule. */
export function gateFails(partition: GatePartition): boolean {
  return partition.gated.length > 0;
}

/**
 * The whole run in one block, green or red.
 *
 * The reported half prints on BOTH paths on purpose. An exemption nobody sees
 * is the silence this repository's other gates were built to end, and a count
 * that only appears on a failure is a count nobody reads.
 */
export function formatGateReport(
  partition: GatePartition,
  fileCount: number,
  rules: readonly GatedRule[] = GATED_RULES,
): string {
  const lines: string[] = [];
  if (partition.gated.length === 0) {
    lines.push(
      `check-eslint-gate: ${fileCount} file(s), 0 finding(s) from ${rules.length} gated rule(s).`,
    );
    for (const rule of rules) lines.push(`  ${rule.rule} — zero since ${rule.since}`);
  } else {
    lines.push(
      `check-eslint-gate: ${partition.gated.length} finding(s) from ${rules.length} gated rule(s).`,
    );
    lines.push(
      "These rules are gated because the tree was at zero for them and the work that got it there found real bugs. Fix the finding, or argue the rule off the list in lib/eslint-gate.ts — an eslint-disable needs a sentence saying which shape it is.",
    );
    for (const finding of partition.gated) {
      lines.push(`  ${finding.file}:${finding.line}  ${finding.rule ?? "(directive)"}`);
    }
    for (const rule of rules) {
      if (partition.gated.some((f) => f.rule === rule.rule)) lines.push(`  ${rule.rule}: ${rule.why}`);
    }
  }

  const tally = ruleTally(partition.reported);
  const errors = partition.reported.filter((f) => f.severity === 2).length;
  const warnings = partition.reported.length - errors;
  lines.push(
    `check-eslint-gate: reporting ${errors} error(s) and ${warnings} warning(s) across ${tally.length} ungated rule(s) — see \`npm run lint\` for the detail.`,
  );
  for (const row of tally) {
    lines.push(`  ${row.rule}  ${row.errors} error(s), ${row.warnings} warning(s)`);
  }
  return lines.join("\n");
}

/** A rule whose findings are all read and decided somewhere. */
export interface TriagedRule {
  /** The ESLint rule id. */
  readonly rule: string;
  /** Where the verdicts live, named in the failure message. */
  readonly registry: string;
  /** Repo-relative file to the number of LIVE findings its entries account for. */
  readonly expected: ReadonlyMap<string, number>;
}

/**
 * The half the counted report cannot do on its own.
 *
 * Two rules in the ungated population have been read end to end —
 * `set-state-in-effect`'s 31 and `exhaustive-deps`' 13 — and each reading is
 * a committed registry of verdicts. Both registries hold an anchor line per
 * entry, so an entry about code that has moved is reported by its own suite.
 * Neither can see the other direction: a NEW finding of either rule joins no
 * registry, and the report counts it alongside the thirty that were decided,
 * in a number nobody re-reads.
 *
 * So the gate holds the real run against the registries, per file. A new
 * finding in a file somebody has read is a count that no longer matches; a
 * new finding in a file nobody has read is a file with no entry at all; and a
 * finding that went away without its entry being marked `fixed` is the same
 * mismatch from the other side, which is the case that keeps a registry from
 * quietly describing a tree that has moved on.
 *
 * Per FILE and not per line, deliberately. A line number changes when
 * somebody adds an import, and a registry keyed on one would be a registry
 * nobody could edit — the entries key on the code they read, and the count is
 * what makes the set complete.
 */
export function untriagedFindings(
  findings: readonly EslintFinding[],
  triaged: readonly TriagedRule[],
): string[] {
  const problems: string[] = [];
  for (const rule of triaged) {
    const actual = new Map<string, number>();
    for (const finding of findings) {
      if (finding.rule !== rule.rule) continue;
      actual.set(finding.file, (actual.get(finding.file) ?? 0) + 1);
    }
    for (const file of new Set([...actual.keys(), ...rule.expected.keys()])) {
      const found = actual.get(file) ?? 0;
      const read = rule.expected.get(file) ?? 0;
      if (found === read) continue;
      problems.push(
        found > read
          ? `${rule.rule}: ${file} reports ${found} finding(s) and ${rule.registry} accounts for ${read}. Read the new one and give it a verdict — a finding counted beside thirty decided ones is a finding nobody decided.`
          : `${rule.rule}: ${file} reports ${found} finding(s) and ${rule.registry} accounts for ${read}. An entry describing a finding that has gone is a verdict about nothing — mark it \`fixed\` or drop it.`,
      );
    }
  }
  return problems.sort();
}
