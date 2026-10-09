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
 * version of this held the direction off npm's pick. Eleven runs said that was
 * not enough either: `braces` names `expo@44.0.6` (x5, behind),
 * `react-native@0.87.1` (x3, AHEAD of the locked 0.81.5) and `gh-pages@6.1.1`
 * (x2, behind), so the direction flipped too and the entry was exempted as
 * "unstable" for a day.
 *
 * Then the report turned out to carry the whole answer. Every package npm
 * could name is itself a vulnerability entry whose `fixAvailable` names
 * itself, so `fixCandidates` enumerates all four of `braces`' candidates
 * deterministically — identical on three runs — and `verdictAcross` reads the
 * verdict over the set. `braces` is `forward`, because `react-native@0.87.1`
 * is one of them; the exemption is gone, and the `react-native@0.87` the
 * acceptance named before 2026-10-05 was right the whole time.
 *
 * These cases are about the candidate walk, the any-forward rule, the four
 * lists it feeds, the floor on a lockfile that answered nothing, and the state
 * that must NOT fail: a verdict nothing could read.
  */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCEPTED_HIGH_ADVISORIES,
  type AuditReport,
  answerWithSecondRead,
  candidateFixes,
  evaluateAudit,
  fixCandidates,
  formatAuditVerdict,
  isClean,
  worthAsking,
} from "@/lib/audit-baseline";
import { lockedVersions, readNamedFix, verdictAcross } from "@/lib/named-fix-direction";

import { readRepoFile } from "./helpers/repo-file";

/**
 * A one-package report, in the shape npm emits.
 *
 * `isDirect: true`, so the package is its own fix candidate when its
 * `fixAvailable` names itself — which is how npm reports a direct dependency
 * with an advisory, and the shape {@link fixCandidates} walks. A fixture
 * without it has no candidates at all and every verdict over it is `unnamed`,
 * which is a different case and has its own fixture below.
 */
function report(pkg: string, fixAvailable: unknown, ghsa: string): AuditReport {
  return {
    vulnerabilities: {
      [pkg]: {
        severity: "high",
        isDirect: true,
        fixAvailable,
        effects: [],
        via: [{ source: 1, url: `https://github.com/advisories/${ghsa}`, severity: "high" }],
      },
    },
    metadata: { vulnerabilities: { high: 1 } },
  } as unknown as AuditReport;
}

/**
 * One advisory whose only candidate is a direct package the lockfile lacks.
 *
 * The unreadable-candidate case, which needs a candidate that EXISTS and
 * cannot be placed — a fixture naming a package npm does not report is a
 * fixture with no candidates, and that reads `unnamed`.
 */
function unplaceableCandidate(): AuditReport {
  return {
    vulnerabilities: {
      nowhere: {
        severity: "high",
        isDirect: true,
        fixAvailable: { name: "nowhere", version: "1.0.0", isSemVerMajor: true },
        effects: [],
        via: ["vulnerable"],
      },
      vulnerable: {
        severity: "high",
        isDirect: false,
        fixAvailable: { name: "nowhere", version: "1.0.0", isSemVerMajor: true },
        effects: ["nowhere"],
        via: [{ source: 1, url: `https://github.com/advisories/${GHSA}`, severity: "high" }],
      },
    },
    metadata: { vulnerabilities: { high: 2 } },
  } as unknown as AuditReport;
}

/**
 * What is installed, as the gate wrapper's one `lockedVersions` walk reads it.
 *
 * `evaluateAudit` takes the record, not a lockfile: the parse is in
 * `scripts/check-audit-baseline.ts` beside the `readFileSync`, so one walk
 * serves both of the gate's reads instead of each re-walking 1,265 keys for a
 * tree that cannot have changed between them.
 */
const LOCK: Readonly<Record<string, string>> = { expo: "54.0.35" };
const MULTI_LOCK: Readonly<Record<string, string>> = {
  expo: "54.0.35",
  "react-native": "0.81.5",
};
const GHSA = "GHSA-aaaa-bbbb-cccc";

/**
 * `braces`' shape: one advisory under two direct dependencies, each naming
 * itself, with `picked` standing for whichever one npm reported this run.
 *
 * `versions` overrides a candidate's own named version, which is how the
 * all-behind case is built without a second fixture.
 */
function multiCandidate(picked: string, versions: Record<string, string> = {}): AuditReport {
  const named = (name: string, version: string) => ({ name, version, isSemVerMajor: true });
  return {
    vulnerabilities: {
      expo: {
        severity: "high",
        isDirect: true,
        fixAvailable: named("expo", versions.expo ?? "44.0.6"),
        effects: [],
        via: ["vulnerable"],
      },
      "react-native": {
        severity: "high",
        isDirect: true,
        fixAvailable: named("react-native", versions["react-native"] ?? "0.87.1"),
        effects: [],
        via: ["vulnerable"],
      },
      vulnerable: {
        severity: "high",
        isDirect: false,
        fixAvailable: named(picked, picked === "expo" ? "44.0.6" : "0.87.1"),
        effects: ["expo", "react-native"],
        via: [{ source: 1, url: `https://github.com/advisories/${GHSA}`, severity: "high" }],
      },
    },
    metadata: { vulnerabilities: { high: 3 } },
  } as unknown as AuditReport;
}

describe("verdictAcross", () => {
  const read = (
    pkg: string,
    version: string,
    installed: Readonly<Record<string, string>> = LOCK,
  ) => readNamedFix(installed, pkg, version);

  it("is forward when ANY candidate is ahead, which is the braces answer", () => {
    // Three dead ends and one route is still a route. Reading this as
    // no-forward is what the acceptance said for a day.
    const lock: Readonly<Record<string, string>> = {
      "@sentry/react-native": "7.5.0",
      expo: "54.0.35",
      "gh-pages": "6.3.0",
      "react-native": "0.81.5",
    };
    assert.equal(
      verdictAcross([
        read("@sentry/react-native", "5.15.2", lock),
        read("expo", "44.0.6", lock),
        read("gh-pages", "6.1.1", lock),
        read("react-native", "0.87.1", lock),
      ]),
      "forward",
    );
  });

  it("is no-forward only when every candidate is at or behind", () => {
    // `same` joins `backward`: npm naming the installed version is npm
    // offering nowhere to go. They still PRINT differently.
    assert.equal(verdictAcross([read("expo", "44.0.6")]), "no-forward");
    assert.equal(verdictAcross([read("expo", "54.0.35")]), "no-forward");
  });

  it("is unnamed for an empty set, which is a bare `true` fix", () => {
    assert.equal(verdictAcross([]), "unnamed");
  });

  it("skips an unreadable candidate rather than withholding the verdict", () => {
    // One candidate the lockfile has no entry for must not silence three that
    // agree — the gate would then report "not checked" for a question the
    // report answered.
    assert.equal(verdictAcross([read("absent", "1.0.0"), read("expo", "57.0.0")]), "forward");
  });

  it("is null — unread — only when no candidate could be placed", () => {
    assert.equal(verdictAcross([read("absent", "1.0.0")]), null);
    assert.equal(verdictAcross([read("expo", "not-a-version")]), null);
  });
});

describe("fixCandidates", () => {
  it("finds every direct dependency whose own fix names itself", () => {
    assert.deepEqual(fixCandidates(multiCandidate("expo"), "vulnerable"), ["expo", "react-native"]);
  });

  it("is the same set whichever candidate npm picked this run", () => {
    // The determinism the whole change rests on: npm's pick rotated between
    // three names for `braces` across eleven runs and this walk did not move
    // across three.
    assert.deepEqual(
      fixCandidates(multiCandidate("expo"), "vulnerable"),
      fixCandidates(multiCandidate("react-native"), "vulnerable"),
    );
  });

  it("leaves out a direct dependent whose fix is somebody else's upgrade", () => {
    // `react-native-reanimated` sits above `braces` and npm never named it,
    // because its own `fixAvailable` names `expo` rather than itself. A bare
    // effects walk would report it as a fix target.
    const withPassenger = multiCandidate("expo") as unknown as {
      vulnerabilities: Record<string, unknown>;
    };
    withPassenger.vulnerabilities["passenger"] = {
      severity: "high",
      isDirect: true,
      fixAvailable: { name: "expo", version: "44.0.6", isSemVerMajor: true },
      effects: [],
      via: ["vulnerable"],
    };
    (withPassenger.vulnerabilities.vulnerable as { effects: string[] }).effects.push("passenger");
    assert.deepEqual(fixCandidates(withPassenger as unknown as AuditReport, "vulnerable"), [
      "expo",
      "react-native",
    ]);
  });

  it("pairs each candidate with the version from its OWN entry", () => {
    // Which is the reading `fixAvailable` looked like it could not give.
    assert.deepEqual(candidateFixes(multiCandidate("expo"), "vulnerable"), [
      { package: "expo", version: "44.0.6" },
      { package: "react-native", version: "0.87.1" },
    ]);
  });

  it("terminates on the cyclic effects this tree really has", () => {
    // `metro` and `metro-config` list each other, so the visited set is
    // load-bearing rather than defensive.
    const cyclic = {
      vulnerabilities: {
        a: { severity: "high", isDirect: false, fixAvailable: true, effects: ["b"], via: ["x"] },
        b: { severity: "high", isDirect: false, fixAvailable: true, effects: ["a"], via: ["x"] },
      },
    } as unknown as AuditReport;
    assert.deepEqual(fixCandidates(cyclic, "a"), []);
  });
});

/** One accepted entry claiming `verdict` about `pkg`, which is the whole input. */
const accepted = (verdict: "forward" | "no-forward" | "unnamed", pkg = "expo") => [
  {
    package: pkg,
    advisories: [GHSA],
    shipsToClient: false,
    absentFingerprint: "x",
    why: "a reason somebody can disagree with",
    namedFix: { verdict, read: "2026-10-05", observed: "read off a fixture" },
  },
];

describe("the verdict's two named-fix lists", () => {
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

  it("reports a verdict nothing could read rather than treating it as agreement", () => {
    // The only candidate is a direct package the lockfile has no entry for, so
    // the claim is not compared — a disagreement needs two readings — and it
    // does not go quiet either: it lands in `namedFixUnread`, which prints.
    //
    // The floor fires here as well, and that is the point rather than a side
    // effect: this fixture has ONE claimed package and the lockfile answered
    // for none of them, which is indistinguishable from a lockfile that
    // answers nothing at all. The case below is the same reading with a second
    // package the lockfile does answer for, and there it stays green.
    const verdict = evaluateAudit(unplaceableCandidate(), accepted("forward", "vulnerable"), LOCK);
    assert.equal(verdict.namedFixUnread.length, 1);
    assert.match(verdict.namedFixUnread[0], /nowhere@1\.0\.0/);
    assert.equal(verdict.namedFixStale.length, 1, "every claim unread is the floor");
  });

  it("reads the verdict over every candidate, not over npm's pick", () => {
    // Two candidates, one forward. npm's pick on any given run is one of them,
    // and the verdict must not depend on which.
    const verdict = evaluateAudit(multiCandidate("expo"), accepted("forward", "vulnerable"), MULTI_LOCK);
    assert.deepEqual(verdict.namedFixStale, [], "any forward candidate means forward");
    const wrong = evaluateAudit(multiCandidate("expo"), accepted("no-forward", "vulnerable"), MULTI_LOCK);
    assert.equal(wrong.namedFixStale.length, 1);
    assert.match(wrong.namedFixStale[0], /reads forward today/);
  });

  it("gives the same verdict whichever candidate npm happened to pick", () => {
    // The `braces` instability, as a case: npm named three different packages
    // across eleven runs on one tree, and the verdict has to be identical.
    for (const picked of ["expo", "react-native"]) {
      const verdict = evaluateAudit(multiCandidate(picked), accepted("forward", "vulnerable"), MULTI_LOCK);
      assert.deepEqual(verdict.namedFixStale, [], picked);
    }
  });

  it("is no-forward only when EVERY candidate is behind", () => {
    const verdict = evaluateAudit(multiCandidate("expo", { "react-native": "0.70.0" }), accepted("no-forward", "vulnerable"), MULTI_LOCK);
    assert.deepEqual(verdict.namedFixStale, []);
  });

  it("fails when the lockfile answered for none of the claimed packages", () => {
    // The floor. A `package-lock.json` that parses and carries no versions
    // makes every direction unread, every claim skipped and both failing lists
    // empty — for exactly the same reason a healthy tree does.
    const verdict = evaluateAudit(
      report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA),
      accepted("no-forward"),
      {},
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
            isDirect: true,
            fixAvailable: { name: "expo", version: "44.0.6", isSemVerMajor: true },
            effects: [],
            via: [{ source: 1, url: `https://github.com/advisories/${GHSA}`, severity: "high" }],
          },
          nowhere: {
            severity: "high",
            isDirect: true,
            fixAvailable: { name: "nowhere", version: "1.0.0", isSemVerMajor: true },
            effects: [],
            via: ["other"],
          },
          other: {
            severity: "high",
            isDirect: false,
            fixAvailable: { name: "nowhere", version: "1.0.0", isSemVerMajor: true },
            effects: ["nowhere"],
            via: [{ source: 2, url: "https://github.com/advisories/GHSA-dddd-eeee-ffff", severity: "high" }],
          },
        },
        metadata: { vulnerabilities: { high: 3 } },
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
    );
    assert.match(unclaimed, /1 accepted package with nothing said about npm's fix verdict/);
  });
});

/**
 * The lockfile is walked ONCE, and what the verdict carries is that walk.
 *
 * `AuditTree.lock` was an `unknown` carried to the leaves, and four readers
 * reached into it through `lockedVersion` — four type guards re-run per
 * candidate, per group, for the one shape anybody wanted out of
 * `package-lock.json`. The parse is now `lockedVersions`, called in
 * `scripts/check-audit-baseline.ts` beside the `readFileSync` that produced
 * the `unknown`, and `evaluateAudit`, `runAuditGate` and `AuditTree` all take
 * the record. These cases are about the join: the verdict carries the object
 * it was handed rather than a second derivation of it, the gate's second read
 * is placed against the same versions as its first, and the walk's one
 * judgement call — a nested duplicate is not the installed version — survives
 * all the way to a printed direction.
 */
describe("the installed versions reach the verdict unparsed", () => {
  it("carries the record it was handed, by reference rather than by copy", () => {
    // By reference on purpose. A copy would be a second thing to keep in step
    // with the first, which is the defect this and three other changes on
    // 2026-10-07 removed from this file.
    const verdict = evaluateAudit(multiCandidate("expo"), accepted("forward", "vulnerable"), MULTI_LOCK);
    assert.equal(verdict.tree?.installed, MULTI_LOCK);
  });

  it("is null for no record and an empty record for a lockfile that answered nothing", () => {
    // The two states the readers used to spell twice — once as a missing tree
    // and once as a `lock === undefined` inside it. Only the first exists now,
    // and the second is a lockfile the walk read and found nothing in.
    assert.equal(evaluateAudit(multiCandidate("expo"), accepted("forward", "vulnerable")).tree, null);
    const answeredNothing = evaluateAudit(multiCandidate("expo"), accepted("forward", "vulnerable"), {});
    assert.deepEqual(answeredNothing.tree?.installed, {});
  });

  it("reads the ROOT install through to the printed direction", () => {
    // This tree really does carry react-native twice: 0.81.5 at the root and a
    // nested 0.86.0 that `npm run bundle:native` fails on. npm names 0.87.1,
    // which is ahead of the root and BEHIND the nested copy — so if the walk
    // had picked the nested one, the verdict would read no-forward and the
    // claim below would be the one that goes stale.
    const nested = lockedVersions({
      packages: {
        "node_modules/expo": { version: "54.0.35" },
        "node_modules/react-native": { version: "0.81.5" },
        "node_modules/react-native/node_modules/react-native": { version: "0.90.0" },
      },
    });
    assert.equal(nested["react-native"], "0.81.5");
    const verdict = evaluateAudit(multiCandidate("expo"), accepted("forward", "vulnerable"), nested);
    assert.equal(verdict.tree?.installed["react-native"], "0.81.5");
    assert.deepEqual(verdict.namedFixStale, []);
  });

  it("places the gate's SECOND read against the same versions", () => {
    // The whole point of moving the parse out: `runAuditGate` evaluates the
    // report and then `answerWithSecondRead` evaluates a second read of it,
    // and a `lock: unknown` option meant each call re-walked the same 1,265
    // keys for a tree nothing had touched in between.
    //
    // `reconcile` keeps the FIRST read's `tree` — "both reads walked the same
    // tree", which is the convention this change turns into a fact about the
    // type — so asserting on `tree` would not observe the second read at all.
    // `backwardNamedFixes` is UNIONED across the two, and every line in it is
    // a version read against `installed`, so a second read handed nothing
    // contributes nothing and this case goes red.
    const incomplete: AuditReport = { vulnerabilities: {}, metadata: { vulnerabilities: { high: 1 } } };
    const first = evaluateAudit(incomplete, accepted("forward"), MULTI_LOCK);
    assert.equal(worthAsking(first), true, "the fixture does not reach the second read");
    assert.deepEqual(first.backwardNamedFixes, [], "the first read already answers this");
    const answered = answerWithSecondRead({
      first,
      readAgain: () => ({
        kind: "answered" as const,
        report: report("expo", { name: "expo", version: "44.0.6", isSemVerMajor: true }, GHSA),
      }),
      checkName: "check",
      underActions: false,
      accepted: accepted("forward"),
      installed: MULTI_LOCK,
    });
    assert.deepEqual(answered.verdict.backwardNamedFixes, [
      "expo: npm names 44.0.6, the lockfile is on 54.0.35",
    ]);
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

  it("makes every claim's observed reading name what it was derived from", () => {
    // `observed` is the evidence for a verdict a gate re-derives, and the one
    // thing that makes it evidence is that it names the candidates. A claim
    // with a verdict and no reading behind it is the state all four entries
    // were in before 2026-10-05.
    for (const entry of ACCEPTED_HIGH_ADVISORIES) {
      const claim = entry.namedFix;
      assert.ok(claim);
      if (claim.verdict === "unnamed") continue;
      assert.match(
        claim.observed,
        /@\d+\.\d+\.\d+/,
        `${entry.package}: observed names no candidate version, so it is a label rather than a reading`,
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
