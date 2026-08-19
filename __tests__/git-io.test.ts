import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SECRET_SKIP_DIRS, SOURCE_SCAN_EXTENSIONS } from "@/lib/secret-scan";

import { listCommittable, runGit, trackedAmong } from "../scripts/git-io";
import { listFilesUnder, selectPaths } from "../scripts/guard-io";
import { GitFixtureError, initGitRoot, stageConflicted } from "./helpers/guard-fixture";
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
  // Written BEFORE the repository exists, because `forceAdd` names files git
  // has to be able to see — the helper says so rather than letting `git add -f`
  // fail in its own words inside a fixture.
  fs.writeFileSync(path.join(dir, "tracked.local.m"), "Host = \"db.example.invalid\"\n");
  fs.writeFileSync(path.join(dir, "untracked.local.m"), "Host = \"db.example.invalid\"\n");
  initGitRoot(dir, "*.local.*\n", { forceAdd: ["tracked.local.m"] });
  return dir;
}

/** The same repository with `staged.local.m` in the index and not in HEAD. */
function repoWithStagedLocal(): string {
  const dir = tempDir("git-io-staged-");
  fs.writeFileSync(path.join(dir, "staged.local.m"), "Host = \"db.example.invalid\"\n");
  fs.writeFileSync(path.join(dir, "untracked.local.m"), "Host = \"db.example.invalid\"\n");
  initGitRoot(dir, "*.local.*\n", { stage: ["staged.local.m"] });
  return dir;
}

/**
 * The two names git does not print plainly, force-added past `.gitignore`.
 *
 * `café.local.m` is the one git ESCAPES (`core.quotePath` is on by default, so
 * `ls-files` without `-z` prints `"caf\303\251.local.m"`), and ` lead.local.m`
 * is the one it does not — a legal filename that arrives verbatim and that a
 * `.trim()` on the way past silently renames. Both are what a reader in
 * `docs/` actually creates the day they follow an instruction in their own
 * language, and both end up in a refusal that tells them to `git rm --cached`
 * the name it prints.
 */
const ESCAPED_NAME = "café.local.m";
const SPACED_NAME = " lead.local.m";
function repoWithAwkwardNames(): string {
  const dir = tempDir("git-io-awkward-");
  for (const name of [ESCAPED_NAME, SPACED_NAME]) {
    fs.writeFileSync(path.join(dir, name), "Host = \"db.example.invalid\"\n");
  }
  initGitRoot(dir, "*.local.*\n", { forceAdd: [ESCAPED_NAME, SPACED_NAME] });
  return dir;
}

/** A repository mid-merge, with `conflicted.local.m` at all three stages. */
function repoMidMerge(): string {
  const dir = tempDir("git-io-conflict-");
  fs.writeFileSync(path.join(dir, "conflicted.local.m"), "Host = \"ours.example.invalid\"\n");
  initGitRoot(dir, "*.local.*\n", { forceAdd: ["conflicted.local.m"] });
  stageConflicted(dir, "conflicted.local.m", {
    base: "Host = \"base.example.invalid\"\n",
    ours: "Host = \"ours.example.invalid\"\n",
    theirs: "Host = \"theirs.example.invalid\"\n",
  });
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

  it("counts a file that is staged and not committed as tracked", () => {
    // The state between the two the other cases build, and the one a developer
    // is in a minute after force-adding by mistake. `git ls-files` reads the
    // INDEX, so the answer is the same as for a committed file — which is the
    // premise `formatTrackedLocalOnly`'s refusal rests on and which nothing
    // asserted, because no fixture could produce this state.
    const answer = trackedAmong(repoWithStagedLocal(), ["staged.local.m", "untracked.local.m"]);
    assert.ok(answer.ok);
    assert.deepEqual(answer.ok && answer.tracked, ["staged.local.m"]);
  });

  it("names a path held at three merge stages once, not three times", () => {
    // The caller is a refusal that COUNTS what it found, so an undeduplicated
    // answer reads `3 file(s) are tracked by git AND skipped` over one file and
    // sends its reader looking for two that do not exist.
    const dir = repoMidMerge();
    // The premise first: without this the case passes over a repository that
    // was never conflicted, asserting a dedup that had nothing to remove.
    const stages = spawnSync("git", ["ls-files", "-u", "--", "conflicted.local.m"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(stages.status, 0, `git ls-files -u failed: ${stages.stderr}`);
    assert.equal(
      stages.stdout.split("\n").filter(Boolean).length,
      3,
      "the fixture is not actually mid-merge, so the dedup below is unexercised",
    );

    const answer = trackedAmong(dir, ["conflicted.local.m"]);
    assert.ok(answer.ok);
    assert.deepEqual(answer.ok && answer.tracked, ["conflicted.local.m"]);
  });

  it("names a file git would have escaped in the spelling that is on disk", () => {
    // The premise, asserted rather than assumed: without `-z` git renders this
    // name as `"caf\303\251.local.m"` — quotes and octal escapes included. A
    // checkout with `core.quotePath=false` would print it plainly and leave the
    // assertion below passing over a bug it never met.
    const dir = repoWithAwkwardNames();
    const quoted = spawnSync("git", ["ls-files", "--", ESCAPED_NAME], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(quoted.status, 0, `git ls-files failed: ${quoted.stderr}`);
    assert.match(
      quoted.stdout,
      /^"caf\\303\\251\.local\.m"$/m,
      "git did not escape this name, so nothing below is about escaping",
    );

    const answer = trackedAmong(dir, [ESCAPED_NAME]);
    assert.ok(answer.ok);
    // The escaped spelling is not a path. `check-secrets` prints this name in a
    // refusal that says `git rm --cached` it, so a name the reader cannot use
    // is an instruction that fails at the one moment the file really is a
    // committed credential.
    assert.deepEqual(answer.ok && answer.tracked, [ESCAPED_NAME]);
  });

  it("keeps a name git prints plainly and this code used to trim", () => {
    // The other half, and the one no escaping would have caught: a leading
    // space is legal, git quotes nothing, and the old line-reader's `.trim()`
    // turned ` lead.local.m` into `lead.local.m` — a file that does not exist,
    // reported as tracked, in the same breath as one that does.
    const dir = repoWithAwkwardNames();
    const plain = spawnSync("git", ["ls-files", "--", SPACED_NAME], { cwd: dir, encoding: "utf8" });
    assert.equal(plain.status, 0, `git ls-files failed: ${plain.stderr}`);
    assert.match(plain.stdout, /^ lead\.local\.m$/m, "git escaped this name, so the trim is moot");

    const answer = trackedAmong(dir, [SPACED_NAME]);
    assert.ok(answer.ok);
    assert.deepEqual(answer.ok && answer.tracked, [SPACED_NAME]);
  });

  it("answers with names that can be handed straight back as pathspecs", () => {
    // What "exact" MEANS here, asserted structurally rather than by spelling
    // out two names a third time: whatever git returns must address the same
    // files when it goes back in. Any transport that mangles a name — escaping
    // it, trimming it, decoding it wrongly — breaks the round trip, including
    // for a name nobody thought to write a case about.
    const dir = repoWithAwkwardNames();
    const first = trackedAmong(dir, [ESCAPED_NAME, SPACED_NAME]);
    assert.ok(first.ok);
    const names = first.ok ? [...first.tracked] : [];
    assert.equal(names.length, 2, "the fixture did not force-add both names");
    const again = trackedAmong(dir, names);
    assert.ok(again.ok);
    assert.deepEqual([...(again.ok ? again.tracked : [])].sort(), names.sort());
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

  it("lists a conflicted path once, which is what the count feeds", () => {
    // `listCommittable`'s doc has always said `--cached` lists a path once per
    // stage during a merge, and nothing ran it: no fixture could produce a
    // conflicted index. Three entries for one file is three reads of it, three
    // findings for one credential, and three toward the scanned floor — a
    // minimum that exists to prove the walk covered the tree, cleared here by
    // counting one file twice over.
    const dir = repoMidMerge();
    const answer = listCommittable(dir);
    assert.ok(answer.ok);
    const files = answer.ok ? answer.files : [];
    assert.deepEqual(
      files.filter((rel) => rel === "conflicted.local.m"),
      ["conflicted.local.m"],
    );
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

/**
 * The fixture the two cases above rest on.
 *
 * Everything in this file is an assertion about git's answers, so the shape of
 * the repository being asked is the premise rather than a detail: a helper that
 * quietly force-added nothing would leave "reports which of the named paths are
 * tracked" passing over an empty index, with `[]` on both sides.
 */
describe("the scratch repository these cases ask about", () => {
  it("commits `.gitignore` and every force-added path, past the ignore rule", () => {
    const dir = repoWithForcedLocal();
    // Read from HEAD rather than the index: `git add -f` alone leaves a file
    // staged, which every query here answers the same way — so a helper that
    // stopped committing would be invisible to `ls-files` and visible to
    // nothing else in the suite.
    const head = spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(head.status, 0, `git ls-tree failed: ${head.stderr}`);
    assert.deepEqual(head.stdout.split("\n").filter(Boolean).sort(), [
      ".gitignore",
      "tracked.local.m",
    ]);
  });

  it("puts `stage` paths in the index and leaves them out of HEAD", () => {
    const dir = repoWithStagedLocal();
    const head = spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(head.status, 0, `git ls-tree failed: ${head.stderr}`);
    // Only `.gitignore` was committed — so the case above is about the index
    // and not about a second spelling of `forceAdd`.
    assert.deepEqual(head.stdout.split("\n").filter(Boolean), [".gitignore"]);
    const committable = listCommittable(dir);
    assert.ok(committable.ok);
    assert.ok(
      (committable.ok ? committable.files : []).includes("staged.local.m"),
      "an ignored file in the index is committable and must stay in the candidate set",
    );
  });

  it("refuses one path named as both committed and staged", () => {
    // Two different states asked for at once. Committing and then re-adding is
    // the committed state, so silently picking it would hand a case a fixture
    // it did not ask for.
    const dir = tempDir("git-io-both-");
    fs.writeFileSync(path.join(dir, "x.local.m"), "Host = \"db.example.invalid\"\n");
    assert.throws(
      () => initGitRoot(dir, "*.local.*\n", { forceAdd: ["x.local.m"], stage: ["x.local.m"] }),
      (error: unknown) =>
        error instanceof GitFixtureError && /both `forceAdd` and `stage`/.test(error.message),
    );
  });

  it("refuses a force-added path that does not exist, and says which", () => {
    // `git add -f missing.local.m` fails in git's words, inside a fixture,
    // several frames from the case that asked for it. The helper answers first.
    const dir = tempDir("git-io-missing-");
    assert.throws(
      () => initGitRoot(dir, "*.local.*\n", { forceAdd: ["missing.local.m"] }),
      (error: unknown) =>
        error instanceof GitFixtureError && /missing\.local\.m.*does not exist/s.test(error.message),
    );
  });

  it("reports a git failure as a fixture error rather than as an assertion", () => {
    // The distinction the throw exists for: this is the fixture failing to be
    // built, not the guard under test answering wrongly, and `assert.equal` on
    // an exit status reported both in the same words. A `cwd` that is not there
    // leaves `status` null, which the old check rendered as `null !== 0`.
    assert.throws(
      () => initGitRoot(path.join(tempDir("git-io-gone-"), "not-a-directory"), ""),
      (error: unknown) => error instanceof GitFixtureError && /could not be run/.test(error.message),
    );
  });
});
