import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXPECTED_SENTRY_MAJOR,
  findSentryVersionIssues,
  majorOfRange,
  majorOfVersion,
} from "../lib/check-sentry-version";
import { LINT_GUARDS } from "../lib/lint-guards";
import { unwalkableLockfile } from "../lib/lockfile";

import { readRepoFile } from "./helpers/repo-file";
import { REPO_INSTALLED, REPO_LOCKFILE } from "./helpers/repo-lockfile";

describe("majorOfRange / majorOfVersion", () => {
  it("parses tilde, caret, and exact ranges", () => {
    assert.equal(majorOfRange("~7.5.0"), 7);
    assert.equal(majorOfRange("^7.5.0"), 7);
    assert.equal(majorOfRange("7.5.0"), 7);
    assert.equal(majorOfRange(" ~12.0.1 "), 12);
    assert.equal(majorOfRange("latest"), null);
    assert.equal(majorOfRange(">=7"), null);
    assert.equal(majorOfVersion("7.5.2"), 7);
    assert.equal(majorOfVersion("8.0.0-rc.1"), 8);
    assert.equal(majorOfVersion("garbage"), null);
  });
});

describe("findSentryVersionIssues", () => {
  const ok = {
    declaredRange: `~${EXPECTED_SENTRY_MAJOR}.5.0`,
    lockedVersion: `${EXPECTED_SENTRY_MAJOR}.5.0`,
  };

  it("passes when both stay on the expected major", () => {
    assert.deepEqual(findSentryVersionIssues(ok), []);
    assert.deepEqual(
      findSentryVersionIssues({
        ...ok,
        lockedVersion: `${EXPECTED_SENTRY_MAJOR}.9.3`,
      }),
      [],
      "patch/minor drift within the major is allowed",
    );
  });

  it("flags a missing declaration or lock entry", () => {
    assert.match(
      findSentryVersionIssues({ ...ok, declaredRange: undefined })[0],
      /no longer declares/,
    );
    assert.match(
      findSentryVersionIssues({ ...ok, lockedVersion: undefined })[0],
      /no entry for/,
    );
  });

  it("flags a declared range on another major", () => {
    const issues = findSentryVersionIssues({
      ...ok,
      declaredRange: `~${EXPECTED_SENTRY_MAJOR + 1}.0.0`,
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /targets major/);
    assert.match(issues[0], /EXPECTED_SENTRY_MAJOR/);
  });

  it("flags a locked version on another major", () => {
    const issues = findSentryVersionIssues({
      ...ok,
      lockedVersion: `${EXPECTED_SENTRY_MAJOR + 1}.0.0`,
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /lockfile resolves/);
  });

  it("flags unparseable inputs", () => {
    assert.match(
      findSentryVersionIssues({ ...ok, declaredRange: "latest" })[0],
      /cannot parse a major version/,
    );
    assert.match(
      findSentryVersionIssues({ ...ok, lockedVersion: "garbage" })[0],
      /cannot parse the locked version/,
    );
  });
});

describe("repository state", () => {
  const pkg = JSON.parse(
    readRepoFile("package.json"),
  );

  it("the real package.json + lockfile pass the guard", () => {
    // Through the walk, not through `packages["node_modules/@sentry/react-native"]
    // .version`, which is what this case said until 2026-10-11: an unguarded
    // two-level index that throws a `TypeError` on a v1 lockfile instead of
    // reporting anything, in the one suite whose subject is what this guard
    // does with a lockfile it cannot walk.
    assert.deepEqual(
      findSentryVersionIssues({
        declaredRange: pkg.dependencies["@sentry/react-native"],
        lockedVersion: REPO_INSTALLED["@sentry/react-native"],
        unwalkable: unwalkableLockfile(REPO_LOCKFILE),
      }),
      [],
    );
  });

  it("registers lint:sentry-version in package.json and the lint:all registry", () => {
    assert.equal(
      pkg.scripts["lint:sentry-version"],
      "tsx scripts/check-sentry-version.ts",
    );
    // Registry membership means lint:ci and the ci.yml "Code-style guards"
    // step both run the guard via the lint:all aggregator (wiring pinned
    // in lint-guards.test.ts).
    assert.ok(LINT_GUARDS.some((g) => g.npmScript === "lint:sentry-version"));
  });
});

/**
 * The lockfile this guard could not walk, which used to read as a lockfile
 * that had never heard of Sentry.
 *
 * `lockedVersions` reads `packages`, and a v1 lockfile (npm 6 and older)
 * nests every install under `dependencies`. So the walk returned `{}`, the
 * locked version was `undefined`, and the finding said "package-lock.json has
 * no entry for node_modules/@sentry/react-native" about a file that names it.
 * Both states end at `npm install`, which is why it went unnoticed for as
 * long as it did — and one of the two sentences is false, which is the whole
 * cost.
 *
 * The wrapper now asks `unwalkableLockfile` beside the walk and passes the
 * reason through. These cases hold the one judgement in it: the layout is
 * reported INSTEAD of the absent entry, not beside it.
 */
describe("findSentryVersionIssues with an unwalkable lockfile", () => {
  const V1 = unwalkableLockfile({ lockfileVersion: 1, dependencies: {} });

  it("names the layout instead of claiming there is no entry", () => {
    const issues = findSentryVersionIssues({
      declaredRange: "~7.5.0",
      lockedVersion: undefined,
      unwalkable: V1,
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /^package-lock\.json is lockfileVersion 1,/);
    assert.match(issues[0], /could not read what @sentry\/react-native resolves to$/);
    // The false sentence, gone. A finding list that states a consequence as a
    // second finding reads as two problems.
    assert.ok(!issues.some((i) => i.includes("has no entry for")));
  });

  it("still reports a declared-range problem beside it", () => {
    // The two halves are independent: package.json parsed fine and its range
    // is still wrong, which is a finding this guard can still make.
    const issues = findSentryVersionIssues({
      declaredRange: "~6.0.0",
      lockedVersion: undefined,
      unwalkable: V1,
    });
    assert.equal(issues.length, 2);
    assert.ok(issues.some((i) => i.includes("targets major 6")));
    assert.ok(issues.some((i) => i.includes("lockfileVersion 1")));
  });

  it("is the absent-entry finding again when the lockfile was walkable", () => {
    // The other side of the branch, and the state this repository would be in
    // after `npm uninstall @sentry/react-native`.
    const issues = findSentryVersionIssues({
      declaredRange: "~7.5.0",
      lockedVersion: undefined,
      unwalkable: unwalkableLockfile({ lockfileVersion: 3, packages: {} }),
    });
    assert.deepEqual(issues, [
      "package-lock.json has no entry for node_modules/@sentry/react-native — run npm install",
    ]);
  });

  it("is silent on this repository's own lockfile, which is v3", () => {
    // The floor: the guard must not start reporting the real file as a layout
    // it cannot read.
    assert.equal(unwalkableLockfile(REPO_LOCKFILE), undefined);
    assert.deepEqual(
      findSentryVersionIssues({
        declaredRange: "~7.5.0",
        lockedVersion: REPO_INSTALLED["@sentry/react-native"],
        unwalkable: unwalkableLockfile(REPO_LOCKFILE),
      }),
      [],
    );
  });
});
