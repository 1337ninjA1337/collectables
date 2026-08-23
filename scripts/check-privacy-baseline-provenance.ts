#!/usr/bin/env tsx
/**
 * Fails when a recorded measurement of the privacy policy is malformed, or
 * changed without the provenance that makes the change reviewable. Run via
 * `npm run lint:baseline-provenance`; part of the `lint:all` fan-out.
 *
 * N tables, one guard, and this file names none of them. It asks one question —
 * a recorded measurement moved, did the diff say why — of every table in a
 * registry, and the same three answers from git serve all of them, which is the
 * part with the CI-specific reasoning in it and the reason they share a script
 * rather than having one each.
 *
 * WHAT IS WHERE, because the pure half is now bigger than this file and is the
 * thing to read first:
 *
 *   - `lib/provenance-tables.ts` — which tables exist, and the six steps each
 *     one runs. Today: `PRIVACY_BODY_BASELINES` (a word count per policy page),
 *     `PRIVACY_TRANSLATION_SOURCES` (a checksum of the English disclosure and of
 *     each translation) and `SCRUB_PROMISE_BASELINE` (a fingerprint of the
 *     sentence promising what `scrubPII` strips). Also the two refusals that
 *     stop a run before it reports: an empty registry, and a diff whose paths
 *     are not repo-relative.
 *   - `lib/privacy-baseline-provenance.ts`, `lib/privacy-translation-provenance.ts`,
 *     `lib/scrub-promise-provenance.ts` — one evaluator each: what is
 *     well-formed, what counts as drift, and the sentences it says about itself.
 *   - `lib/provenance-key-set.ts` — the closed-set rule the two KEYED tables
 *     share, so a key no page is published for is a report rather than a throw.
 *   - `lib/provenance-report.ts` — what gets printed, in what order, to which
 *     stream. All four of those rules, and none of them need git.
 *
 * THIS FILE is the git half and nothing else: which revision to compare against,
 * whether the root is a work tree, whether the clone is shallow, each table's
 * module as text at that revision, and the diff. Every report is printed before
 * any exit code is honoured — the commit that amends the English disclosure
 * moves the word count AND all five checksums, so stopping at the first would
 * hide half the work behind a fix.
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
 * base revision from before a table's module existed. A base revision where
 * that module DID exist and yields no table is a failure, not a skip — for the
 * tables that ask for the distinction; each declares its own answer in
 * `lib/provenance-tables.ts`.
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { checkError } from "../lib/check-error";
import {
  printProvenanceOutput,
  provenanceOutput,
} from "../lib/provenance-report";
import {
  PROVENANCE_TABLES,
  changedFilesRefusal,
  provenanceRegistryRefusal,
  type ProvenanceTable,
} from "../lib/provenance-tables";
import {
  GUARD_ROOT_ENV,
  GuardRootError,
  PRIVACY_BASELINE_ROOT_ENV,
  resolveGuardRoot,
  type GuardRootResolution,
} from "../lib/guard-root";

const CHECK_NAME = "check-privacy-baseline-provenance";

/**
 * Repository whose HISTORY is read. Overridable by
 * `PRIVACY_BASELINE_REPO_ROOT` for exactly one reason: the three
 * classification branches a table can produce are unreachable from inside this
 * repository, because `merge-base` is doing its job. A scratch commit that
 * deletes or mangles a module resolves back to the fork point, which still
 * holds a good table, so `absent` and `unparseable` can be reasoned about here
 * and never executed. `__tests__/privacy-baseline-provenance-script.test.ts`
 * builds a throwaway repository with the history each branch needs and points
 * the script at it.
 *
 * The override moves the history half ONLY — the tables being checked are always
 * the ones `lib/provenance-tables.ts` imported from this checkout. It is announced on stdout
 * whenever it is set, because an env var that silently redirects a guard at an
 * empty repository is a green build that checked nothing, which is the failure
 * mode this whole file was written against.
 */
/**
 * Resolved at module load because `git()` closes over the root, so the throw
 * a bad override produces has nowhere else to be caught. `PRIVACY_BASELINE_REPO_ROOT`
 * keeps precedence over the fleet-wide `LINT_GUARD_REPO_ROOT`: an invocation
 * that named this guard's own variable still means exactly what it used to.
 */
function resolveRootOrExit(): GuardRootResolution {
  try {
    return resolveGuardRoot(CHECK_NAME, path.join(__dirname, ".."), process.env, [
      PRIVACY_BASELINE_ROOT_ENV,
      GUARD_ROOT_ENV,
    ]);
  } catch (error) {
    if (error instanceof GuardRootError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const ROOT = resolveRootOrExit();
const REPO_ROOT = ROOT.root;
const REPO_ROOT_OVERRIDE = ROOT.source === null ? null : ROOT.root;

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
    stop(
      checkError(
        CHECK_NAME,
        `\`git ${args.join(" ")}\` could not be run in ${REPO_ROOT} (${cause}). This guard reads history and nothing else, so a missing or broken git makes every check below vacuous rather than green.`,
      ),
    );
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
  /**
   * A REFUSAL, already formatted — not a reason for `main` to format.
   *
   * The other two stops receive a finished line from a pure function
   * (`provenanceRegistryRefusal`, `changedFilesRefusal`). While this variant
   * carried a bare `reason`, `main` had to splice the check name and the em dash
   * back on, which made it the last place in the script where the guard's output
   * convention was written by hand — and the one caller that could disagree with
   * the two that cannot. Built here, where the sentence is decided.
   */
  | { readonly kind: "fail"; readonly refusal: string };

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
      refusal: checkError(
        CHECK_NAME,
        `${REPO_ROOT} is not a git work tree, so there is no history to compare against and every check below would skip. ${
        REPO_ROOT_OVERRIDE === null
          ? "Run this guard from a checkout, not from an exported copy of the sources."
          : `${ROOT.source} is set — point it at a repository or unset it.`
      }`,
      ),
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
      refusal: checkError(
        CHECK_NAME,
        `${ROOT.source} is set without an explicit base — pass --base <ref> (or set PRIVACY_BASELINE_BASE_REF). Falling through to HEAD~1 in a redirected repository compares this table against an unrelated commit.`,
      ),
    };
  }
  if (asked !== null) {
    const merged =
      git("merge-base", asked.ref, "HEAD") ?? git("rev-parse", asked.ref);
    if (merged !== null) return { kind: "compare", ref: merged };
    if (asked.strict) {
      return {
        kind: "fail",
        refusal: checkError(
          CHECK_NAME,
          `base revision "${asked.ref}" does not resolve — fetch it (or drop --base to compare against HEAD~1).`,
        ),
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
      refusal: checkError(
        CHECK_NAME,
        "HEAD has no parent in a SHALLOW clone — the drift half cannot run, and a pass that checked nothing is not a pass. Check out with `fetch-depth: 0` (ci.yml does), or pass --base <ref> with a ref that is present.",
      ),
    };
  }
  return { kind: "skip", reason: "HEAD is the root commit" };
}

/**
 * One table's module as it stood at `ref`, as text plus the presence bit.
 *
 * `git cat-file -e` is asked first and separately because "the module was not
 * there yet" is a skip and "the module was there and no table came out of it" is
 * a failure, and no parser can tell those apart. Which of the two a given table
 * makes of it is that table's own business — see `lib/provenance-tables.ts`.
 */
function moduleAt(modulePath: string, ref: string) {
  const present = git("cat-file", "-e", `${ref}:${modulePath}`) !== null;
  return {
    present,
    source: present ? git("show", `${ref}:${modulePath}`) : null,
  };
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

/**
 * End the run on a refusal.
 *
 * Three checks stop this guard before it reports anything, and each of them was
 * its own four-line block with its own `console.error` and its own
 * `process.exit(1)`. Three copies of an ending is how one of them comes to exit
 * 0, or to print on stdout, in a diff nobody reads twice.
 *
 * `never` rather than a `string | null` in and `void` out, which is what this
 * was on the run that extracted it. The condition costs each caller two words
 * and buys the thing a `void` helper cannot give back: the type system knows the
 * run ended, so `comparison` narrows past its `fail` variant and a later read of
 * a field that only exists on a refused shape is a compile error rather than a
 * branch nobody re-derives.
 */
function stop(refusal: string): never {
  console.error(refusal);
  process.exit(1);
}

function main(): void {
  if (REPO_ROOT_OVERRIDE !== null) {
    console.log(
      `${CHECK_NAME}: history read from ${REPO_ROOT_OVERRIDE} (${ROOT.source} is set) — the table itself still comes from this checkout.`,
    );
  }
  const argv = process.argv.slice(2);

  // THE THREE STOPS, in order. Each is a reason this run cannot produce a
  // trustworthy report, and each ends it rather than degrading it.
  //
  // Statements rather than a list of checks, and the reason is the data between
  // them: the diff cannot be asked for before a base revision resolves, so a
  // list would be a list of thunks and the order would stop being the visible
  // thing about it. What the three DO share is the ending, which is `stop`.
  const comparison = resolveComparison(argv);
  if (comparison.kind === "fail") stop(comparison.refusal);

  // An empty registry is the one thing a loop can do that two hand-written
  // passes could not — see {@link provenanceRegistryRefusal}. `provenanceOutput`
  // refuses the same thing one level down, over the OUTCOMES rather than the
  // registry; neither is redundant, because this one names the cause and that
  // one cannot be bypassed by a caller that forgot to ask.
  const registryRefusal = provenanceRegistryRefusal(
    CHECK_NAME,
    PROVENANCE_TABLES,
  );
  if (registryRefusal !== null) stop(registryRefusal);

  // Read once, not once per table: the diff is the same diff, and two
  // `git diff --name-only` calls that could disagree is a difference nobody
  // would want to have to reason about.
  const changedFiles =
    comparison.kind === "compare" ? changedFilesSince(comparison.ref) : [];

  // Checked once, here, before any table has read it — see
  // {@link changedFilesRefusal}. A list that is not repo-relative makes every
  // table's answer wrong in the same way, so it is a stopped run rather than one
  // false report per entry.
  const diffRefusal = changedFilesRefusal(CHECK_NAME, changedFiles);
  if (diffRefusal !== null) stop(diffRefusal);

  const outcomes = PROVENANCE_TABLES.map((table: ProvenanceTable) =>
    table.run(CHECK_NAME, {
      ref: comparison.kind === "compare" ? comparison.ref : null,
      changedFiles,
      ...(comparison.kind === "compare"
        ? moduleAt(table.module, comparison.ref)
        : { present: false, source: null }),
    }),
  );

  // WHAT gets printed, in what order, to which stream — all four rules in
  // {@link provenanceOutput}, none of which need git. This file decides what to
  // compare against and reads history; it does not decide what a report reads
  // like.
  const output = provenanceOutput(
    CHECK_NAME,
    outcomes,
    comparison.kind === "skip" ? comparison.reason : null,
  );
  printProvenanceOutput(output);
  // An unparseable table stopped the run before the others were read, so the
  // trailing summary below would be describing something that did not happen.
  if (output.halted) process.exit(1);
  const ok = output.ok;
  if (REPO_ROOT_OVERRIDE !== null) {
    // On the PASS line too, not only twenty lines above it: a green summary
    // that does not mention where it read from is how a redirected guard
    // becomes the guard. "pass" only when it was one — a failing run that
    // called itself a pass would be a stranger sentence than the one it saved.
    const verdict = ok ? "pass" : "run";
    console.log(
      `${CHECK_NAME}: that ${verdict} read history from ${REPO_ROOT_OVERRIDE}, not from this checkout.`,
    );
  }
  if (!ok) process.exit(1);
}

main();
