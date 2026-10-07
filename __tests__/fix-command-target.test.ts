/**
 * The one output a contributor COPIES, and the last field here still moving.
 *
 * `fixAvailable.name` is npm's own pick of which package to install, and on
 * 2026-10-05 eleven `npm audit --json` runs on one unchanged tree gave it
 * three different values for `braces`: `expo@44.0.6` five times,
 * `react-native@0.87.1` three times, `gh-pages@6.1.1` twice. The grouping and
 * the direction reading moved off that field the same day. The COMMAND did
 * not, deliberately — a five-package `npm update` line is useless — so the
 * printed instruction said `npm update expo` on one run and
 * `npm update react-native` on the next for the same finding.
 *
 * The report has the whole answer: every candidate is itself a vulnerability
 * entry whose `fixAvailable` names itself, so each one's version is readable
 * without depending on which path npm resolved first. Which makes "one package
 * out of the set" a READING rather than a coin toss — and the reading these
 * cases are about is whether the lockfile places it ahead of what is
 * installed, because a package that cannot move forward is a package
 * `npm update` exits 0 over.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AuditReport,
  type FixableAdvisory,
  describeFixChoice,
  evaluateAudit,
  fixCandidates,
  fixCommandPackages,
  fixCommandTargets,
  formatAuditVerdict,
} from "@/lib/audit-baseline";

/** The lockfile this tree actually has, for the four `braces` candidates. */
const LOCK = {
  packages: {
    "node_modules/@sentry/react-native": { version: "7.5.0" },
    "node_modules/expo": { version: "54.0.35" },
    "node_modules/gh-pages": { version: "6.3.0" },
    "node_modules/react-native": { version: "0.81.5" },
  },
};

/** Every candidate's own named version, as `selfNamedVersions` reads them. */
const VERSIONS = new Map([
  ["@sentry/react-native", "5.15.2"],
  ["expo", "44.0.6"],
  ["gh-pages", "6.1.1"],
  ["react-native", "0.87.1"],
]);

const BRACES_GROUP = "@sentry/react-native / expo / gh-pages / react-native";

/**
 * One advisory of the `braces` shape, with `picked` standing for whichever
 * candidate npm named this run.
 *
 * The group is identical whatever `picked` is — that is what makes it the
 * stable identity — so a case that hands two different picks and asserts one
 * answer is asserting exactly the property the eleven runs disproved about
 * `updatePackage`.
 */
function advisory(picked: string): FixableAdvisory {
  return {
    key: "braces#GHSA-aaaa-bbbb-cccc",
    severity: "high",
    updatePackage: picked,
    updateVersion: VERSIONS.get(picked) ?? null,
    updateGroup: BRACES_GROUP,
  };
}

describe("fixCommandTargets", () => {
  it("names the one candidate the lockfile places ahead, not npm's pick", () => {
    const target = fixCommandTargets([advisory("expo")], VERSIONS, LOCK)[0];
    assert.equal(target?.package, "react-native");
    assert.deepEqual(target?.forward, ["react-native"]);
    assert.equal(target?.placed, 4);
  });

  it("gives the same command whichever path npm resolved first", () => {
    // The defect, as a case: four picks, one answer. `updatePackage` is the
    // only thing that differs between these four advisories.
    const commands = ["@sentry/react-native", "expo", "gh-pages", "react-native"].map((picked) =>
      fixCommandPackages([advisory(picked)], VERSIONS, LOCK),
    );
    for (const command of commands) assert.deepEqual(command, ["react-native"]);
  });

  it("falls to the sorted-first when nothing is ahead, which is still stable", () => {
    // Every candidate behind the lockfile. The pick is positional and the
    // sentence below says so — but it is the SAME position on every run,
    // which npm's pick was not.
    const behind = new Map(VERSIONS).set("react-native", "0.70.0");
    for (const picked of ["expo", "react-native"]) {
      const target = fixCommandTargets([advisory(picked)], behind, LOCK)[0];
      assert.equal(target?.package, "@sentry/react-native");
      assert.deepEqual(target?.forward, []);
      assert.equal(target?.placed, 4);
    }
  });

  it("asks nothing without a lockfile and answers the sorted-first", () => {
    // "The question was not asked" rather than "the answer is no": the two
    // `null`s `namedFixReading` distinguishes, in the shape this function has.
    const target = fixCommandTargets([advisory("expo")])[0];
    assert.equal(target?.package, "@sentry/react-native");
    assert.equal(target?.placed, 0);
  });

  it("is one target per group, in the order the groups were reported", () => {
    const targets = fixCommandTargets(
      [
        { ...advisory("expo"), key: "braces#GHSA-aaaa-bbbb-cccc" },
        { ...advisory("react-native"), key: "micromatch#GHSA-aaaa-bbbb-cccd" },
        {
          key: "undici#GHSA-aaaa-bbbb-ccce",
          severity: "moderate",
          updatePackage: "undici",
          updateVersion: null,
          updateGroup: "undici",
        },
      ],
      VERSIONS,
      LOCK,
    );
    assert.deepEqual(
      targets.map((target) => target.group),
      [BRACES_GROUP, "undici"],
    );
  });

  it("collapses two groups that resolve to one package", () => {
    // The dedupe the old version did over `updatePackage` and this has to keep
    // doing one layer later: twelve advisories whose fix is `expo@57` are one
    // `npm update expo`, and two DIFFERENT candidate sets can land on it too.
    assert.deepEqual(
      fixCommandPackages(
        [
          { ...advisory("expo"), updateGroup: "expo / react-native" },
          { ...advisory("expo"), key: "other#GHSA-x", updateGroup: "expo / gh-pages" },
        ],
        new Map([
          ["expo", "57.0.19"],
          ["gh-pages", "6.1.1"],
          ["react-native", "0.70.0"],
        ]),
        LOCK,
      ),
      ["expo"],
    );
  });
});

describe("describeFixChoice", () => {
  it("says nothing for a one-candidate group, which is most of them", () => {
    // Same reason the `(fix in undici)` redirect one function up prints only
    // when there is one: a clause on every line is a clause nobody reads.
    assert.deepEqual(
      describeFixChoice(
        fixCommandTargets(
          [
            {
              key: "undici#GHSA-aaaa-bbbb-cccc",
              severity: "moderate",
              updatePackage: "undici",
              updateVersion: "5.28.4",
              updateGroup: "undici",
            },
          ],
          new Map([["undici", "5.28.4"]]),
          LOCK,
        ),
      ),
      [],
    );
  });

  it("names the three routes it did not take, on one line", () => {
    const said = describeFixChoice(fixCommandTargets([advisory("expo")], VERSIONS, LOCK));
    assert.equal(said.length, 1);
    assert.match(said[0] ?? "", /react-native is the only one of 4 packages/);
    assert.match(said[0] ?? "", /@sentry\/react-native, expo, gh-pages are not/);
  });

  it("counts the forward routes when there is more than one", () => {
    const twoForward = new Map(VERSIONS).set("expo", "57.0.19");
    const said = describeFixChoice(fixCommandTargets([advisory("expo")], twoForward, LOCK))[0] ?? "";
    assert.match(said, /expo is the lowest-sorted of 2 of 4 packages/);
    assert.match(said, /are ahead of the lockfile/);
    // And only the two that are actually behind are named as behind.
    assert.match(said, /@sentry\/react-native, gh-pages are not/);
  });

  it("asks for a reading when the lockfile places nothing ahead", () => {
    const behind = new Map(VERSIONS).set("react-native", "0.70.0");
    assert.match(
      describeFixChoice(fixCommandTargets([advisory("expo")], behind, LOCK))[0] ?? "",
      /places none of them ahead of what is installed, so @sentry\/react-native is the sorted-first rather than a reading/,
    );
  });

  it("distinguishes a lockfile that placed none of them from one that placed all four", () => {
    assert.match(
      describeFixChoice(fixCommandTargets([advisory("expo")], VERSIONS, { packages: {} }))[0] ?? "",
      /placed none of them at all/,
    );
  });
});

/**
 * One in-range advisory under two direct dependents, each naming itself.
 *
 * `isSemVerMajor: false`, so this lands on `fixableInRange` and the printed
 * command is the line under test — `multiCandidate` in
 * `named-fix-claim.test.ts` is the same shape at major, which reaches the
 * green summary instead.
 */
function inRangeMultiCandidate(picked: string): AuditReport {
  const named = (name: string, version: string) => ({ name, version, isSemVerMajor: false });
  return {
    vulnerabilities: {
      expo: {
        severity: "moderate",
        isDirect: true,
        fixAvailable: named("expo", "44.0.6"),
        effects: [],
        via: ["vulnerable"],
      },
      "react-native": {
        severity: "moderate",
        isDirect: true,
        fixAvailable: named("react-native", "0.87.1"),
        effects: [],
        via: ["vulnerable"],
      },
      vulnerable: {
        severity: "moderate",
        isDirect: false,
        fixAvailable: named(picked, picked === "expo" ? "44.0.6" : "0.87.1"),
        effects: ["expo", "react-native"],
        via: [
          {
            source: 1,
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
            severity: "moderate",
          },
        ],
      },
    },
    metadata: { vulnerabilities: { moderate: 3 } },
  } as unknown as AuditReport;
}

describe("the printed command, end to end", () => {
  it("prints the forward candidate and why, whichever one npm named", () => {
    for (const picked of ["expo", "react-native"]) {
      const printed = formatAuditVerdict(
        evaluateAudit(inRangeMultiCandidate(picked), [], LOCK),
        "check",
        LOCK,
      );
      // The command on its own line, the reading indented below it, the
      // paragraph after — three lines rather than one that wraps.
      assert.match(
        printed,
        /Run `npm update react-native` and commit the lockfile\.\n {2}react-native is the only one of 2 packages[^\n]*\nAn advisory a lockfile bump clears/,
        printed,
      );
    }
  });

  it("still prints a bare command when the group gave it no choice", () => {
    const printed = formatAuditVerdict(
      evaluateAudit(
        {
          vulnerabilities: {
            undici: {
              severity: "moderate",
              isDirect: true,
              fixAvailable: { name: "undici", version: "5.28.4", isSemVerMajor: false },
              effects: [],
              via: [
                {
                  source: 1,
                  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
                  severity: "moderate",
                },
              ],
            },
          },
          metadata: { vulnerabilities: { moderate: 1 } },
        } as unknown as AuditReport,
        [],
        { packages: { "node_modules/undici": { version: "5.20.0" } } },
      ),
      "check",
      { packages: { "node_modules/undici": { version: "5.20.0" } } },
    );
    // No choice to explain, so nothing between the command and the paragraph.
    assert.match(
      printed,
      /Run `npm update undici` and commit the lockfile\.\nAn advisory/,
      printed,
    );
  });
});

describe("the backward-fix list the green path prints", () => {
  it("reads every candidate, so its membership does not move between runs", () => {
    // Keyed on npm's pick, `braces` contributed a line on the runs npm named
    // `expo` and contributed nothing on the runs it named `react-native` —
    // a list printed on the GREEN path whose contents moved on an unchanged
    // tree, which is what `bySeverityThenKey`'s header forbids one function
    // away. Both picks now report both backward candidates.
    const lists = ["expo", "react-native"].map(
      (picked) => evaluateAudit(inRangeMultiCandidate(picked), [], LOCK).backwardNamedFixes,
    );
    assert.deepEqual(lists[0], lists[1]);
    assert.deepEqual(lists[0], [
      "expo: npm names 44.0.6, the lockfile is on 54.0.35",
    ]);
  });
});

describe("the redirect beside each finding", () => {
  it("names the package the command names, not the one npm filed it under", () => {
    // Printed from `updatePackage` while the command read the candidate set,
    // the two disagreed on any group with more than one candidate — and a
    // reader resolving that disagreement trusts the one printed next to the
    // advisory, which is the one that cannot move.
    for (const picked of ["expo", "react-native"]) {
      const printed = formatAuditVerdict(
        evaluateAudit(inRangeMultiCandidate(picked), [], LOCK),
        "check",
        LOCK,
      );
      assert.match(printed, /FIXABLE {2}moderate {2}vulnerable#\S+ {2}\(fix in react-native\)/, printed);
      assert.doesNotMatch(printed, /\(fix in expo\)/, printed);
    }
  });

  it("still prints nothing when the fix is the vulnerable package itself", () => {
    const lock = { packages: { "node_modules/undici": { version: "5.20.0" } } };
    const printed = formatAuditVerdict(
      evaluateAudit(
        {
          vulnerabilities: {
            undici: {
              severity: "moderate",
              isDirect: true,
              fixAvailable: { name: "undici", version: "5.28.4", isSemVerMajor: false },
              effects: [],
              via: [
                {
                  source: 1,
                  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
                  severity: "moderate",
                },
              ],
            },
          },
          metadata: { vulnerabilities: { moderate: 1 } },
        } as unknown as AuditReport,
        [],
        lock,
      ),
      "check",
      lock,
    );
    assert.doesNotMatch(printed, /\(fix in/, printed);
  });
});

describe("the backward-fix list, as a flat set of packages", () => {
  it("reads a self-named package no advisory's pick ever points at", () => {
    // What the flat set buys over the per-advisory walk. `gh-pages` carries no
    // advisory OBJECT of its own and sits in nobody's `effects`, so no group
    // contains it and no `updatePackage` is ever it — and npm still reports it
    // as a root whose own fix is a version behind the lockfile, which is
    // exactly what this list claims to be every one of.
    const withPassenger = inRangeMultiCandidate("expo") as unknown as {
      vulnerabilities: Record<string, unknown>;
    };
    withPassenger.vulnerabilities["gh-pages"] = {
      severity: "low",
      isDirect: true,
      fixAvailable: { name: "gh-pages", version: "6.1.1", isSemVerMajor: false },
      effects: [],
      via: ["something"],
    };
    assert.deepEqual(
      evaluateAudit(withPassenger as unknown as AuditReport, [], LOCK).backwardNamedFixes,
      [
        "expo: npm names 44.0.6, the lockfile is on 54.0.35",
        "gh-pages: npm names 6.1.1, the lockfile is on 6.3.0",
      ],
    );
  });
});

/**
 * The premise three callers rest on, held rather than stated.
 *
 * `backwardNamedFixes` reads `selfNamedVersions`' keys AS the union of every
 * group's candidates, `groupCandidates` looks each candidate's name up in the
 * same map, and `fixCommandTargets` takes it as a parameter. The claim is that
 * the two filters are the same one — a candidate is a direct package whose own
 * `fixAvailable` names itself, which is exactly what `selfNamedVersions`
 * collects — and it is true today by reading both bodies and held by nothing.
 *
 * That matters because `fixCandidates` is the function with a pending reason to
 * grow a condition: a 2026-10-05 suggestion asks whether a candidate whose own
 * fix is itself a downgrade (`@sentry/react-native@5.15.2`) belongs in the set
 * at all. Adding that filter there and not here would leave the map holding a
 * name no group contains, and every reader would keep passing.
 */
describe("the candidate set and the version map are one population", () => {
  const union = (report: AuditReport): readonly string[] =>
    [
      ...new Set(
        Object.keys(report.vulnerabilities ?? {}).flatMap((name) => [
          ...fixCandidates(report, name),
        ]),
      ),
    ].sort();

  const versionKeys = (report: AuditReport): readonly string[] =>
    Object.keys(evaluateAudit(report, [], LOCK).candidateVersions).sort();

  it("agrees on every fixture in this file", () => {
    for (const report of [
      inRangeMultiCandidate("expo"),
      inRangeMultiCandidate("react-native"),
    ]) {
      assert.deepEqual(versionKeys(report), union(report), JSON.stringify(union(report)));
    }
  });

  it("names a candidate npm gave no version for, and holds that as the ONE difference", () => {
    // `{ name }` with no `version` is a shape npm emits, and it is the only
    // way the two populations can disagree: `fixCandidates` reads the name and
    // `selfNamedVersions` needs the version. A candidate with no version is in
    // the set and not in the map, which `groupCandidates` already skips by
    // name — so the difference is load-bearing rather than a leak, and a case
    // that asserted bare equality would have to be loosened the day one
    // appears rather than read.
    const versionless = inRangeMultiCandidate("expo") as unknown as {
      vulnerabilities: Record<string, { fixAvailable?: unknown }>;
    };
    versionless.vulnerabilities["react-native"] = {
      ...versionless.vulnerabilities["react-native"],
      fixAvailable: { name: "react-native", isSemVerMajor: false },
    };
    const report = versionless as unknown as AuditReport;
    assert.deepEqual(union(report), ["expo", "react-native"]);
    assert.deepEqual(versionKeys(report), ["expo"]);
  });
});
