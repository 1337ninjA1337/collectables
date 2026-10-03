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
 *  - `import/first` joined the same day, from the other end: six WARNINGS, and
 *    the only one of the import rules with a sentence about what breaks rather
 *    than about what is untidy. `__tests__/helpers/render.ts` documents the
 *    hazard in its own header — a static import below
 *    `installNativeModuleStubs()` is resolved before that call runs, so the
 *    stubs do not apply and the suite dies resolving react-native's Flow
 *    source. Five of the six findings were
 *    `mount-provider-harness.test.ts` writing `autoUnmount()` between two
 *    import groups, which is harmless and reads exactly like the mistake.
 *  - `import/no-duplicates` was driven to zero on 2026-10-03 alongside it and
 *    is NOT gated, which is the second thing that bar has excluded: two
 *    imports of one module is untidy and nothing more, and the one site left
 *    in this tree keeps the duplicate ON PURPOSE (`components/gesture-root.tsx`
 *    wants a bare side-effect import a later sort cannot move off line one).
 *    A rule whose only live site is a deliberate disable is a rule the report
 *    should carry.
 *  - Everything else is either a style question with a real answer on both
 *    sides (`array-type`) or a correctness question whose
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
 * The six gated rules, and the reason each one is here rather than in the report.
 *
 * A seventh is welcome and is a decision, not an addition: a rule joins this
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
  {
    rule: "import/first",
    since: "2026-10-03",
    why: "An `import` written below a statement reads as running after it and does not: ESM resolves a module's whole import graph before its first line, which is exactly the mistake `installNativeModuleStubs()` exists to be called before — a static import under that call resolves `react-native`'s Flow source for real, and the suite dies on esbuild before a case runs.",
  },
];

/**
 * A single rule this tree is held at zero for, on a reason that is not "what
 * breaks".
 *
 * ## Why this is a second list rather than three more {@link GATED_RULES}
 *
 * The bar on that list is deliberate and has now said no four times:
 * `react-hooks/preserve-manual-memoization` reports a missed optimization for
 * a compiler this build does not run, `import/no-duplicates` reports two
 * imports of one module, `@typescript-eslint/array-type` reports `Array<T>`
 * where the config prefers `T[]`, and `no-require-imports` reports a second
 * spelling of an import. Nothing breaks in any of the four, and a `why`
 * sentence written for them would have to describe a cost the tree does not
 * pay — which is the exact shape this file exists to refuse.
 *
 * And leaving them out had a cost of its own, measured the day `array-type`
 * was cleared: {@link ruleTally} prints only rules that still have findings,
 * so a rule driven to zero and not gated DISAPPEARS from the report. There
 * was then no line anywhere saying it had been read. A report that shrank
 * because somebody did the work and one that shrank because somebody stopped
 * looking printed identically.
 *
 * So the two halves of "gated" are split apart. A {@link GatedRule} answers
 * *what breaks*; a {@link ZeroedRule} answers *what the zero cost*, and the
 * gate ratchets both — because "a ratchet on work that has been paid for" was
 * always the argument, and tidiness work is paid for in the same hours.
 *
 * The difference the split keeps is in the failure text. A gated rule's
 * finding is a bug to fix. A zeroed rule's finding is a regression to undo,
 * and a disable comment written to silence one is explicitly the wrong answer:
 * the zero is worth less than the disable would cost to read.
 */
export interface ZeroedRule {
  /** The ESLint rule id. */
  readonly rule: string;
  /** ISO date the tree reached zero findings for it. */
  readonly since: string;
  /**
   * What the zero cost, so a regression is measured against work rather than
   * against taste — and so the sentence cannot be written without having done
   * it.
   */
  readonly paidFor: string;
  /**
   * The file whose `eslint-disable` is what holds this rule at zero, when one
   * does.
   *
   * Two kinds of zero look identical in this list and are not the same claim.
   * `array-type` is at zero because every site was changed; `import/no-duplicates`
   * is at zero because one site argues for its duplicate behind a block
   * disable. The first is a fact about the tree. The second is a fact about an
   * argument, and an argument can be wrong — so it says where it is, and
   * `eslint-gate.test.ts` holds the path to existing and to still carrying a
   * disable for this rule.
   *
   * Absent means the stronger claim: nothing in the tree is silencing it.
   */
  readonly heldByDisable?: string;
}

/**
 * The four zeroed rules, each read to zero on 2026-10-03 and none of them a
 * bug.
 *
 * A further one joins the same way: the tree is at zero for it, and somebody
 * can say what clearing it took. "It would be nicer" is not that sentence.
 */
export const ZEROED_RULES: readonly ZeroedRule[] = [
  {
    rule: "react-hooks/preserve-manual-memoization",
    since: "2026-10-03",
    paidFor: "One finding, and reading it found that the React Compiler's answer to a dependency it cannot prove immutable is to skip compiling the component — `app/listing/[id].tsx` hoisted one string above a `useMemo` and lost a 763-line screen its optimization. The fix was to read the value inside the factory.",
  },
  {
    rule: "import/no-duplicates",
    since: "2026-10-03",
    heldByDisable: "components/gesture-root.tsx",
    paidFor: "Nine mechanical merges across five files, plus the one site that keeps its duplicate on purpose: `components/gesture-root.tsx` carries the bare side-effect import the gesture-handler docs ask for at the top of an entry file, and this module is what `app/_layout.tsx` imports first so that it stays in that position.",
  },
  {
    rule: "@typescript-eslint/array-type",
    since: "2026-10-03",
    paidFor: "26 findings in 21 files, every one taken by `eslint --fix` and reviewed as one diff: 31 type annotations, no behaviour, `tsc --noEmit` and 9843 cases unchanged either side of it. The population had been the largest in the report for a week and grew by one while the tooling around it was being written.",
  },
  {
    rule: "@typescript-eslint/no-require-imports",
    since: "2026-10-03",
    paidFor: "Two findings, and reading them found two spellings rather than two decisions: `check-inline-hex.test.ts` required `node:fs` in a case body under an `as typeof import(...)` cast that existed only to make the require typesafe, and `placeholder-color.test.ts` required `@/lib/design-tokens` under a hand-written type three lines below a sibling case that `await import`s the same module. Neither was lazy, neither was conditional, and clearing both closed the last ungated population in the report that had no reading behind it.",
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
  /**
   * Findings from a rule {@link ZEROED_RULES} says the tree is at zero for.
   *
   * A separate bucket rather than a second kind of `gated`, because the two
   * fail for different reasons and a reader meeting the failure needs to know
   * which: a gated finding is a bug, a regressed one is work being undone.
   */
  readonly regressed: readonly EslintFinding[];
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
  zeroed: readonly ZeroedRule[] = ZEROED_RULES,
): GatePartition {
  const gatedIds = new Set(rules.map((r) => r.rule));
  const zeroedIds = new Set(zeroed.map((r) => r.rule));
  const gated: EslintFinding[] = [];
  const regressed: EslintFinding[] = [];
  const reported: EslintFinding[] = [];
  for (const finding of findings) {
    // A directive message has no rule of its own and can be neither.
    if (finding.rule !== null && gatedIds.has(finding.rule)) gated.push(finding);
    else if (finding.rule !== null && zeroedIds.has(finding.rule)) regressed.push(finding);
    else reported.push(finding);
  }
  return { gated, regressed, reported };
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

/**
 * Whether the gate fails: any finding at all from a gated OR a zeroed rule.
 *
 * Both halves, because both are zeros somebody paid for. The split is what the
 * failure text is for, not what it is conditioned on.
 */
export function gateFails(partition: GatePartition): boolean {
  return partition.gated.length > 0 || partition.regressed.length > 0;
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
  zeroed: readonly ZeroedRule[] = ZEROED_RULES,
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

  // The zeroed half prints on both paths for the reason the ungated tally
  // does: a zero nobody is told about is indistinguishable from a rule that
  // quietly stopped being looked at.
  if (partition.regressed.length === 0) {
    lines.push(
      `check-eslint-gate: ${zeroed.length} rule(s) read to zero and held there, tidiness rather than breakage.`,
    );
    for (const rule of zeroed) lines.push(`  ${rule.rule} — zero since ${rule.since}`);
  } else {
    lines.push(
      `check-eslint-gate: ${partition.regressed.length} finding(s) from ${zeroed.length} rule(s) this tree was read to zero for.`,
    );
    lines.push(
      "Nothing breaks here — that is why these are not on the gated list — but the zero was somebody's afternoon. Undo the regression rather than silencing it: an eslint-disable costs a reader more than the finding costs anybody, and a rule nobody will keep at zero belongs off the list in lib/eslint-gate.ts.",
    );
    for (const finding of partition.regressed) {
      lines.push(`  ${finding.file}:${finding.line}  ${finding.rule ?? "(directive)"}`);
    }
    for (const rule of zeroed) {
      if (partition.regressed.some((f) => f.rule === rule.rule)) {
        lines.push(`  ${rule.rule}: ${rule.paidFor}`);
      }
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
