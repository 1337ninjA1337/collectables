/**
 * The git half of a guard's premise: asking the index what it holds.
 *
 * Deliberately NOT in `lib/`, for the same reason `scripts/guard-io.ts` is not:
 * `lib/local-only.ts` stays pure so a suite can take it without a child
 * process, and this is the file that spawns one. The division is the same one
 * the walk already has — policy in `lib/`, syscalls here.
 *
 * A guard that asks git has to survive not being inside git. Every one of these
 * wrappers is spawned against scratch roots by `__tests__/helpers/guard-fixture`
 * — temp directories with no `.git` anywhere above them — so "not a work tree"
 * is a normal answer that must not fail a run, and must not pass silently
 * either. Both helpers here return a REASON rather than throwing, and the
 * caller decides what to print.
 */

import { spawnSync } from "node:child_process";

/** Ceiling on one git call, so a wedged binary cannot hang a guard forever. */
const GIT_TIMEOUT_MS = 10_000;

/** What git answered, or why it did not. */
export type GitAnswer =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Run git in `cwd` and hand back its stdout, or a one-line reason.
 *
 * The three ways this can fail to answer are all reported as reasons rather
 * than exceptions: git is not installed (`spawnSync` sets `error`), the
 * directory is not a work tree (exit 128), and the call timed out. A guard's
 * job is to say what it could not establish; throwing would make that a stack
 * trace over a question the guard only asked as a bonus.
 */
export function runGit(cwd: string, args: readonly string[]): GitAnswer {
  const run = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    // stdin closed: `git` never prompts here, and an inherited terminal is how
    // a credential helper turns a guard into a hang.
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (run.error) return { ok: false, reason: `git could not be run (${run.error.message})` };
  if (run.status !== 0) {
    const stderr = (run.stderr ?? "").trim().split("\n")[0] ?? "";
    return { ok: false, reason: stderr || `git exited ${String(run.status)}` };
  }
  return { ok: true, stdout: run.stdout ?? "" };
}

/**
 * Every file in `cwd` that git would take: tracked, plus untracked ones no
 * ignore rule covers.
 *
 * This is the set a scan reporting on "committed secrets" is actually about.
 * A walk of the working tree is a different set in both directions — it reads
 * a scratch `notes.md`, an editor backup and a half-finished migration, none of
 * which can be committed, and it reads them with the same severity as a file in
 * the index. `--others` keeps the half that matters: a file created a minute ago
 * and not yet added is one `git add -A` from being committed, so it stays in
 * scope. `--exclude-standard` is what drops the rest.
 *
 * `-z` because git QUOTES unusual names otherwise (`"a\nb.ts"`), and a scan
 * that opens the quoted spelling reads nothing and reports nothing.
 *
 * Deduplicated: during a merge conflict `--cached` lists a path once per stage,
 * which would otherwise scan the same file three times and count it three times
 * toward the floor.
 */
export type CommittableAnswer =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export function listCommittable(cwd: string): CommittableAnswer {
  const answer = runGit(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  if (!answer.ok) return { ok: false, reason: answer.reason };
  const unique = new Set(answer.stdout.split("\0").filter(Boolean));
  return { ok: true, files: [...unique].sort() };
}

export type TrackedAnswer =
  | { readonly ok: true; readonly tracked: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Which of `paths` git is tracking, relative to `cwd`.
 *
 * `git ls-files --` with explicit pathspecs rather than a full listing: the
 * caller has a handful of names and the whole index is thousands, and the
 * question is membership. `--` because a path that starts with a dash is a
 * flag otherwise, and `.env.local.example` is exactly the sort of name this
 * gets called with.
 *
 * An empty `paths` is answered without spawning anything — bare `ls-files`
 * would return the ENTIRE index, which is the difference between "none of
 * these are tracked" and "everything is".
 *
 * Deduplicated for the same reason {@link listCommittable} is: during an
 * unresolved merge the index holds one path at three stages and `ls-files`
 * prints it once per stage. The caller here is a REFUSAL that counts and names
 * what it found, so the undeduplicated answer reads `3 file(s) are tracked by
 * git AND skipped` over one file listed three times — a report that overstates
 * the problem and sends its reader looking for two files that do not exist.
 */
export function trackedAmong(cwd: string, paths: readonly string[]): TrackedAnswer {
  if (paths.length === 0) return { ok: true, tracked: [] };
  const answer = runGit(cwd, ["ls-files", "--", ...paths]);
  if (!answer.ok) return { ok: false, reason: answer.reason };
  const unique = new Set(
    answer.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return { ok: true, tracked: [...unique] };
}
