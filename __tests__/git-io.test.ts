import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SECRET_SKIP_DIRS, SOURCE_SCAN_EXTENSIONS } from "@/lib/secret-scan";

import { listCommittable, runGit, trackedAmong } from "../scripts/git-io";
import { listFilesUnder, selectPaths } from "../scripts/guard-io";
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

describe("the set a scan of committed secrets is actually about", () => {
  it("lists tracked files and untracked ones no ignore rule covers", () => {
    const dir = repoWithForcedLocal();
    fs.writeFileSync(path.join(dir, "new.md"), "not added yet\n");
    fs.mkdirSync(path.join(dir, "ignored"), { recursive: true });
    fs.appendFileSync(path.join(dir, ".gitignore"), "ignored/\n");
    fs.writeFileSync(path.join(dir, "ignored", "scratch.md"), "pasted key\n");

    const answer = listCommittable(dir);
    assert.ok(answer.ok);
    const files = answer.ok ? answer.files : [];
    // Tracked, plus the file one `git add -A` away from being committed.
    assert.ok(files.includes("tracked.local.m"));
    assert.ok(files.includes("new.md"), "an untracked, unignored file is one add away and is in scope");
    // And not the two an ignore rule covers — the class this replaces a walk
    // to avoid reporting.
    assert.ok(!files.includes("untracked.local.m"));
    assert.ok(!files.includes("ignored/scratch.md"));
  });

  it("loses no committed file the walk would have found", () => {
    // The change this asserts against is a SILENT NARROWING: swapping the
    // candidate source could quietly drop a whole directory and still print a
    // comfortable-looking count. Every tracked file the walk finds must survive
    // the git listing, through a filter written independently of the walk's.
    const answer = listCommittable(REPO_ROOT);
    assert.ok(answer.ok, "this checkout is not a work tree, so this case proved nothing");
    const options = { extensions: SOURCE_SCAN_EXTENSIONS, skipDirs: SECRET_SKIP_DIRS };
    const fromGit = new Set(selectPaths(answer.ok ? answer.files : [], options));
    const tracked = trackedAmong(
      REPO_ROOT,
      listFilesUnder(REPO_ROOT, options),
    );
    assert.ok(tracked.ok);
    const missing = (tracked.ok ? tracked.tracked : []).filter((rel) => !fromGit.has(rel));
    assert.deepEqual(missing, [], `the git listing drops files the walk scans: ${missing.join(", ")}`);
  });

  it("applies the walk's own two filters to a list it did not walk", () => {
    const picked = selectPaths(
      [
        "lib/a.ts",
        "lib/a.TS",
        "dist/bundle.js",
        "nested/node_modules/pkg/index.js",
        "lib/logo.ttf",
        "dist.ts",
      ],
      { extensions: [".ts", ".js"], skipDirs: ["dist", "node_modules"] },
    );
    // Case-folded (a `.TS` copy unscanned is a hole one shift key wide),
    // skipped by SEGMENT wherever the directory appears, and `dist.ts` is a
    // FILE called dist — the last segment is never consulted.
    assert.deepEqual(picked, ["dist.ts", "lib/a.TS", "lib/a.ts"]);
  });
});
