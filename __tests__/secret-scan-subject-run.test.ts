import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { LINT_GUARDS } from "@/lib/lint-guards";

import {
  checkNameOf,
  initGitRoot,
  makePartialRoot,
  runGuardIn,
  type PartialRoot,
} from "./helpers/guard-fixture";
import { SUITES_REL } from "./helpers/suite-files";

/**
 * What `check-secrets` says it is about, and whether that is what it read.
 *
 * The report has always ended "no committed secrets" while the guard walked
 * the WORKING TREE — the same set only on a clean checkout. In one direction
 * that is a hole (closed by the `.local.` rule and the tracked probe); in the
 * other it is noise with a cost: a scratch `notes.md` with a pasted key, an
 * editor backup, a half-finished migration are all read and all reported at
 * the severity of a committed credential, and a guard that cries about files
 * nobody can commit is a guard people learn to run with their eyes closed.
 *
 * So the candidates come from `git ls-files --cached --others
 * --exclude-standard` when git can answer. Both halves of that need a run to
 * prove: that an ignored file with a real-shaped credential in it no longer
 * fails the scan, and that a tree git cannot answer about is still scanned —
 * by the walk, and says so.
 */

const GUARD = LINT_GUARDS.find((g) => checkNameOf(g.scriptPath) === "check-secrets");

/** Built here rather than written, so this file is not itself an offender. */
const PLANTED_KEY = `AKIA${"C".repeat(16)}`;
const SCRATCH = `notes on the pooler\nkey = "${PLANTED_KEY}"\n`;

const fixtures = new Map<string, PartialRoot>();
function rootWith(kind: string, files: Record<string, string>): PartialRoot {
  const existing = fixtures.get(kind);
  if (existing) return existing;
  const fixture = makePartialRoot([SUITES_REL, "lib"], files);
  fixtures.set(kind, fixture);
  return fixture;
}
after(() => {
  for (const fixture of fixtures.values()) fixture.cleanup();
});

describe("check-secrets, and the set it says it is about", () => {
  it("is a guard this repository registers", () => {
    assert.ok(GUARD, "check-secrets is not in LINT_GUARDS");
  });

  it("scans git's committable set inside a work tree, and names it", () => {
    assert.ok(GUARD);
    const fixture = rootWith("ignored-scratch", { "notes.md": SCRATCH });
    initGitRoot(fixture.root, "notes.md\n");
    const run = runGuardIn(GUARD, fixture.root);
    assert.equal(
      run.status,
      0,
      `a credential in a file git will not take failed the scan:\n${run.output}`,
    );
    assert.match(run.output, /from git's committable set/);
    assert.doesNotMatch(run.output, /aws-access-key-id/);
    // And it counts what it left out. Without this number, the run that
    // introduces an ignore rule covering something real reads exactly like the
    // run before it — one file here, `notes.md`, is the whole point.
    assert.match(run.output, /\(1 working-tree file\(s\) not in it\)/);
  });

  it("still reads a file that is merely untracked, which is one `add` from committed", () => {
    assert.ok(GUARD);
    // The half `--others` keeps. Dropping it would be the tempting
    // simplification and would mean a credential pasted into a new file passes
    // every local run until the moment it is committed.
    const fixture = rootWith("untracked-scratch", { "notes.md": SCRATCH });
    initGitRoot(fixture.root, "nothing-here\n");
    const run = runGuardIn(GUARD, fixture.root);
    assert.equal(run.status, 1, `an untracked, unignored credential was not scanned:\n${run.output}`);
    assert.match(run.output, /aws-access-key-id/);
    assert.match(run.output, /notes\.md/);
  });

  it("reads the same set both ways when the two sets are the same", () => {
    assert.ok(GUARD);
    // The cases around this one prove the DIFFERENCES — an ignored file dropped,
    // an untracked one kept — and a filter applied on one path and not the other
    // would leave every one of them green. This is the equality: identical
    // trees, one a plain directory and one a work tree whose ignore file covers
    // nothing, must produce the same verdict over the same number of files.
    const clean = { "notes.md": "nothing here\n" };
    const walked = runGuardIn(GUARD, rootWith("agree-walk", clean).root);
    const inGit = rootWith("agree-git", clean);
    initGitRoot(inGit.root, "nothing-here\n");
    const asked = runGuardIn(GUARD, inGit.root);

    assert.equal(walked.status, 0, walked.output);
    assert.equal(asked.status, 0, asked.output);
    // Counted, not just both-green: "scanned 0 file(s)" would satisfy an
    // exit-status comparison, and the floor is the only thing standing between
    // this case and two runs that agreed about nothing.
    const counted = /scanned (\d+) file\(s\) plus (\d+) entr\(ies\) in (\d+) archive\(s\) from (.+), no committed secrets/;
    const fromWalk = counted.exec(walked.output);
    const fromGit = counted.exec(asked.output);
    assert.ok(fromWalk, `the walk run printed no pass line:\n${walked.output}`);
    assert.ok(fromGit, `the git run printed no pass line:\n${asked.output}`);
    assert.deepEqual(fromGit.slice(1, 4), fromWalk.slice(1, 4));
    assert.ok(Number(fromWalk[1]) > 0, "both runs scanned nothing, so they agreed about nothing");
    // Same answer, different route — which is what makes the equality worth
    // asserting rather than tautological.
    assert.notEqual(fromGit[4], fromWalk[4]);
    // And the count clause stays silent at zero: git left nothing out, so there
    // is nothing for the pass line to say about it.
    assert.doesNotMatch(asked.output, /working-tree file\(s\) not in it/);
  });

  it("does not read through a tracked symlink, and says how many it left", () => {
    assert.ok(GUARD);
    // The one entry the two candidate sources disagreed about. The walk never
    // returns a symlink (`entry.isFile()` is false for one); `git ls-files`
    // lists it, because git tracks it — as its TARGET PATH, a few dozen bytes.
    // `readFileSync` follows it, so before this the scan read whatever the link
    // pointed at and reported it at the LINK's path, as a credential this
    // repository committed. The target here is outside the scan root entirely,
    // which no walk of that root could ever reach.
    const outside = mkdtempSync(path.join(tmpdir(), "secret-scan-outside-"));
    fs.writeFileSync(path.join(outside, "real.md"), SCRATCH, "utf8");
    const fixture = rootWith("symlinked", { "notes.md": "nothing here\n" });
    try {
      fs.symlinkSync(path.join(outside, "real.md"), path.join(fixture.root, "linked.md"));
    } catch {
      // Creating one needs a privilege this environment may not have. Bail
      // rather than assert something this case is not about.
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    try {
      initGitRoot(fixture.root, "nothing-here\n", { forceAdd: ["linked.md"] });
      const run = runGuardIn(GUARD, fixture.root);
      assert.equal(
        run.status,
        0,
        `the scan followed a symlink out of the root it was given:\n${run.output}`,
      );
      // Exit 0 alone would also be the answer if the guard had scanned nothing
      // at all, so the finding's absence is asserted next to the count that
      // says the link was seen and deliberately not read.
      assert.doesNotMatch(run.output, /aws-access-key-id/);
      assert.doesNotMatch(run.output, /linked\.md/);
      assert.match(run.output, /1 listed path\(s\) not regular files/);
      // And it stays a scan: the number the floor is about did not collapse.
      assert.match(run.output, /from git's committable set/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("falls back to the walk outside a work tree, and says that too", () => {
    assert.ok(GUARD);
    // Every guard fixture is a temp directory, and an unpacked tarball of this
    // repository is the same shape. A scan that refused there would be a scan
    // its own harness could not run; one that stayed quiet about it would
    // report identically over two different sets.
    const run = runGuardIn(GUARD, rootWith("no-git", { "notes.md": SCRATCH }).root);
    assert.equal(run.status, 1, `the walk fallback did not scan the tree:\n${run.output}`);
    assert.match(run.output, /aws-access-key-id/);
    const clean = runGuardIn(GUARD, rootWith("no-git-clean", { "notes.md": "nothing here\n" }).root);
    assert.equal(clean.status, 0, clean.output);
    assert.match(clean.output, /from the working tree \(not checked against git: /);
  });
});
