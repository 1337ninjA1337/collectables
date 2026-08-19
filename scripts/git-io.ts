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
 * The names in a `-z` listing, deduplicated, in git's order.
 *
 * Every answer this module builds out of `ls-files` is a SET of paths, and it
 * was two independent `new Set(...)` calls with a paragraph each until the
 * second one turned out to be reading a different format. Both callers ask for
 * `-z` now, so there is one shape to read and one place that knows why:
 *
 * `-z` because `ls-files` QUOTES a name it considers unusual otherwise —
 * `café.local.m` arrives as `"caf\303\251.local.m"`, quotes and octal escapes
 * included (`core.quotePath`, on by default). That spelling is not a path: a
 * scan that opens it reads nothing, and a refusal that prints it names a file
 * `git rm --cached` will not take.
 *
 * Deduplicated because during an unresolved merge `--cached` lists a path once
 * per stage. Three entries for one file is three reads of it, three findings
 * for one credential, three toward the scanned floor, and a refusal opening
 * with `3 file(s)` over one name.
 *
 * No trimming: a NUL-separated name is already exact, and ` lead.local.m` is a
 * legal filename that git does NOT quote — trimming it produces a name nothing
 * on disk answers to. The trailing empty field after the last NUL is what the
 * emptiness filter is for.
 */
function namesFrom(stdout: string): string[] {
  return [...new Set(stdout.split("\0").filter(Boolean))];
}

/** The candidate set, or why git could not name it. */
export type CommittableAnswer =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string };

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
 * `-z`, and deduplicated, for the reasons {@link namesFrom} carries. Sorted
 * here and not there, because this is the only one of the two answers a report
 * counts through: git's own order is stable but arbitrary, and a candidate list
 * that reads differently on two machines is one nobody can diff.
 */
export function listCommittable(cwd: string): CommittableAnswer {
  const answer = runGit(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  if (!answer.ok) return { ok: false, reason: answer.reason };
  return { ok: true, files: namesFrom(answer.stdout).sort() };
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
 * `-z`, and deduplicated, through the same {@link namesFrom} as the listing
 * above. This call read line-by-line for its first few runs and the difference
 * was invisible for as long as every tracked file was called something plain.
 * It is not a formatting preference: the answer goes to a REFUSAL that names
 * files and tells its reader to `git rm --cached` them, so a name git escaped
 * (`"caf\303\251.local.m"`) or one this code trimmed (` lead.local.m`) is an
 * instruction that fails when followed — over a file that really is a
 * committed credential, which is the moment the report has to be exact.
 */
export function trackedAmong(cwd: string, paths: readonly string[]): TrackedAnswer {
  if (paths.length === 0) return { ok: true, tracked: [] };
  const answer = runGit(cwd, ["ls-files", "-z", "--", ...paths]);
  if (!answer.ok) return { ok: false, reason: answer.reason };
  return { ok: true, tracked: namesFrom(answer.stdout) };
}
