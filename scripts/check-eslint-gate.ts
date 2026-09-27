#!/usr/bin/env tsx
/**
 * The tenth gate leg: fails on a named subset of ESLint rules, reports the rest.
 *
 * The decision, the three rules and the argument for not gating the other
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
  formatGateReport,
  gateFails,
  partitionFindings,
  type EslintFinding,
} from "../lib/eslint-gate";
import { runningUnderActions } from "../lib/github-annotations";

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
  return GATED_RULES.filter((gated) => {
    const entry = rules[gated.rule];
    if (entry === undefined) return true;
    const severity = Array.isArray(entry) ? entry[0] : entry;
    return severity === 0 || severity === "off";
  }).map((gated) => gated.rule);
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

  if (!gateFails(partition)) {
    console.log(report);
    return;
  }

  console.error(report);
  if (runningUnderActions()) {
    for (const finding of partition.gated) {
      console.log(
        `::error file=${finding.file},line=${finding.line}::${finding.rule ?? "eslint"}: ${finding.message.split("\n")[0]}`,
      );
    }
  }
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`${CHECK_NAME}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
