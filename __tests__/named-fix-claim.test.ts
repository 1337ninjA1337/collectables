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
 * Two runs said both named versions were BEHIND the lockfile, so the first
 * version of this held the direction. Eleven runs say that is not enough
 * either: `braces` names `expo@44.0.6` (x5, behind), `react-native@0.87.1`
 * (x3, AHEAD of the locked 0.81.5) and `gh-pages@6.1.1` (x2, behind). A held
 * direction would have been red about 40% of the time.
 *
 * The other three entries never moved across the same eleven runs, so a
 * direction IS holdable per entry and is not holdable for `braces` — which is
 * what `"unstable"` records, with the readings in `observed` and a line on
 * every green run so the exemption cannot go quiet. These cases are about the
 * collapse, the four lists it feeds, the floor on a lockfile that answered
 * nothing, and the two states that must NOT fail.
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
  const accepted = (verdict: "forward" | "no-forward" | "unnamed" | "unstable") => [
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

  it("reports a direction nothing could read rather than treating it as agreement", () => {
    // npm names a package the lockfile has no entry for. The claim is not
    // compared — a disagreement needs two readings — and it does not go
    // quiet either: it lands in `namedFixUnread`, which prints.
    //
    // The floor fires here as well, and that is the point rather than a side
    // effect: this fixture has ONE claimed package and the lockfile answered
    // for none of them, which is indistinguishable from a lockfile that
    // answers nothing at all. The case below is the same reading with a second
    // package the lockfile does answer for, and there it stays green.
    const verdict = evaluateAudit(
      report("expo", { name: "nowhere", version: "1.0.0", isSemVerMajor: true }, GHSA),
      accepted("forward"),
      LOCK,
    );
    assert.equal(verdict.namedFixUnread.length, 1);
    assert.match(verdict.namedFixUnread[0], /no node_modules\/nowhere entry/);
    assert.equal(verdict.namedFixStale.length, 1, "every claim unread is the floor");
  });

  it("never compares an unstable claim, whichever way the run points", () => {
    // The `braces` case. npm answered three ways across eleven runs on one
    // tree, so there is nothing to compare against; a claim that held one of
    // the three would be red about 40% of the time.
    for (const version of ["44.0.6", "57.0.0", "54.0.35"]) {
      const verdict = evaluateAudit(
        report("expo", { name: "expo", version, isSemVerMajor: true }, GHSA),
        accepted("unstable"),
        LOCK,
      );
      assert.deepEqual(verdict.namedFixStale, [], version);
      assert.deepEqual(verdict.namedFixUnread, [], version);
    }
  });

  it("prints every unstable exemption on the green path", () => {
    const printed = formatAuditVerdict(
      evaluateAudit(
        report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA),
        accepted("unstable"),
        LOCK,
      ),
      "check",
      LOCK,
    );
    assert.match(printed, /1 accepted entry exempt from the fix-direction check because npm's own answer varies/);
    assert.match(printed, /expo: read off a fixture \(read 2026-10-05\)/);
  });

  it("fails when the lockfile answered for none of the claimed packages", () => {
    // The floor. A `package-lock.json` that parses and carries no versions
    // makes every direction unread, every claim skipped and both failing lists
    // empty — for exactly the same reason a healthy tree does.
    const verdict = evaluateAudit(
      report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA),
      accepted("no-forward"),
      { packages: {} },
    );
    assert.equal(verdict.namedFixStale.length, 1);
    assert.match(verdict.namedFixStale[0], /the lockfile answered for none of the 1 claimed package/);
    assert.equal(isClean(verdict), false);
  });

  it("does not fire the floor when the lockfile answered for some", () => {
    const verdict = evaluateAudit(
      {
        vulnerabilities: {
          expo: {
            severity: "high",
            fixAvailable: { name: "expo", version: "44.0.6", isSemVerMajor: true },
            effects: [],
            via: [{ source: 1, url: `https://github.com/advisories/${GHSA}`, severity: "high" }],
          },
          other: {
            severity: "high",
            fixAvailable: { name: "nowhere", version: "1.0.0", isSemVerMajor: true },
            effects: [],
            via: [{ source: 2, url: "https://github.com/advisories/GHSA-dddd-eeee-ffff", severity: "high" }],
          },
        },
        metadata: { vulnerabilities: { high: 2 } },
      } as unknown as AuditReport,
      [
        ...accepted("no-forward"),
        {
          package: "other",
          advisories: ["GHSA-dddd-eeee-ffff"],
          shipsToClient: false,
          absentFingerprint: "x",
          why: "a reason somebody can disagree with",
          namedFix: { verdict: "forward" as const, read: "2026-10-05", observed: "read off a fixture" },
        },
      ],
      LOCK,
    );
    assert.deepEqual(verdict.namedFixStale, []);
    assert.equal(verdict.namedFixUnread.length, 1, "the one unread claim is reported, not failed on");
    assert.match(verdict.namedFixUnread[0], /other — claims forward/);
    assert.equal(isClean(verdict), true);
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

  it("makes an unstable claim name more than one version, so it cannot be the easy answer", () => {
    // `unstable` exempts an entry from the only check this field has, so the
    // evidence for it is the whole of its cost. One version is one reading,
    // and one reading cannot establish that an answer varies.
    for (const entry of ACCEPTED_HIGH_ADVISORIES) {
      if (entry.namedFix?.verdict !== "unstable") continue;
      const versions = new Set(entry.namedFix.observed.match(/@\d+\.\d+\.\d+/g) ?? []);
      assert.ok(
        versions.size > 1,
        `${entry.package} claims unstable and its observed reading names ${String(versions.size)} version(s) — that is not a measurement of an answer varying`,
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
