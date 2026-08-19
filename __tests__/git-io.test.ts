import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runGit, trackedAmong } from "../scripts/git-io";
import { REPO_ROOT } from "./helpers/repo-file";

/**
 * The git half of the guard premise.
 *
 * Two scratch trees, because the two answers this module exists to tell apart
 * are "git says no" and "git was not asked": a real one-file repository, and a
 * temp directory with no `.git` above it. The second is not an edge case — it
 * is what every guard fixture is, so a helper that threw there would take the
 * whole `LINT_GUARDS` harness with it.
 */

const scratch: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** A one-commit repository with `tracked.local.m` force-added past `.gitignore`. */
function repoWithForcedLocal(): string {
  const dir = tempDir("git-io-repo-");
  const git = (...args: string[]) => {
    const run = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, `git ${args.join(" ")} failed: ${run.stderr}`);
  };
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "fixture");
  fs.writeFileSync(path.join(dir, ".gitignore"), "*.local.*\n");
  fs.writeFileSync(path.join(dir, "tracked.local.m"), "Host = \"db.example.invalid\"\n");
  fs.writeFileSync(path.join(dir, "untracked.local.m"), "Host = \"db.example.invalid\"\n");
  git("add", ".gitignore");
  git("add", "-f", "tracked.local.m");
  git("commit", "-qm", "fixture");
  return dir;
}

describe("asking git, from a guard", () => {
  it("answers with stdout when git ran", () => {
    const answer = runGit(REPO_ROOT, ["rev-parse", "--is-inside-work-tree"]);
    assert.ok(answer.ok, `git did not answer inside this checkout: ${!answer.ok && answer.reason}`);
    assert.equal(answer.stdout.trim(), "true");
  });

  it("answers with a REASON outside a work tree, rather than throwing", () => {
    // Every guard fixture is a temp directory. A helper that threw here would
    // turn "this tree is not in git" into a stack trace inside a guard whose
    // whole job is stating what it could not establish.
    const answer = runGit(tempDir("git-io-bare-"), ["rev-parse", "--is-inside-work-tree"]);
    assert.equal(answer.ok, false);
    assert.ok(!answer.ok && answer.reason.length > 0, "no reason was given for git's refusal");
    assert.ok(!answer.ok && !/\n/.test(answer.reason), "the reason spans lines; a guard prints one");
  });

  it("reports which of the named paths are tracked, and only those", () => {
    const answer = trackedAmong(repoWithForcedLocal(), [
      "tracked.local.m",
      "untracked.local.m",
      "never-existed.local.m",
    ]);
    assert.ok(answer.ok);
    assert.deepEqual(answer.ok && answer.tracked, ["tracked.local.m"]);
  });

  it("never asks bare `ls-files`, which would answer with the whole index", () => {
    // The difference between "none of these are tracked" and "everything is".
    const answer = trackedAmong(repoWithForcedLocal(), []);
    assert.ok(answer.ok);
    assert.deepEqual(answer.ok && answer.tracked, []);
  });

  it("carries git's refusal through for a tree it cannot ask about", () => {
    const answer = trackedAmong(tempDir("git-io-bare-"), ["queries.local.m"]);
    assert.equal(answer.ok, false);
    assert.match(!answer.ok ? answer.reason : "", /git|repository/i);
  });
});
