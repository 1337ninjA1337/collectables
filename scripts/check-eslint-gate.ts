#!/usr/bin/env tsx
/**
 * The tenth gate leg: fails on a named subset of ESLint rules, reports the rest.
 *
 * The snapshot of the whole report's size lives in
 * `lib/eslint-report-snapshot.ts` and is compared here, because this leg is
 * already paying for the ESLint run a suite cannot. The two READ rules and
 * their registries live in `lib/triaged-rules.ts`, which is also where the
 * snapshot's per-rule totals are summed from.
 *
 * The decision, the six gated rules, the four zeroed rules and the argument for not gating the other
 * twelve live in `lib/eslint-gate.ts`. This wrapper is the part that has to
 * talk to ESLint: run it over the same tree `npm run lint` does, flatten the
 * results, and — the half that keeps the ratchet honest — check that each
 * gated rule is actually ENABLED before believing a zero from it.
 *
 * ## Why it runs ESLint rather than reading `npm run lint`'s output
 *
 * A gate that parses another command's stdout is a gate that breaks on a
 * formatter change. The Node API hands back the messages as data, which is
 * also what lets the report be a tally instead of 200 lines.
 */

import * as path from "node:path";

import { ESLint } from "eslint";

import {
  GATED_RULES,
  ZEROED_RULES,
  formatGateReport,
  gateFails,
  partitionFindings,
  untriagedFindings,
  type EslintFinding,
} from "../lib/eslint-gate";
import {
  LINT_REPORT_SNAPSHOT,
  formatSnapshotLiteral,
  snapshotArithmetic,
  snapshotDrift,
} from "../lib/eslint-report-snapshot";
import { runningUnderActions } from "../lib/github-annotations";
import { TRIAGED_RULES, registryTotals } from "../lib/triaged-rules";

const CHECK_NAME = "check-eslint-gate";
const REPO_ROOT = path.join(__dirname, "..");

/**
 * A file the resolved config must cover, used to ask whether a rule is on.
 *
 * `lib/use-latest-ref.ts` rather than something in `app/`: it is a `.ts` hook
 * module, which is the narrowest shape the react-hooks rules apply to, so a
 * config change that quietly stopped covering `lib/` fails here rather than
 * passing on a `.tsx` file it still reaches.
 */
const CONFIG_PROBE = "lib/use-latest-ref.ts";

/**
 * Rules the resolved config does not turn on.
 *
 * ESLint's severity in a calculated config is `0 | 1 | 2` or the string form;
 * both are normalised to a number here, and a rule that is absent entirely
 * comes back `undefined` — which is the case this exists for, since a plugin
 * that stopped loading takes its rules with it silently.
 */
function disabledGatedRules(config: { rules?: Record<string, unknown> }): readonly string[] {
  const rules = config.rules ?? {};
  // Both lists: a zero from a rule that is off is not a zero whichever list
  // the rule is on, and `ZEROED_RULES` holds three rules from two plugins the
  // gated list does not reach.
  const held = [...GATED_RULES.map((r) => r.rule), ...ZEROED_RULES.map((r) => r.rule)];
  return held.filter((rule) => {
    const entry = rules[rule];
    if (entry === undefined) return true;
    const severity = Array.isArray(entry) ? entry[0] : entry;
    return severity === 0 || severity === "off";
  });
}

async function main(): Promise<void> {
  const eslint = new ESLint({ cwd: REPO_ROOT });

  const config = (await eslint.calculateConfigForFile(
    path.join(REPO_ROOT, CONFIG_PROBE),
  )) as { rules?: Record<string, unknown> };
  const off = disabledGatedRules(config);
  if (off.length > 0) {
    console.error(
      `${CHECK_NAME}: ${off.join(", ")} — gated but not enabled by the resolved config for ${CONFIG_PROBE}. A zero from a rule that is off is not a zero; re-enable it or take it off the list in lib/eslint-gate.ts.`,
    );
    process.exit(1);
  }

  const results = await eslint.lintFiles(["."]);
  if (results.length === 0) {
    // The same floor every guard here keeps: a walk that read nothing proves
    // its negative over an empty tree.
    console.error(`${CHECK_NAME}: ESLint linted 0 files — the scan found nothing to check.`);
    process.exit(1);
  }

  const findings: EslintFinding[] = [];
  for (const result of results) {
    for (const message of result.messages) {
      findings.push({
        file: path.relative(REPO_ROOT, result.filePath),
        line: message.line ?? 0,
        rule: message.ruleId ?? null,
        message: message.message,
        severity: message.severity === 2 ? 2 : 1,
      });
    }
  }

  const partition = partitionFindings(findings);
  const report = formatGateReport(partition, results.length);

  // The whole report's size, held against the committed snapshot.
  //
  // This is the only number in the chain a suite cannot derive: the rule
  // counts come out of lists in the tree, and a finding count comes out of a
  // 22-second ESLint run that no suite can pay for. The gate is already doing
  // that run, so it is the one place the comparison is free — and two
  // documents state the number in prose, which is four hand-edits in one
  // morning away from being wrong.
  const byRule: Record<string, number> = {};
  for (const finding of findings) {
    const key = finding.rule ?? "(directive)";
    byRule[key] = (byRule[key] ?? 0) + 1;
  }
  const measured = {
    findings: findings.length,
    errors: findings.filter((f) => f.severity === 2).length,
    byRule,
  };
  // The read rules' per-rule totals come out of their registries rather than
  // out of the snapshot, so a verdict written into one moves ONE number. What
  // the snapshot still owns is the total and the error count, which nothing
  // else in the chain can derive.
  const totals = registryTotals(TRIAGED_RULES);
  const arithmetic = snapshotArithmetic(totals, LINT_REPORT_SNAPSHOT);
  const drift = snapshotDrift(measured, totals, LINT_REPORT_SNAPSHOT);

  const untriaged = untriagedFindings(findings, TRIAGED_RULES);
  if (untriaged.length > 0) {
    console.error(report);
    console.error(
      `${CHECK_NAME}: ${untriaged.length} finding(s) of a READ rule are not accounted for by its registry.`,
    );
    for (const problem of untriaged) console.error(`  ${problem}`);
    process.exit(1);
  }

  // Order matters here, and it is the order a contributor needs rather than
  // the order the checks were written in. A gated or regressed finding is a
  // thing to FIX; snapshot drift is a thing to re-take. Reporting the drift
  // first would answer a real bug with "paste this literal", which is the
  // wrong instruction and the kind a person follows.
  if (gateFails(partition)) {
    console.error(report);
    if (runningUnderActions()) {
      for (const finding of [...partition.gated, ...partition.regressed]) {
        console.log(
          `::error file=${finding.file},line=${finding.line}::${finding.rule ?? "eslint"}: ${finding.message.split("\n")[0]}`,
        );
      }
    }
    process.exit(1);
  }

  if (arithmetic.length > 0 || drift.length > 0) {
    console.error(report);
    console.error(
      `${CHECK_NAME}: the report has moved since the snapshot in lib/eslint-report-snapshot.ts was taken.`,
    );
    // Arithmetic first: a snapshot that disagrees with the registries is
    // wrong about the tree whatever the run said, and `eslint-report-snapshot.test.ts`
    // reports the same thing without waiting 22 seconds for this leg.
    for (const problem of [...arithmetic, ...drift]) console.error(`  ${problem}`);
    console.error(
      "CLAUDE.md and the lint:eslint-gate row in lib/lint-guards.ts state this number in prose and are held against that literal, so re-take it rather than editing either sentence. Paste all of it:\n",
    );
    console.error(formatSnapshotLiteral(measured, new Date().toISOString().slice(0, 10), totals));
    process.exit(1);
  }

  console.log(report);
}

main().catch((error: unknown) => {
  console.error(`${CHECK_NAME}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
