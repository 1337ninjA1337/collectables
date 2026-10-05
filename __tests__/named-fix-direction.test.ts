/**
 * The direction of npm's named fix, which the gate had never asked about.
 *
 * `check-audit-baseline`'s green line said "cleared by 2 upgrades: expo (7, up
 * to high), expo-router (1, up to moderate)" on every run for a month. On
 * 2026-10-05 the `fixAvailable` behind that `expo` group was
 * `{ name: "expo", version: "44.0.6", isSemVerMajor: true }` and the lockfile
 * was on `expo@54.0.35` — ten majors BACKWARD. The same field said the same
 * thing about `gh-pages` (names 6.1.1, locked 6.3.0, and `isSemVerMajor: true`
 * on a move that is not even a major).
 *
 * npm is not wrong: `fixAvailable` answers "is there a version of a direct
 * dependency whose tree lacks this advisory", and an old release qualifies.
 * The gate's reading of it was wrong, and the word it got wrong is the one a
 * contributor would act on.
 *
 * These cases are about the comparison and about what the summary is allowed
 * to claim once it has been made.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AuditVerdict, type FixableAdvisory, formatAuditVerdict, fixVersion } from "@/lib/audit-baseline";
import {
  compareVersions,
  describeDirection,
  fixDirection,
  lockedVersion,
  readNamedFix,
} from "@/lib/named-fix-direction";

import { readRepoFile } from "./helpers/repo-file";

describe("compareVersions", () => {
  it("orders the release part numerically, not as a string", () => {
    // The case that makes a string compare wrong here: "44.0.6" > "54.0.35"
    // lexically on the second character, and 44 < 54 is the whole finding.
    assert.ok((compareVersions("44.0.6", "54.0.35") ?? 0) < 0);
    assert.ok((compareVersions("0.87.1", "0.81.5") ?? 0) > 0);
    assert.ok((compareVersions("6.1.1", "6.3.0") ?? 0) < 0);
    assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  });

  it("sorts a prerelease below its own release", () => {
    assert.ok((compareVersions("1.2.3-rc.1", "1.2.3") ?? 0) < 0);
    assert.ok((compareVersions("1.2.3", "1.2.3-rc.1") ?? 0) > 0);
    assert.ok((compareVersions("1.2.3-rc.1", "1.2.3-rc.2") ?? 0) < 0);
    assert.equal(compareVersions("1.2.3-rc.1", "1.2.3-rc.1"), 0);
  });

  it("ignores build metadata, which semver says is not an ordering", () => {
    assert.equal(compareVersions("1.2.3+build.9", "1.2.3+build.1"), 0);
  });

  it("returns null rather than guessing at a shape it does not know", () => {
    // The direction then reads `unknown` and the gate prints both versions,
    // which is the only honest output for an input nothing here parsed.
    for (const pair of [["1.2", "1.2.3"], ["^1.2.3", "1.2.3"], ["latest", "1.0.0"], ["", "1.0.0"]]) {
      assert.equal(compareVersions(pair[0], pair[1]), null, pair.join(" vs "));
    }
  });
});

describe("fixDirection", () => {
  it("is the three answers and the one non-answer", () => {
    assert.equal(fixDirection("0.87.1", "0.81.5"), "forward");
    assert.equal(fixDirection("44.0.6", "54.0.35"), "backward");
    assert.equal(fixDirection("1.0.0", "1.0.0"), "same");
    assert.equal(fixDirection("1.0.0", "not-a-version"), "unknown");
  });

  it("is unknown when the lockfile has no entry, which is not an error", () => {
    // npm can name a package that is only reachable under another path. The
    // caller says so rather than inventing a direction.
    assert.equal(fixDirection("1.0.0", undefined), "unknown");
  });
});

describe("lockedVersion", () => {
  const lock = {
    packages: {
      "": { name: "root" },
      "node_modules/expo": { version: "54.0.35" },
      "node_modules/react-native": { version: "0.81.5" },
      "node_modules/react-native/node_modules/react-native": { version: "0.86.0" },
      "node_modules/broken": { version: 7 },
    },
  };

  it("reads the root install of a package", () => {
    assert.equal(lockedVersion(lock, "expo"), "54.0.35");
  });

  it("ignores a nested duplicate, which is a second answer to a one-answer question", () => {
    // This tree really does have react-native twice — 0.81.5 at the root and a
    // nested 0.86.0 that `npm run bundle:native` fails on. Picking one
    // silently is exactly how that would stop being visible.
    assert.equal(lockedVersion(lock, "react-native"), "0.81.5");
  });

  it("is undefined for everything it cannot read", () => {
    assert.equal(lockedVersion(lock, "absent"), undefined);
    assert.equal(lockedVersion(lock, "broken"), undefined);
    assert.equal(lockedVersion({}, "expo"), undefined);
    assert.equal(lockedVersion(null, "expo"), undefined);
    assert.equal(lockedVersion("{}", "expo"), undefined);
    assert.equal(lockedVersion({ packages: null }, "expo"), undefined);
  });

  it("reads this repository's own lockfile", () => {
    // The floor every scanner here keeps: a reader that only ever saw a
    // fixture has not been shown to read the real shape. And `expo` in
    // particular, because it is the package the finding was about.
    const real: unknown = JSON.parse(readRepoFile("package-lock.json"));
    assert.match(String(lockedVersion(real, "expo")), /^\d+\.\d+\.\d+$/);
  });
});

describe("describeDirection", () => {
  it("says nothing about a forward fix, which the sentence already states", () => {
    assert.equal(describeDirection(readNamedFix({ packages: { "node_modules/a": { version: "1.0.0" } } }, "a", "2.0.0")), "");
  });

  it("names both versions for a backward one, so the claim is checkable", () => {
    const sentence = describeDirection(
      readNamedFix({ packages: { "node_modules/expo": { version: "54.0.35" } } }, "expo", "44.0.6"),
    );
    assert.match(sentence, /expo@44\.0\.6/);
    assert.match(sentence, /54\.0\.35/);
    assert.match(sentence, /BACKWARD/);
  });

  it("distinguishes the two unknowns, because they are different gaps", () => {
    const noEntry = describeDirection(readNamedFix({ packages: {} }, "a", "1.0.0"));
    assert.match(noEntry, /no node_modules\/a entry/);
    const unparseable = describeDirection(
      readNamedFix({ packages: { "node_modules/a": { version: "weird" } } }, "a", "1.0.0"),
    );
    assert.match(unparseable, /neither reads as an exact version/);
  });

  it("carries no leading punctuation, so a caller can put it on a line", () => {
    const sentence = describeDirection(
      readNamedFix({ packages: { "node_modules/a": { version: "2.0.0" } } }, "a", "1.0.0"),
    );
    assert.ok(!sentence.startsWith(" "), sentence);
    assert.ok(!sentence.startsWith("—"), sentence);
  });
});

describe("fixVersion", () => {
  it("reads npm's object shape and nothing else", () => {
    assert.equal(fixVersion({ name: "expo", version: "44.0.6", isSemVerMajor: true }), "44.0.6");
    // A bare `true` names no version, and there is deliberately no fallback:
    // a guessed version would produce a direction the report never claimed.
    assert.equal(fixVersion(true), null);
    assert.equal(fixVersion(false), null);
    assert.equal(fixVersion(null), null);
    assert.equal(fixVersion({ name: "expo" }), null);
    assert.equal(fixVersion({ version: "" }), null);
    assert.equal(fixVersion({ version: 44 }), null);
  });
});

describe("the green line's claim", () => {
  const clean = (majorOnly: readonly FixableAdvisory[]): AuditVerdict => ({
    unexpected: [],
    stillPresent: [],
    stale: [],
    completeness: { complete: true, claimed: 0, carried: 0, underReported: [] },
    fixableInRange: [],
    pinnedFix: [],
    pinnedFixUnused: [],
    majorOnly,
  });

  const backward = clean([
    { key: "postcss#GHSA-aaaa-aaaa-aaa1", severity: "high", updatePackage: "expo", updateVersion: "44.0.6" },
  ]);
  const lock = { packages: { "node_modules/expo": { version: "54.0.35" } } };

  it("says 'cleared by upgrades' only when nothing says otherwise", () => {
    // No lockfile is "nobody asked", and the line reads as it always did —
    // which is what keeps a fixture with no tree behind it meaningful.
    assert.match(formatAuditVerdict(backward, "check"), /cleared by 1 upgrade: expo \(1, up to high\)/);
  });

  it("stops saying 'cleared by' once a group points backward", () => {
    const printed = formatAuditVerdict(backward, "check", lock);
    assert.ok(!printed.includes("cleared by"), printed);
    assert.match(printed, /named by 1 update, 1 of which npm cannot point forward/);
    assert.match(printed, /expo \(1, up to high, BACKWARD\)/);
  });

  it("puts the detail on its own line rather than inside the list", () => {
    // Inline it wedged a paragraph into the middle of a comma-separated list,
    // which is unreadable at three groups and was the first version of this.
    const printed = formatAuditVerdict(
      clean([
        { key: "postcss#GHSA-aaaa-aaaa-aaa1", severity: "high", updatePackage: "expo", updateVersion: "44.0.6" },
        { key: "q#GHSA-aaaa-aaaa-aaa2", severity: "moderate", updatePackage: "expo-router", updateVersion: "58.0.13" },
      ]),
      "check",
      { packages: { ...lock.packages, "node_modules/expo-router": { version: "56.2.11" } } },
    );
    const lines = printed.split("\n");
    assert.match(lines[0], /expo \(1, up to high, BACKWARD\), expo-router \(1, up to moderate\)/);
    assert.match(lines[1], /^ {2}expo: npm names expo@44\.0\.6/);
    assert.equal(lines.length, 2, "a forward group must not get a detail line");
  });

  it("annotates nothing when every group points forward", () => {
    const printed = formatAuditVerdict(
      clean([
        { key: "q#GHSA-aaaa-aaaa-aaa2", severity: "moderate", updatePackage: "expo-router", updateVersion: "58.0.13" },
      ]),
      "check",
      { packages: { "node_modules/expo-router": { version: "56.2.11" } } },
    );
    assert.match(printed, /cleared by 1 upgrade: expo-router \(1, up to moderate\)\.$/);
  });

  it("makes no claim about a bare `true` fix, which names no version", () => {
    const printed = formatAuditVerdict(
      clean([{ key: "x#GHSA-aaaa-aaaa-aaa3", severity: "high", updatePackage: "x", updateVersion: null }]),
      "check",
      lock,
    );
    assert.match(printed, /cleared by 1 upgrade: x \(1, up to high\)/);
  });
});
