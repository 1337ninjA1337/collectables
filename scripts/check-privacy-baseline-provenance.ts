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
 * changes. `PRIVACY_BASELINE_REPO_ROOT` moves which repository those questions
 * are asked of — see {@link REPO_ROOT}. It is announced on stdout whenever it is
 * set (on the pass line as well as before the run), and it may not fall through
 * to `HEAD~1`: a redirected history has to be given its base explicitly, since
 * `HEAD~1` resolves in any repository at all.
 *
 * A root that is not a git work tree is a hard failure and the FIRST thing
 * checked. Every branch below reads a null from git as an answer about history,
 * and a directory with no `.git` answers null to all of them — which the old
 * ordering reported as "no commits in this repository yet", a skip, printed as
 * a pass. An exported copy of the sources is the ordinary way that happens.
 *
 * A SHALLOW clone is a hard failure, not a skip: `actions/checkout` defaults to
 * `fetch-depth: 1`, which makes `HEAD~1` unresolvable, and a guard that reports
 * a pass because it could not see anything is the vacuous green this repo's
 * post-build premise work exists to stamp out. The message names the fix. A
 * repository whose HEAD is the ROOT commit is a genuine skip — there is no
 * previous revision, so nothing could have changed a baseline — and so is a
 * base revision from before the table module existed. A base revision where
 * the module DID exist and yields no table is a failure, not a skip: see
 * {@link classifyBaselineRevision}.
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";

import {
  classifyBaselineRevision,
  evaluatePrivacyBaselineProvenance,
  formatBaselineProvenanceReport,
  formatBaselineRevisionUnparseable,
  type BaselineRevision,
} from "../lib/privacy-baseline-provenance";
import { PRIVACY_BODY_BASELINES } from "../lib/privacy-body-baselines";

const CHECK_NAME = "check-privacy-baseline-provenance";
const BASELINE_MODULE = "lib/privacy-body-baselines.ts";

/**
 * Repository whose HISTORY is read. Overridable by
 * `PRIVACY_BASELINE_REPO_ROOT` for exactly one reason: the three
 * {@link classifyBaselineRevision} branches are unreachable from inside this
 * repository, because `merge-base` is doing its job. A scratch commit that
 * deletes or mangles the module resolves back to the fork point, which still
 * holds a good table, so `absent` and `unparseable` can be reasoned about here
 * and never executed. `__tests__/privacy-baseline-provenance-script.test.ts`
 * builds a throwaway repository with the history each branch needs and points
 * the script at it.
 *
 * The override moves the history half ONLY — the table being checked is always
 * this repo's imported `PRIVACY_BODY_BASELINES`. It is announced on stdout
 * whenever it is set, because an env var that silently redirects a guard at an
 * empty repository is a green build that checked nothing, which is the failure
 * mode this whole file was written against.
 */
const REPO_ROOT_OVERRIDE = process.env.PRIVACY_BASELINE_REPO_ROOT || null;
const REPO_ROOT = REPO_ROOT_OVERRIDE ?? path.join(__dirname, "..");

/**
 * stdout on success, null on any non-zero exit — callers decide what that
 * means.
 *
 * A git that could not be RUN is not one of those cases and does not get to be
 * a `null`. Every branch below is an answer FROM git, so an ENOENT (no binary
 * on PATH) or a signal death would read as "git said no" at each call site in
 * turn, and the first one to be asked reports `HEAD` has no parent, which
 * `resolveComparison` turns into "no commits in this repository yet" — a SKIP,
 * printed as a pass, on a machine where the guard never ran at all.
 */
function git(...args: string[]): string | null {
  const run = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (run.error !== undefined || run.status === null) {
    const cause =
      run.error?.message ?? `killed by ${run.signal ?? "an unknown signal"}`;
    console.error(
      `${CHECK_NAME}: ERROR — \`git ${args.join(" ")}\` could not be run in ${REPO_ROOT} (${cause}). This guard reads history and nothing else, so a missing or broken git makes every check below vacuous rather than green.`,
    );
    process.exit(1);
  }
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
  // Asked FIRST, because everything below reads a `null` from git as an answer
  // about history, and a root that is not a work tree answers null to all of
  // them: `HEAD~1` fails, `HEAD` fails, and the guard reports "no commits in
  // this repository yet" — a skip, printed as a pass, over a directory that
  // never had commits to begin with. That is not hypothetical: a source export
  // without `.git` is the ordinary way it happens, and PRIVACY_BASELINE_REPO_ROOT
  // is a second.
  if (git("rev-parse", "--is-inside-work-tree") !== "true") {
    return {
      kind: "fail",
      reason: `${REPO_ROOT} is not a git work tree, so there is no history to compare against and every check below would skip. ${
        REPO_ROOT_OVERRIDE === null
          ? "Run this guard from a checkout, not from an exported copy of the sources."
          : "PRIVACY_BASELINE_REPO_ROOT is set — point it at a repository or unset it."
      }`,
    };
  }
  const asked = requestedBase(argv);
  // A redirected history may not ALSO guess its base. `HEAD~1` resolves in any
  // repository at all, so an env var exported once at a workflow level would
  // otherwise quietly compare this table against a stranger's parent commit and
  // report the skip that comparison earns.
  if (REPO_ROOT_OVERRIDE !== null && (asked === null || !asked.strict)) {
    return {
      kind: "fail",
      reason:
        "PRIVACY_BASELINE_REPO_ROOT is set without an explicit base — pass --base <ref> (or set PRIVACY_BASELINE_BASE_REF). Falling through to HEAD~1 in a redirected repository compares this table against an unrelated commit.",
    };
  }
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
  // Reachable only in a real work tree now that the probe above runs first, so
  // this genuinely means an unborn HEAD rather than "git answered null to
  // everything and nobody asked why".
  if (git("rev-parse", "--verify", "HEAD") === null) {
    return {
      kind: "skip",
      reason: "no commits in this work tree yet",
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

/**
 * The table as it stood at `ref` — and, when there is none, WHICH kind of none.
 *
 * `git cat-file -e` is asked first and separately: "the module was not there
 * yet" is a skip, "the module was there and no table came out of it" is a
 * failure, and the parser cannot tell those apart.
 */
function baselinesAt(ref: string): BaselineRevision {
  const present = git("cat-file", "-e", `${ref}:${BASELINE_MODULE}`) !== null;
  return classifyBaselineRevision(
    present,
    present ? git("show", `${ref}:${BASELINE_MODULE}`) : null,
  );
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
  if (REPO_ROOT_OVERRIDE !== null) {
    console.log(
      `${CHECK_NAME}: history read from ${REPO_ROOT_OVERRIDE} (PRIVACY_BASELINE_REPO_ROOT is set) — the table itself still comes from this checkout.`,
    );
  }
  const argv = process.argv.slice(2);
  const comparison = resolveComparison(argv);
  if (comparison.kind === "fail") {
    console.error(`${CHECK_NAME}: ERROR — ${comparison.reason}`);
    process.exit(1);
  }

  const revision: BaselineRevision =
    comparison.kind === "compare"
      ? baselinesAt(comparison.ref)
      : { kind: "absent" };
  if (revision.kind === "unparseable" && comparison.kind === "compare") {
    console.error(
      formatBaselineRevisionUnparseable(
        CHECK_NAME,
        BASELINE_MODULE,
        comparison.ref,
      ),
    );
    process.exit(1);
  }

  const previous = revision.kind === "table" ? revision.table : null;
  const result = evaluatePrivacyBaselineProvenance({
    current: PRIVACY_BODY_BASELINES,
    previous,
    baseRef: comparison.kind === "compare" ? comparison.ref : null,
    changedFiles:
      comparison.kind === "compare" ? changedFilesSince(comparison.ref) : [],
  });

  if (result.ok) {
    console.log(formatBaselineProvenanceReport(CHECK_NAME, result));
    if (comparison.kind === "skip") {
      console.log(`${CHECK_NAME}: drift half skipped — ${comparison.reason}.`);
    } else if (previous === null) {
      console.log(
        `${CHECK_NAME}: drift half skipped — ${BASELINE_MODULE} did not exist at ${comparison.ref}, so the guard predates it.`,
      );
    }
    if (REPO_ROOT_OVERRIDE !== null) {
      // On the PASS line too, not only twenty lines above it: a green summary
      // that does not mention where it read from is how a redirected guard
      // becomes the guard.
      console.log(
        `${CHECK_NAME}: that pass read history from ${REPO_ROOT_OVERRIDE}, not from this checkout.`,
      );
    }
    return;
  }

  console.error(formatBaselineProvenanceReport(CHECK_NAME, result));
  process.exit(1);
}

main();
