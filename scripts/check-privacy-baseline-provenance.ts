#!/usr/bin/env tsx
/**
 * Fails when a `PRIVACY_BODY_BASELINES` entry is malformed, or when a `words`
 * value changed without the provenance that makes the change reviewable. Run
 * via `npm run lint:baseline-provenance`; part of the `lint:all` fan-out.
 *
 * The matching logic is pure and lives in `lib/privacy-baseline-provenance.ts`;
 * this file is the git half — it decides WHAT to compare against and reads the
 * previous revision of the table as text.
 *
 * Base revision, first match wins:
 *
 *   1. `--base <ref>` — an explicit ref, for running the guard by hand.
 *   2. `PRIVACY_BASELINE_BASE_REF` — the same, from the environment.
 *   3. `origin/$GITHUB_BASE_REF` — the PR's target branch on CI.
 *   4. `HEAD~1` — a push to main (this repo commits straight to main), and the
 *      right fallback on a `pull_request` checkout too, whose HEAD is a merge
 *      commit whose first parent is the base branch tip.
 *
 * In every case the comparison point is `git merge-base <base> HEAD`, so a base
 * branch that moved on does not present its own later commits as this diff's
 * changes.
 *
 * A SHALLOW clone is a hard failure, not a skip: `actions/checkout` defaults to
 * `fetch-depth: 1`, which makes `HEAD~1` unresolvable, and a guard that reports
 * a pass because it could not see anything is the vacuous green this repo's
 * post-build premise work exists to stamp out. The message names the fix. A
 * repository whose HEAD is the ROOT commit is a genuine skip — there is no
 * previous revision, so nothing could have changed a baseline — and so is a
 * base revision that predates the table module.
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";

import {
  evaluatePrivacyBaselineProvenance,
  formatBaselineProvenanceReport,
} from "../lib/privacy-baseline-provenance";
import {
  PRIVACY_BODY_BASELINES,
  parsePrivacyBodyBaselines,
  type PrivacyBodyBaseline,
} from "../lib/privacy-body-baselines";

const CHECK_NAME = "check-privacy-baseline-provenance";
const REPO_ROOT = path.join(__dirname, "..");
const BASELINE_MODULE = "lib/privacy-body-baselines.ts";

/** stdout on success, null on any non-zero exit — callers decide what that means. */
function git(...args: string[]): string | null {
  const run = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (run.status !== 0 || typeof run.stdout !== "string") return null;
  return run.stdout.trim();
}

/**
 * `strict` separates a base someone NAMED from one this script guessed. A named
 * ref that does not resolve is an error — quietly comparing against something
 * else is worse than stopping. A guessed one (the PR's target branch) falls
 * through to `HEAD~1`, which on a `pull_request` checkout is the same commit by
 * another route.
 */
type RequestedBase = { readonly ref: string; readonly strict: boolean };

function requestedBase(argv: readonly string[]): RequestedBase | null {
  const flag = argv.indexOf("--base");
  if (flag !== -1 && argv[flag + 1]) {
    return { ref: argv[flag + 1], strict: true };
  }
  const fromEnv = process.env.PRIVACY_BASELINE_BASE_REF;
  if (fromEnv) return { ref: fromEnv, strict: true };
  const prBase = process.env.GITHUB_BASE_REF;
  if (prBase) return { ref: `origin/${prBase}`, strict: false };
  return null;
}

type Comparison =
  | { readonly kind: "compare"; readonly ref: string }
  | { readonly kind: "skip"; readonly reason: string }
  | { readonly kind: "fail"; readonly reason: string };

function resolveComparison(argv: readonly string[]): Comparison {
  const asked = requestedBase(argv);
  if (asked !== null) {
    const merged =
      git("merge-base", asked.ref, "HEAD") ?? git("rev-parse", asked.ref);
    if (merged !== null) return { kind: "compare", ref: merged };
    if (asked.strict) {
      return {
        kind: "fail",
        reason: `base revision "${asked.ref}" does not resolve — fetch it (or drop --base to compare against HEAD~1).`,
      };
    }
  }
  const parent = git("rev-parse", "--verify", "HEAD~1");
  if (parent !== null) return { kind: "compare", ref: parent };
  if (git("rev-parse", "--verify", "HEAD") === null) {
    return {
      kind: "skip",
      reason: "no commits in this repository yet",
    };
  }
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    return {
      kind: "fail",
      reason:
        "HEAD has no parent in a SHALLOW clone — the drift half cannot run, and a pass that checked nothing is not a pass. Check out with `fetch-depth: 0` (ci.yml does), or pass --base <ref> with a ref that is present.",
    };
  }
  return { kind: "skip", reason: "HEAD is the root commit" };
}

/** The table as it stood at `ref`, or null when it was not there / not parseable. */
function baselinesAt(ref: string): Record<string, PrivacyBodyBaseline> | null {
  const source = git("show", `${ref}:${BASELINE_MODULE}`);
  return source === null ? null : parsePrivacyBodyBaselines(source);
}

/**
 * Files differing between `ref` and the WORKING TREE — not `ref..HEAD`. The
 * guard is meant to fire while the change is still being written, and an
 * uncommitted baseline edit is exactly the moment the note is easiest to add.
 */
function changedFilesSince(ref: string): readonly string[] {
  const diff = git("diff", "--name-only", ref);
  return diff === null || diff === "" ? [] : diff.split("\n");
}

function main(): void {
  const argv = process.argv.slice(2);
  const comparison = resolveComparison(argv);
  if (comparison.kind === "fail") {
    console.error(`${CHECK_NAME}: ERROR — ${comparison.reason}`);
    process.exit(1);
  }

  const previous =
    comparison.kind === "compare" ? baselinesAt(comparison.ref) : null;
  const baseRef = comparison.kind === "compare" ? comparison.ref : null;
  const result = evaluatePrivacyBaselineProvenance({
    current: PRIVACY_BODY_BASELINES,
    previous,
    baseRef,
    changedFiles:
      comparison.kind === "compare" ? changedFilesSince(comparison.ref) : [],
  });

  if (result.ok) {
    console.log(formatBaselineProvenanceReport(CHECK_NAME, result));
    if (comparison.kind === "skip") {
      console.log(`${CHECK_NAME}: drift half skipped — ${comparison.reason}.`);
    } else if (previous === null) {
      console.log(
        `${CHECK_NAME}: drift half skipped — ${BASELINE_MODULE} has no parseable table at ${comparison.ref}.`,
      );
    }
    return;
  }

  console.error(formatBaselineProvenanceReport(CHECK_NAME, result));
  process.exit(1);
}

main();
