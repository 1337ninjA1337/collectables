import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  EXPECTED_SENTRY_MAJOR,
  findSentryVersionIssues,
  majorOfRange,
  majorOfVersion,
} from "../lib/check-sentry-version";

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
  const root = process.cwd();
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );

  it("the real package.json + lockfile pass the guard", () => {
    assert.deepEqual(
      findSentryVersionIssues({
        declaredRange: pkg.dependencies["@sentry/react-native"],
        lockedVersion:
          lock.packages["node_modules/@sentry/react-native"].version,
      }),
      [],
    );
  });

  it("registers lint:sentry-version in package.json, lint:ci, and ci.yml", () => {
    assert.equal(
      pkg.scripts["lint:sentry-version"],
      "tsx scripts/check-sentry-version.ts",
    );
    assert.ok(pkg.scripts["lint:ci"].includes("npm run lint:sentry-version"));
    const ci = readFileSync(
      path.join(root, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    assert.ok(ci.includes("npm run lint:sentry-version"));
  });
});
