import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  LOCAL_ONLY_MARKER,
  LOCAL_ONLY_NAMES_SHOWN,
  formatLocalOnlyNote,
  formatLocalOnlySkips,
  formatTrackedLocalOnly,
  isLocalOnlyPath,
  partitionLocalOnly,
} from "@/lib/local-only";
import { readRepoFile as read, REPO_ROOT } from "./helpers/repo-file";

/**
 * The `*.local.*` convention, tested where it lives rather than where it was
 * first needed.
 *
 * The rule and these cases used to sit inside `secret-scan.test.ts`, which
 * made them read as a fact about secret scanning. They are not: they are a
 * fact about this repository's file names, and the two git-backed assertions
 * below are what make ANY scan safe to honour the convention — not just the
 * one that happened to want it first.
 */
describe("the `.local.` naming convention", () => {
  it("recognises the names git ignores, and only those", () => {
    for (const rel of [
      "docs/powerbi/queries.local.m",
      "docs/powerbi/Collectables.local.pbit",
      ".env.local.example",
    ]) {
      assert.ok(isLocalOnlyPath(rel), `${rel} carries the marker and was not recognised`);
    }
    // The marker is a SEGMENT, so none of these is one — a substring test on
    // the whole path would take `docs/local/queries.m` out of the scan, and a
    // directory nobody scans is worse than a file nobody scans.
    for (const rel of [
      "docs/powerbi/queries.m",
      "lib/locale-helpers.ts",
      "docs/local/notes.md",
      "lib/my.localization.ts",
      LOCAL_ONLY_MARKER.slice(1),
    ]) {
      assert.ok(!isLocalOnlyPath(rel), `${rel} was taken out of the scan by the marker`);
    }
  });

  it("reads the basename on either separator, so Windows answers the same", () => {
    // `path.sep` differs and the convention must not: a scan whose walk hands
    // back `docs\\powerbi\\queries.local.m` skips the same file as one that
    // hands back forward slashes.
    assert.ok(isLocalOnlyPath("docs\\powerbi\\queries.local.m"));
    assert.ok(!isLocalOnlyPath("docs\\local\\queries.m"));
  });

  it("is ignored by git, which git is asked", () => {
    // The convention is only safe while both halves hold, so both are asked
    // rather than assumed. First: `.gitignore` really does ignore the pattern —
    // if it stopped, every scan honouring this would be skipping committable
    // files.
    for (const rel of ["docs/powerbi/queries.local.m", "docs/powerbi/x.local.pbit"]) {
      const ignored = spawnSync("git", ["check-ignore", "-q", "--no-index", rel], {
        cwd: REPO_ROOT,
      });
      assert.equal(
        ignored.status,
        0,
        `${rel} is skipped by the secret scan and git does NOT ignore it — that is a committable file outside the scan`,
      );
    }
    // Second: nothing tracked matches it anyway. `git add -f` beats
    // `.gitignore`, and a force-added `.local.` file is the one way this rule
    // could hide a real leak.
    const tracked = spawnSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(tracked.status, 0, "git ls-files did not run, so this case proved nothing");
    const forced = tracked.stdout.split("\n").filter((rel) => rel && isLocalOnlyPath(rel));
    assert.deepEqual(
      forced,
      [],
      `these files are tracked and the secret scan skips them: ${forced.join(", ")}`,
    );
  });

  it("tells the reader to paste credentials into the copy git will not take", () => {
    // The instruction is the thing that produces the mistake, so it is the
    // thing that has to name the untracked file.
    assert.match(read("docs/powerbi/queries.m"), /queries\.local\.m/);
    const readme = read("docs/powerbi/README.md");
    assert.match(readme, /queries\.local\.m/);
    assert.match(readme, /\*\.local\.pbit/);
    assert.match(read(".gitignore"), /^\*\.local\.\*$/m);
  });

  it("has one home, and the scan that wanted it first imports from there", () => {
    // The move this file records: `lib/secret-scan.ts` used to define the
    // marker, which is how `NEVER_WALKED` ended up written out twice before
    // `lib/source-dirs.ts` existed. The scan honours the convention; it does
    // not own it.
    const scan = read("lib/secret-scan.ts");
    assert.doesNotMatch(
      scan,
      /export (const SECRET_SKIP_LOCAL_MARKER|function isLocalOnlyPath)/,
      "the convention has a second definition in lib/secret-scan.ts",
    );
    assert.match(read("scripts/check-secrets.ts"), /from "\.\.\/lib\/local-only"/);
  });
});

describe("what a run says about what it skipped", () => {
  it("says nothing when nothing was skipped", () => {
    // A clean checkout's pass line is one line and stays one line; the clause
    // is appended without a branch at the call site, so empty has to mean
    // empty.
    assert.equal(formatLocalOnlySkips([]), "");
  });

  it("names what it passed over, sorted so two machines print one line", () => {
    const clause = formatLocalOnlySkips(["docs/powerbi/z.local.m", "docs/powerbi/a.local.m"]);
    assert.equal(clause, "skipped 2 local-only file(s): docs/powerbi/a.local.m, docs/powerbi/z.local.m");
  });

  it("counts the remainder rather than dropping it", () => {
    const many = Array.from({ length: LOCAL_ONLY_NAMES_SHOWN + 3 }, (_, i) => `f${i}.local.m`);
    const clause = formatLocalOnlySkips(many);
    // Silent truncation reads as "that was all of them", which is the exact
    // silence this clause exists to end.
    assert.match(clause, new RegExp(`\\+3 more$`));
    assert.match(clause, new RegExp(`^skipped ${many.length} local-only file\\(s\\): `));
    assert.equal(clause.split(", ").length, LOCAL_ONLY_NAMES_SHOWN + 1);
  });

  it("states the rule on a failure even when it skipped nothing", () => {
    // The reader this is for misnamed their copy, so their file is NOT in the
    // list — "none this run" is what tells them the rule did not apply to it.
    const note = formatLocalOnlyNote([]);
    assert.match(note, /none this run/);
    assert.match(note, /queries-local\.m/);
    assert.match(note, /\*\.local\.\*/);
  });

  it("names the skipped files in the failure note too", () => {
    const note = formatLocalOnlyNote(["docs/powerbi/queries.local.m"]);
    assert.match(note, /this run: docs\/powerbi\/queries\.local\.m/);
    assert.doesNotMatch(note, /none this run/);
  });

  it("hands back both halves of the walk, in order, rather than filtering", () => {
    // The half a `filter` discards is the half the report needs, and an
    // accumulator written from inside a predicate is state that double-counts
    // the first time anything runs the walk twice.
    const walked = ["lib/a.ts", "docs/queries.local.m", "lib/b.ts", ".env.local.example"];
    assert.deepEqual(partitionLocalOnly(walked), {
      scanned: ["lib/a.ts", "lib/b.ts"],
      localOnly: ["docs/queries.local.m", ".env.local.example"],
    });
    assert.deepEqual(partitionLocalOnly([]), { scanned: [], localOnly: [] });
  });

  it("says on the pass line whether git was asked, and what it said", () => {
    const skipped = ["docs/powerbi/queries.local.m"];
    assert.match(formatLocalOnlySkips(skipped, { asked: true, tracked: [] }), /\(none tracked by git\)/);
    assert.match(
      formatLocalOnlySkips(skipped, { asked: false, reason: "not a git repository" }),
      /\(not a git repository\)/,
    );
    // No probe at all is the old line, unchanged — a caller that cannot ask is
    // not the same as one that asked and got nothing.
    assert.ok(formatLocalOnlySkips(skipped).endsWith("docs/powerbi/queries.local.m"));
  });
});

describe("a `.local.` file git is tracking anyway", () => {
  it("is the one way this convention can hide a committed credential, and it fails", () => {
    const message = formatTrackedLocalOnly({
      asked: true,
      tracked: ["docs/powerbi/z.local.m", "docs/powerbi/a.local.m"],
    });
    assert.match(message, /2 file\(s\) are tracked by git AND skipped/);
    // Sorted and named: "your ignore rules are wrong somewhere" is not
    // something a reader can act on.
    assert.ok(message.indexOf("a.local.m") < message.indexOf("z.local.m"));
    assert.match(message, /git rm --cached/);
  });

  it("says nothing when git found none, or could not be asked", () => {
    assert.equal(formatTrackedLocalOnly({ asked: true, tracked: [] }), "");
    assert.equal(formatTrackedLocalOnly({ asked: false, reason: "not a git repository" }), "");
  });
});
