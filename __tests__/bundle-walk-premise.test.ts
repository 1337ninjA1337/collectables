import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { BUNDLE_SKIP_DIRS, SECRET_SKIP_DIRS } from "@/lib/secret-scan";
import { isLocalOnlyPath } from "@/lib/local-only";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile, REPO_ROOT } from "./helpers/repo-file";
import { listCommittable } from "../scripts/git-io";

/**
 * Why the bundle scan walks where the source scan asks git.
 *
 * Five separate suggestions filed the same silence: `check-secrets` takes its
 * candidates from `git ls-files` and NAMES the set in its report, and
 * `check-bundle-secrets` walks and says nothing about what it looked at — so a
 * reader meeting the two side by side cannot tell "not applicable" from "not
 * thought about". The guard's header states the reason now, and prose that
 * nothing can break is how the `NEVER_WALKED` drift started. This is the half a
 * change can turn red.
 *
 * The claim has two halves and they pull opposite ways. Git's listing names
 * NOTHING under `dist/`, so asking would hand the scan an empty candidate set
 * over a directory that exists and is full — walking is not this guard's
 * fallback, it is the only enumeration that answers the question. And the set
 * this guard reports on is not what git would take but what the browser was
 * SENT, which is precisely what is on disk.
 */

/** `dist/` is git-ignored whole, which is the premise the walk rests on. */
const DIST = "dist";

describe("the bundle scan's walk, checked against git", () => {
  it("git's listing names nothing under dist/, so asking would scan an empty set", () => {
    const answer = listCommittable(REPO_ROOT);
    // Outside a work tree there is nothing to prove and nothing to fail over —
    // an unpacked tarball of this repository is a real shape this suite runs in.
    if (!answer.ok) return;
    // The premise before the claim: git answered about a tree it actually
    // holds, so an empty `dist/` slice is a fact about the ignore rules rather
    // than about a listing that came back empty for its own reasons.
    assert.ok(
      answer.files.some((rel) => rel.startsWith("scripts/")),
      "git listed nothing under scripts/, so this run proves nothing about dist/",
    );
    const underDist = answer.files.filter((rel) => rel === DIST || rel.startsWith(`${DIST}/`));
    assert.deepEqual(
      underDist,
      [],
      `git lists ${String(underDist.length)} path(s) under ${DIST}/, so the bundle guard's ` +
        `stated reason for walking ("git names nothing here") is no longer true:\n  ` +
        `${underDist.slice(0, 5).join("\n  ")}`,
    );
  });

  it("keeps dist/ out of the SOURCE scan too, from the other side", () => {
    // The same fact seen from the guard that does ask git: `dist/` is generated
    // output, so the source scan would otherwise read a copy of every source
    // file through it. One of the two guards drops it by ignore rule and the
    // other by never being pointed at it — and `.gitignore` is what makes the
    // first one work.
    const ignore = readRepoFile(".gitignore");
    assert.match(
      ignore,
      /^\/?dist\/?$/m,
      "`.gitignore` no longer covers dist/, so git's listing would hand the source scan the bundle",
    );
  });

  it("skips nothing inside dist/, which is what makes the walk exhaustive", () => {
    // The walk is only the right enumeration if it reaches everything. The
    // source scan skips six names; this one skips none, and the empty list is
    // written out rather than omitted for exactly this reason — a vendored tree
    // under `dist/` is a tree that went to the browser.
    assert.deepEqual(BUNDLE_SKIP_DIRS, []);
    assert.ok(
      SECRET_SKIP_DIRS.length > 0,
      "the source scan skips nothing either, so the contrast this asserts is gone",
    );
  });

  it("would skip nothing in dist/ by the `.local.` convention either", () => {
    // The third property riding on the walk. A `*.local.*` name holds a real
    // credential the source scan must not read; nothing generates such a name
    // into `dist/`, and a build that emitted one would have SHIPPED it — so
    // honouring the convention here would skip the one copy that matters.
    // Asserted as the property rather than the absence: the guard does not
    // import `isLocalOnlyPath` at all, and this says what that omission means.
    // Through `stripComments`, because the header EXPLAINS the omission and a
    // raw match would read that explanation as the thing it forbids.
    const code = stripComments(readRepoFile(path.join("scripts", "check-bundle-secrets.ts")));
    assert.doesNotMatch(
      code,
      /isLocalOnlyPath|partitionLocalOnly/,
      "the bundle guard now applies the `.local.` rule — the header says it must not, so one of the two is wrong",
    );
    // And the rule it is declining is a real one, not a name that stopped
    // matching anything: a shipped chunk called this would be skipped.
    assert.equal(isLocalOnlyPath("_expo/static/js/web/entry.local.js"), true);
    assert.equal(isLocalOnlyPath("_expo/static/js/web/entry.js"), false);
  });

  it("states the reason in the guard itself, where a reader of it looks", () => {
    // The documentation half. A suggestion filed five times over two days is a
    // reader failing to find something, so the sentence belongs in the file
    // they opened — not in a commit message and not only here.
    const guard = readRepoFile(path.join("scripts", "check-bundle-secrets.ts"));
    assert.match(
      guard,
      /This scan WALKS, and the one beside it asks git/,
      "the bundle guard no longer says why it walks",
    );
    assert.match(guard, /bundle-walk-premise\.test\.ts/, "the prose no longer names what pins it");
  });
});
