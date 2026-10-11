/**
 * The helper that reads this repository's own lockfile, held to reading it
 * once.
 *
 * Four suites spelled `JSON.parse(readRepoFile("package-lock.json"))` for
 * themselves until 2026-10-11, two of them twice in one file, and one of them
 * reached two levels into the parse by hand — an index that throws a
 * `TypeError` on a v1 lockfile instead of reporting anything.
 * `__tests__/helpers/repo-lockfile.ts` is that read, said once, and it exports
 * four views of it.
 *
 * Four consts in a row describing the same bytes is exactly the shape that
 * stops describing the same bytes: an edit giving one of them its own
 * `readRepoFile` call would compile, pass, and reintroduce the two-readings
 * defect `formatAuditVerdict(verdict, name, lock)` was fixed for on
 * 2026-10-07. The first case ties the chain together.
 *
 * The rest are `lockfileEntries`' two refusals, which exist because the
 * fallback they replaced (`?? {}`) would have made a lockfile nobody could
 * read report five findings about dependents that had moved.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lockedVersions } from "@/lib/lockfile";

import {
  lockfileEntries,
  REPO_INSTALLED,
  REPO_LOCKFILE,
  REPO_LOCKFILE_ENTRIES,
  REPO_LOCKFILE_TEXT,
} from "./helpers/repo-lockfile";

describe("repo-lockfile helper", () => {
  it("is one file read once, from the text through to both views", () => {
    // The claim the four exports rest on. Re-derived from the TEXT rather
    // than from `REPO_LOCKFILE`, so an export that grew its own read would
    // have to agree with the bytes as well as with the parse.
    const reparsed: unknown = JSON.parse(REPO_LOCKFILE_TEXT);
    assert.deepEqual(reparsed, REPO_LOCKFILE);
    assert.deepEqual(lockedVersions(reparsed), REPO_INSTALLED);
    assert.deepEqual(lockfileEntries(reparsed), REPO_LOCKFILE_ENTRIES);
  });

  it("keeps nested copies in the entries and drops them from the record", () => {
    // The asymmetry, asserted rather than only argued in the header. This
    // tree carries react-native at the root and nested, which is the finding
    // `npm run bundle:native` fails on.
    assert.ok(REPO_LOCKFILE_ENTRIES["node_modules/react-native"]);
    assert.ok(
      Object.keys(REPO_LOCKFILE_ENTRIES).some((key) => key.includes("/node_modules/")),
      "no nested key at all, so this case is not checking the asymmetry it claims to",
    );
    for (const name of Object.keys(REPO_INSTALLED)) assert.ok(!name.includes("/node_modules/"));
  });

  it("carries what the pinned-fix measurement reads", () => {
    // The one reader of the raw entries: a dependent's own declared range.
    const metro = REPO_LOCKFILE_ENTRIES["node_modules/metro"];
    assert.ok(metro, "metro is not in the lockfile, so the pinned-fix measurement has no subject");
    assert.equal(typeof metro.dependencies?.["image-size"], "string");
  });

  it("refuses a lockfile with no packages block, naming the layout", () => {
    // `?? {}` here would make every entry absent, and the one reader reports
    // an absent entry as a dependent that moved. Five true-sounding findings
    // about a file nobody could read.
    assert.throws(
      () => lockfileEntries({ lockfileVersion: 1, dependencies: { expo: {} } }),
      /has no `packages` block.*lockfileVersion 1/s,
    );
    assert.throws(() => lockfileEntries({}), /the file parsed and carries no packages/);
    assert.throws(() => lockfileEntries(null), /has no `packages` block/);
  });

  it("refuses a packages block that is there and empty", () => {
    // A different cause and a different instruction: the file is a current
    // lockfile and the tree is simply not installed.
    assert.throws(() => lockfileEntries({ lockfileVersion: 3, packages: {} }), /run npm install/);
  });
});
