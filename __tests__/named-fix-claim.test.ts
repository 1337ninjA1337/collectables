/**
 * The acceptance's claim about npm's fix verdict, and why it is a direction.
 *
 * Four `why` sentences on `ACCEPTED_HIGH_ADVISORIES` named a fix version —
 * `expo@57` twice, `react-native@0.87`, `expo@44` — and on 2026-10-05 all four
 * were read against npm's own report for the first time. None was right.
 * `postcss` and `image-size` claimed a version npm does not name; `node-forge`
 * claimed one npm DOES name, and it is ten majors behind the lockfile, so the
 * sentence called a downgrade a breaking major.
 *
 * The obvious gate — hold the sentence to npm's version — was measured and
 * refused. Two consecutive `npm audit --json` runs on an unchanged tree named
 * two different fixes for `braces`: `expo@44.0.6`, then `gh-pages@6.1.1`. It
 * is reachable under both and npm reports whichever path it resolves first, so
 * a committed version would be red about half the time for nothing.
 *
 * What survived the flip is the DIRECTION — both named versions are behind the
 * lockfile — and that is what `NamedFixClaim.verdict` holds. These cases are
 * about the collapse, the two lists it feeds, and the one case that must NOT
 * fail: a direction nothing could read.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCEPTED_HIGH_ADVISORIES,
  type AuditReport,
  evaluateAudit,
  formatAuditVerdict,
  isClean,
} from "@/lib/audit-baseline";
import { namedFixVerdict, readNamedFix } from "@/lib/named-fix-direction";

import { readRepoFile } from "./helpers/repo-file";

/** A one-package report, in the shape npm emits. */
function report(pkg: string, fixAvailable: unknown, ghsa: string): AuditReport {
  return {
    vulnerabilities: {
      [pkg]: {
        severity: "high",
        fixAvailable,
        effects: [],
        via: [{ source: 1, url: `https://github.com/advisories/${ghsa}`, severity: "high" }],
      },
    },
    metadata: { vulnerabilities: { high: 1 } },
  } as unknown as AuditReport;
}

const LOCK = { packages: { "node_modules/expo": { version: "54.0.35" } } };
const GHSA = "GHSA-aaaa-bbbb-cccc";

describe("namedFixVerdict", () => {
  it("is forward only when npm points ahead of the lockfile", () => {
    assert.equal(namedFixVerdict(readNamedFix(LOCK, "expo", "57.0.0")), "forward");
  });

  it("folds backward and same into no-forward, which is what a claim is about", () => {
    // `same` is npm naming the installed version: nowhere to go, same as
    // behind. They still PRINT differently, because "npm names your own
    // version" is a different thing to go and look at.
    assert.equal(namedFixVerdict(readNamedFix(LOCK, "expo", "44.0.6")), "no-forward");
    assert.equal(namedFixVerdict(readNamedFix(LOCK, "expo", "54.0.35")), "no-forward");
  });

  it("is unnamed when npm named no version", () => {
    assert.equal(namedFixVerdict(null), "unnamed");
  });

  it("is null — unread — when the direction cannot be decided", () => {
    // Not a verdict and not a disagreement. Treating it as a pass would hide a
    // claim nobody checked; failing on it would make the gate red for a
    // lockfile shape.
    assert.equal(namedFixVerdict(readNamedFix(LOCK, "absent", "1.0.0")), null);
    assert.equal(namedFixVerdict(readNamedFix(LOCK, "expo", "not-a-version")), null);
  });

  it("survives the braces flip, which is the whole reason it exists", () => {
    // The two readings npm gave on one unchanged tree, 2026-10-05.
    const lock = {
      packages: {
        "node_modules/expo": { version: "54.0.35" },
        "node_modules/gh-pages": { version: "6.3.0" },
      },
    };
    assert.equal(namedFixVerdict(readNamedFix(lock, "expo", "44.0.6")), "no-forward");
    assert.equal(namedFixVerdict(readNamedFix(lock, "gh-pages", "6.1.1")), "no-forward");
  });
});

describe("the verdict's two named-fix lists", () => {
  const accepted = (verdict: "forward" | "no-forward" | "unnamed") => [
    {
      package: "expo",
      advisories: [GHSA],
      shipsToClient: false,
      absentFingerprint: "x",
      why: "a reason somebody can disagree with",
      namedFix: { verdict, read: "2026-10-05", observed: "read off a fixture" },
    },
  ];

  it("says nothing at all when no lockfile reaches the evaluator", () => {
    // Every existing caller is in this state, which is why none of them moved.
    const verdict = evaluateAudit(report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA), accepted("forward"));
    assert.deepEqual(verdict.namedFixStale, []);
    assert.deepEqual(verdict.namedFixUnclaimed, []);
    assert.equal(isClean(verdict), true);
  });

  it("fails a claim the live report disagrees with, naming both verdicts", () => {
    const verdict = evaluateAudit(
      report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA),
      accepted("forward"),
      LOCK,
    );
    assert.equal(verdict.namedFixStale.length, 1);
    assert.match(verdict.namedFixStale[0], /claims forward \(read 2026-10-05\)/);
    assert.match(verdict.namedFixStale[0], /reads no-forward today/);
    assert.equal(isClean(verdict), false, "a stale claim is one edit, so it fails");
  });

  it("passes a claim the live report agrees with", () => {
    const verdict = evaluateAudit(
      report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA),
      accepted("no-forward"),
      LOCK,
    );
    assert.deepEqual(verdict.namedFixStale, []);
    assert.equal(isClean(verdict), true);
  });

  it("reads a bare `true` fix as unnamed, which is the pinned case", () => {
    const verdict = evaluateAudit(report("expo", true, GHSA), accepted("unnamed"), LOCK);
    assert.deepEqual(verdict.namedFixStale, []);
  });

  it("does not fail on a direction nothing could read", () => {
    // npm names a package the lockfile has no entry for. The claim is simply
    // not checked on this run, and the gate stays green rather than red for a
    // reason it is not about.
    const verdict = evaluateAudit(
      report("expo", { name: "nowhere", version: "1.0.0", isSemVerMajor: true }, GHSA),
      accepted("forward"),
      LOCK,
    );
    assert.deepEqual(verdict.namedFixStale, []);
  });

  it("reports an accepted package with no claim, which is the completeness half", () => {
    const verdict = evaluateAudit(
      report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA),
      [{ package: "expo", advisories: [GHSA], shipsToClient: false, absentFingerprint: "x", why: "a reason somebody can disagree with" }],
      LOCK,
    );
    assert.equal(verdict.namedFixUnclaimed.length, 1);
    assert.match(verdict.namedFixUnclaimed[0], /npm's fix verdict for it reads no-forward today/);
    assert.match(verdict.namedFixUnclaimed[0], /Add a namedFix/);
    assert.equal(isClean(verdict), false);
  });

  it("prints both lists with what to do about them", () => {
    const stale = formatAuditVerdict(
      evaluateAudit(report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA), accepted("forward"), LOCK),
      "check",
      LOCK,
    );
    assert.match(stale, /1 baseline entry with a namedFix direction npm no longer reports/);
    assert.match(stale, /re-read the DIRECTION/);
    const unclaimed = formatAuditVerdict(
      evaluateAudit(
        report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA),
        [{ package: "expo", advisories: [GHSA], shipsToClient: false, absentFingerprint: "x", why: "a reason somebody can disagree with" }],
        LOCK,
      ),
      "check",
      LOCK,
    );
    assert.match(unclaimed, /1 accepted package with nothing said about npm's fix verdict/);
  });
});

describe("this repository's own baseline", () => {
  it("gives every accepted entry a dated claim", () => {
    // The completeness half, held here as well as in the gate: the gate needs a
    // live report and this does not, so a new entry with no claim is red in
    // milliseconds rather than after a 90-second `npm audit`.
    for (const entry of ACCEPTED_HIGH_ADVISORIES) {
      const claim = entry.namedFix;
      assert.ok(claim, `${entry.package} has no namedFix claim`);
      assert.match(claim.read, /^\d{4}-\d{2}-\d{2}$/, entry.package);
      assert.ok(
        claim.observed.length > 20,
        `${entry.package}: observed is the reading the verdict came from, not a label`,
      );
    }
  });

  it("holds the pinned entry at unnamed, which is what a bare `true` is", () => {
    // `image-size` is the one entry npm reports `fixAvailable: true` for, and
    // the one with an `inRangeFixPinned` measurement. The two agree by
    // construction and nothing said so.
    const pinned = ACCEPTED_HIGH_ADVISORIES.filter((entry) => entry.inRangeFixPinned);
    assert.ok(pinned.length > 0);
    for (const entry of pinned) {
      assert.equal(
        entry.namedFix?.verdict,
        "unnamed",
        `${entry.package} measures a pinned in-range fix, which npm reports as a bare \`true\` and therefore names no version`,
      );
    }
  });

  it("names no fix version in a why sentence without the claim backing it", () => {
    // The prose is free to name versions — `observed` does, and so do the four
    // corrected sentences. What must not happen again is a `why` naming one for
    // an entry with no claim at all, which is the state all four were in.
    for (const entry of ACCEPTED_HIGH_ADVISORIES) {
      if (!/@\d+\.\d+/.test(entry.why)) continue;
      assert.ok(
        entry.namedFix,
        `${entry.package}'s why names a version and nothing holds it — that is the 2026-10-05 finding exactly`,
      );
    }
  });

  it("is mirrored in SECURITY.md, which is where the version claims are read", () => {
    const security = readRepoFile("SECURITY.md");
    assert.match(security, /names `expo@44\.0\.6`/);
    // And the section no longer states the version it was wrong about.
    assert.ok(
      !/fix = `expo@57`/.test(security),
      "SECURITY.md still states expo@57 as the fix, which npm does not name",
    );
  });
});
