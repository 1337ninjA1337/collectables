import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
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
