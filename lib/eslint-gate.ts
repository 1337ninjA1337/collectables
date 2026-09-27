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
 *  - Everything else is either a style question with a real answer on both
 *    sides (`array-type`, `import/first`) or a correctness question whose
 *    answer is per-site (`set-state-in-effect` is 30 findings and
 *    `lib/set-state-in-effect-triage.ts` says 26 of them are correct as
 *    written).
 *
 * Gating the first group is a ratchet on work that has been paid for. Gating
 * the second would mean 26 `eslint-disable` comments written to make a gate
 * green, which is the opposite of what a gate is for.
 *
 * So: a named subset FAILS, and everything else is COUNTED on every run. The
 * count is the half that stops this being a rule that quietly covers less and
 * less of what the linter finds — a gate that reports 34 errors it does not
 * fail on is a gate that keeps asking.
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
 * The three, and the reason each one is here rather than in the report.
 *
 * A fourth is welcome and is a decision, not an addition: a rule joins this
 * list when the tree is at zero for it AND somebody can write the {@link
 * GatedRule.why} sentence in terms of what breaks. "It is untidy" is the
 * report's job.
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
