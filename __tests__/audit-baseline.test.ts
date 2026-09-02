import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ACCEPTED_HIGH_ADVISORIES,
  advisoryIdentity,
  advisoryKey,
  advisoryPackage,
  evaluateAudit,
  fixCommandPackages,
  fixKind,
  formatAuditVerdict,
  isClean,
  observedAdvisories,
  observedAdvisoryDetails,
  observedAdvisoryFixes,
  type AcceptedAdvisory,
  type AuditReport,
} from "@/lib/audit-baseline";
import { LINT_ALL_EXEMPT, LINT_GUARDS } from "@/lib/lint-guards";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The dependency-advisory baseline — SEC-8's drift gate.
 *
 * ## What went wrong without it
 *
 * `npm audit --audit-level=high` ran on every PR as `continue-on-error: true`,
 * which it had to be: the accepted advisories make it red every run. A step
 * that is always red reports the same thing for an advisory somebody triaged
 * and one nobody has ever seen. SECURITY.md recorded "0 high/critical" on
 * 2026-06-28; the tree carried thirteen by 2026-08-31, and the step failed
 * quietly through all of it.
 *
 * ## And what went wrong WITH it, one version in
 *
 * The first baseline keyed on the package NAME. `nanoid` was already carrying
 * two high advisories the day it was written, and the entry's reasoning
 * covered one of them — so the list silently accepted an advisory nobody had
 * read, which is the failure it exists to prevent, one layer in. Keys are
 * `package#advisoryId` now.
 */

/**
 * A report in npm's shape. `advisories` are advisory objects (a root);
 * `dependsOn` is the bare-string `via` npm uses for a package that is only
 * vulnerable through something else.
 */
function report(
  entries: Record<
    string,
    {
      advisories?: { ghsa?: string; source?: number; severity: string }[];
      dependsOn?: string[];
      /** npm's `fixAvailable`, in any of the three shapes it uses. */
      fixAvailable?: unknown;
    }
  >,
): AuditReport {
  return {
    vulnerabilities: Object.fromEntries(
      Object.entries(entries).map(([name, { advisories = [], dependsOn = [], fixAvailable }]) => [
        name,
        {
          severity: advisories[0]?.severity ?? "high",
          fixAvailable,
          via: [
            ...advisories.map((a) => ({
              source: a.source,
              severity: a.severity,
              url: a.ghsa === undefined ? undefined : `https://github.com/advisories/${a.ghsa}`,
              title: `${name} advisory`,
            })),
            ...dependsOn,
          ],
        },
      ]),
    ),
  };
}

const A1 = "GHSA-aaaa-aaaa-aaa1";
const A2 = "GHSA-bbbb-bbbb-bbb2";
const A3 = "GHSA-cccc-cccc-ccc3";

const FIXTURE: readonly AcceptedAdvisory[] = [
  { package: "nanoid", advisories: [A1], shipsToClient: true, why: "vulnerable path unreachable" },
  { package: "postcss", advisories: [A2, A3], shipsToClient: false, why: "build-time only" },
];

describe("evaluateAudit", () => {
  it("passes when every high advisory is on the baseline", () => {
    const verdict = evaluateAudit(
      report({
        nanoid: { advisories: [{ ghsa: A1, severity: "high" }] },
        postcss: {
          advisories: [
            { ghsa: A2, severity: "high" },
            { ghsa: A3, severity: "critical" },
          ],
        },
      }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, []);
    assert.deepEqual(verdict.stillPresent, [`nanoid#${A1}`, `postcss#${A2}`, `postcss#${A3}`]);
    assert.deepEqual(verdict.stale, []);
  });

  it("fails on a SECOND advisory in an already-accepted package", () => {
    // The hole the name-keyed version had, and the reason this one exists:
    // `nanoid` shipped two high advisories and the entry reasoned about one.
    // An accepted package must not be a blanket licence for its next CVE.
    const verdict = evaluateAudit(
      report({
        nanoid: {
          advisories: [
            { ghsa: A1, severity: "high" },
            { ghsa: "GHSA-zzzz-zzzz-zzz9", severity: "high" },
          ],
        },
      }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, ["nanoid#GHSA-zzzz-zzzz-zzz9"]);
    assert.match(formatAuditVerdict(verdict, "check"), /NEW {2}nanoid#GHSA-zzzz-zzzz-zzz9/);
  });

  it("fails on a high advisory in a package nobody has triaged", () => {
    const verdict = evaluateAudit(
      report({ "left-pad": { advisories: [{ ghsa: "GHSA-dddd-dddd-ddd4", severity: "critical" }] } }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, ["left-pad#GHSA-dddd-dddd-ddd4"]);
  });

  it("reports a baseline advisory the audit no longer names as stale", () => {
    // The other direction. An exemption nobody prunes stops describing the
    // tree, and then starts covering something somebody would want to see.
    const verdict = evaluateAudit(
      report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }),
      FIXTURE,
    );
    assert.deepEqual(verdict.stale, [`postcss#${A2}`, `postcss#${A3}`]);
    assert.match(formatAuditVerdict(verdict, "check"), /no longer reported/);
  });

  it("reads severity off the ADVISORY, not off the package", () => {
    // npm reports a package at the highest severity among its advisories, so
    // `postcss` shows "high" while two of its four are moderate. A gate that
    // trusted the package's number would accept those two without reading
    // them — the same blanket-licence shape as the name keying.
    const verdict = evaluateAudit(
      report({
        postcss: {
          advisories: [
            { ghsa: A2, severity: "high" },
            { ghsa: A3, severity: "high" },
            { ghsa: "GHSA-eeee-eeee-eee5", severity: "moderate" },
          ],
        },
      }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, [], "the moderate one is not this gate's business");
  });

  it("ignores a package that is only vulnerable through a dependency", () => {
    // npm reports both kinds. The dependent kind changes whenever the tree is
    // reshaped and says nothing new about exposure — seven of the high entries
    // in this tree are that kind, and a baseline listing them would need
    // editing on every lockfile churn.
    const verdict = evaluateAudit(report({ expo: { dependsOn: ["nanoid"] } }), FIXTURE);
    assert.deepEqual(verdict.unexpected, [], "a dependent is not a triage decision");
  });

  it("treats an empty report as clean rather than as a broken read", () => {
    assert.deepEqual(evaluateAudit({}, FIXTURE).unexpected, []);
    assert.deepEqual(evaluateAudit({}, FIXTURE).stale, [`nanoid#${A1}`, `postcss#${A2}`, `postcss#${A3}`]);
  });
});

/**
 * The second question, added 2026-09-01.
 *
 * The gate above only ever asked whether an advisory was NEW. Four of the six
 * accepted roots — `nanoid`, `brace-expansion`, `js-yaml`, `tar`, seven GHSAs
 * — had an in-range fix available, and one `npm update` cleared all seven.
 * They were on an exemption list being read as triage, and `nanoid` ships to
 * the client. Nothing asked, so nothing found it; two new `browserslist`
 * advisories turning the gate red the same day is what did.
 */
describe("fixKind — npm's three answers to \"can I fix this?\"", () => {
  it("reads a bare `true` as the in-range fix it is", () => {
    // The shape that cost seven exemptions: from anywhere except this field it
    // is indistinguishable from `false`.
    assert.equal(fixKind(true), "in-range");
  });

  it("separates a semver-major upgrade from one `npm update` performs", () => {
    assert.equal(fixKind({ name: "expo", version: "57.0.19", isSemVerMajor: true }), "major");
    assert.equal(fixKind({ name: "nanoid", version: "3.3.18", isSemVerMajor: false }), "in-range");
  });

  it("reads anything it does not recognise as no fix, never as a failure", () => {
    // The gate fails on "in-range" only, so an unrecognised shape must land on
    // the side that cannot invent a red run out of a field npm changed.
    assert.equal(fixKind(false), "none");
    assert.equal(fixKind(undefined), "none");
    assert.equal(fixKind("yes"), "none");
    assert.equal(fixKind(null), "none");
    assert.equal(fixKind({}), "in-range", "an upgrade object with no major flag is still an upgrade");
  });
});

describe("evaluateAudit — an advisory npm can fix is not a triage decision", () => {
  it("fails on an ACCEPTED advisory npm can clear without a major", () => {
    const verdict = evaluateAudit(
      report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }], fixAvailable: true } }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, [], "it is on the list, so it is not new");
    assert.deepEqual(verdict.stillPresent, [`nanoid#${A1}`], "and the exemption is still matched");
    assert.deepEqual(verdict.fixableInRange, [{ key: `nanoid#${A1}`, severity: "high" }]);
    assert.equal(isClean(verdict), false, "being on the baseline must not excuse an available fix");
  });

  it("passes a major-only fix through as information, not as a failure", () => {
    // `expo@57` is a migration. A gate that failed on it would be demanding a
    // major upgrade on every PR, which is how a gate gets switched off.
    const verdict = evaluateAudit(
      report({
        postcss: {
          advisories: [
            { ghsa: A2, severity: "high" },
            { ghsa: A3, severity: "high" },
          ],
          fixAvailable: { name: "expo", version: "57.0.19", isSemVerMajor: true },
        },
        nanoid: { advisories: [{ ghsa: A1, severity: "high" }] },
      }),
      FIXTURE,
    );
    assert.deepEqual(verdict.fixableInRange, []);
    assert.deepEqual(verdict.majorOnly, [
      { key: `postcss#${A2}`, severity: "high" },
      { key: `postcss#${A3}`, severity: "high" },
    ]);
    assert.equal(isClean(verdict), true);
    assert.match(formatAuditVerdict(verdict, "check"), /no fix short of a semver-major/);
  });

  it("reports a NEW advisory with an in-range fix under both headings", () => {
    // Untriaged AND fixable are two true things about one advisory, and the
    // second is the one that says what to do about it. `browserslist` was
    // exactly this: it arrived as NEW and 4.28.7 was already published.
    const verdict = evaluateAudit(
      report({
        browserslist: {
          advisories: [{ ghsa: "GHSA-73wf-gq98-2v4g", severity: "high" }],
          fixAvailable: true,
        },
      }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, ["browserslist#GHSA-73wf-gq98-2v4g"]);
    assert.deepEqual(verdict.fixableInRange, [
      { key: "browserslist#GHSA-73wf-gq98-2v4g", severity: "high" },
    ]);
  });

  it("names each package once in the command it tells you to run", () => {
    const verdict = evaluateAudit(
      report({
        "brace-expansion": {
          advisories: [
            { ghsa: A1, severity: "high" },
            { ghsa: A2, severity: "high" },
            { ghsa: A3, severity: "high" },
          ],
          fixAvailable: true,
        },
      }),
      FIXTURE,
    );
    const printed = formatAuditVerdict(verdict, "check");
    assert.match(printed, /FIXABLE {2}high {6}brace-expansion#/);
    assert.match(
      printed,
      /npm update brace-expansion`/,
      "three advisories on one root are one upgrade, not three",
    );
    assert.doesNotMatch(printed, /brace-expansion brace-expansion/);
  });

  it("a package with no fix at all is neither fixable nor major-only", () => {
    const verdict = evaluateAudit(
      report({
        nanoid: { advisories: [{ ghsa: A1, severity: "high" }], fixAvailable: false },
        postcss: {
          advisories: [
            { ghsa: A2, severity: "high" },
            { ghsa: A3, severity: "high" },
          ],
          fixAvailable: false,
        },
      }),
      FIXTURE,
    );
    assert.deepEqual(verdict.fixableInRange, []);
    assert.deepEqual(verdict.majorOnly, []);
    assert.equal(isClean(verdict), true, "an unfixable accepted advisory is what the list is FOR");
  });

  it("inherits the root's fix verdict for every advisory on it", () => {
    // npm reports `fixAvailable` per vulnerable PACKAGE, and that is its real
    // granularity rather than a simplification here: the fix is an upgrade of
    // the package, so it moves all of its advisories or none.
    const fixes = observedAdvisoryFixes(
      report({
        postcss: {
          advisories: [
            { ghsa: A2, severity: "high" },
            { ghsa: A3, severity: "critical" },
          ],
          fixAvailable: true,
        },
      }),
    );
    assert.deepEqual([...fixes.values()], ["in-range", "in-range"]);
  });

  it("keeps one definition of `observed` for both questions", () => {
    // Two walks would be two chances to disagree about which advisories the
    // gate is even looking at.
    const fixture = report({
      postcss: { advisories: [{ ghsa: A2, severity: "high" }], fixAvailable: true },
      expo: { dependsOn: ["postcss"], fixAvailable: true },
    });
    assert.deepEqual(observedAdvisories(fixture), [...observedAdvisoryFixes(fixture).keys()]);
    assert.deepEqual(observedAdvisories(fixture), [`postcss#${A2}`]);
  });
});

/**
 * The third question, added 2026-09-02.
 *
 * The fix rule shipped reading high/critical only, because it was written
 * inside a high/critical baseline. Measured the next day, THREE roots had an
 * in-range fix waiting and not one of them was high: `dompurify` (low +
 * moderate), `undici` (three moderates), `esbuild` (low). Ten of the tree's
 * fourteen distinct advisories were moderate or low and nothing asked about
 * any of them.
 *
 * `postcss` is the argument. Moderate when it was triaged in June, high by
 * August, on a lockfile nobody had touched — so a moderate with a published
 * fix is a high with a published fix that has not been re-scored yet.
 */
describe("evaluateAudit — the fix rule reads every severity, the baseline does not", () => {
  it("FAILS on a moderate npm can clear in range, with no baseline entry needed", () => {
    // The case the rule was widened for. `undici` was exactly this shape:
    // three moderates, `fixAvailable: true`, invisible to a high/critical scan.
    const verdict = evaluateAudit(
      report({
        undici: {
          advisories: [
            { ghsa: A1, severity: "moderate" },
            { ghsa: A2, severity: "moderate" },
          ],
          fixAvailable: true,
        },
      }),
      FIXTURE,
    );
    assert.deepEqual(verdict.fixableInRange, [
      { key: `undici#${A1}`, severity: "moderate" },
      { key: `undici#${A2}`, severity: "moderate" },
    ]);
    assert.equal(isClean(verdict), false);
    assert.deepEqual(
      verdict.unexpected,
      [],
      "widening the FIX rule must not widen the demand for a triage sentence",
    );
  });

  it("fails on a low one too — the demand is a lockfile bump, not a paragraph", () => {
    // `esbuild`, at CVSS 2.5. Cheap enough that severity is the wrong question:
    // the cost of the fix is what decides, and it is one command either way.
    const verdict = evaluateAudit(
      report({ esbuild: { advisories: [{ ghsa: A3, severity: "low" }], fixAvailable: true } }),
      FIXTURE,
    );
    assert.deepEqual(verdict.fixableInRange, [{ key: `esbuild#${A3}`, severity: "low" }]);
    assert.equal(isClean(verdict), false);
  });

  it("stays SILENT on a moderate npm cannot fix, and on one only a major fixes", () => {
    // The ceiling that makes the widening affordable. A moderate with no
    // cheap fix needs no entry, no sentence and no red run — otherwise ten
    // advisories would each need an argument nobody has, which is the
    // exemption-list-as-paperwork failure this file already has a scar from.
    const verdict = evaluateAudit(
      report({
        "decode-uri-component": {
          advisories: [{ ghsa: A1, severity: "moderate" }],
          fixAvailable: { name: "expo-router", version: "5.1.11", isSemVerMajor: true },
        },
        mystery: { advisories: [{ ghsa: A2, severity: "low" }], fixAvailable: false },
      }),
      [],
    );
    assert.deepEqual(verdict.unexpected, []);
    assert.deepEqual(verdict.fixableInRange, []);
    assert.deepEqual(verdict.majorOnly, [
      { key: `decode-uri-component#${A1}`, severity: "moderate" },
    ]);
    assert.equal(isClean(verdict), true);
  });

  it("reports the two moderates on a high root that the baseline never sees", () => {
    // `postcss` really carries four advisories, two high and two moderate, and
    // the accepted entry lists the two high ones. The moderates were outside
    // every list the gate kept until now; they are in the fix lists' population
    // now, which is how the June-moderate-becomes-August-high event gets seen.
    const verdict = evaluateAudit(
      report({
        postcss: {
          advisories: [
            { ghsa: A2, severity: "high" },
            { ghsa: A3, severity: "moderate" },
          ],
          fixAvailable: true,
        },
      }),
      FIXTURE,
    );
    assert.deepEqual(
      verdict.stillPresent,
      [`postcss#${A2}`],
      "the baseline still matches on the high one alone",
    );
    assert.deepEqual(verdict.fixableInRange, [
      { key: `postcss#${A2}`, severity: "high" },
      { key: `postcss#${A3}`, severity: "moderate" },
    ]);
  });

  it("prints most severe first, and orders ties so two runs can be diffed", () => {
    // Without the key tiebreak the order is whatever `Object.entries` walked,
    // which is lockfile order — a findings list that reshuffles between runs.
    const verdict = evaluateAudit(
      report({
        zeta: { advisories: [{ ghsa: A1, severity: "moderate" }], fixAvailable: true },
        alpha: { advisories: [{ ghsa: A1, severity: "moderate" }], fixAvailable: true },
        omega: { advisories: [{ ghsa: A2, severity: "critical" }], fixAvailable: true },
        beta: { advisories: [{ ghsa: A3, severity: "low" }], fixAvailable: true },
      }),
      [],
    );
    assert.deepEqual(
      verdict.fixableInRange.map((found) => found.key),
      [`omega#${A2}`, `alpha#${A1}`, `zeta#${A1}`, `beta#${A3}`],
    );
  });

  it("sorts a severity npm has not used yet to the bottom rather than crashing", () => {
    // Same direction as `fixKind`'s unknown shape: a field npm changes must not
    // decide anything, and least of all whether this gate can produce a report.
    const verdict = evaluateAudit(
      report({
        weird: { advisories: [{ ghsa: A1, severity: "spicy" }], fixAvailable: true },
        known: { advisories: [{ ghsa: A2, severity: "low" }], fixAvailable: true },
      }),
      [],
    );
    assert.deepEqual(
      verdict.fixableInRange.map((found) => found.severity),
      ["low", "spicy"],
    );
  });

  it("names the severity on every printed finding", () => {
    const printed = formatAuditVerdict(
      evaluateAudit(
        report({ undici: { advisories: [{ ghsa: A1, severity: "moderate" }], fixAvailable: true } }),
        [],
      ),
      "check",
    );
    assert.match(printed, /FIXABLE {2}moderate {2}undici#/);
    assert.doesNotMatch(
      printed,
      /can fix .* high\/critical/,
      "the heading claimed a population the rule no longer reads",
    );
  });

  it("names each package once in the update command, whatever the severity", () => {
    assert.deepEqual(
      fixCommandPackages([
        { key: `undici#${A1}`, severity: "moderate" },
        { key: `undici#${A2}`, severity: "moderate" },
        { key: `esbuild#${A3}`, severity: "low" },
      ]),
      ["undici", "esbuild"],
    );
  });
});

describe("observedAdvisoryDetails — one walk, two populations", () => {
  const mixed = report({
    dompurify: {
      advisories: [
        { ghsa: A1, severity: "low" },
        { ghsa: A2, severity: "moderate" },
      ],
      fixAvailable: true,
    },
    "image-size": { advisories: [{ ghsa: A3, severity: "high" }], fixAvailable: false },
  });

  it("keeps every severity, where `observedAdvisories` keeps two", () => {
    assert.deepEqual(
      [...observedAdvisoryDetails(mixed).keys()],
      [`dompurify#${A1}`, `dompurify#${A2}`, `image-size#${A3}`],
    );
    assert.deepEqual(observedAdvisories(mixed), [`image-size#${A3}`]);
  });

  it("is the walk the narrow one is built from, not a second copy of it", () => {
    // The four conditions that decide what is observable (an advisory OBJECT,
    // with an identity, keyed per package, collapsed to a set) live in one
    // place; the severity filter is a fact about the exemption list and sits
    // outside them.
    const narrow = observedAdvisoryFixes(mixed);
    for (const [key, kind] of narrow) {
      assert.equal(kind, observedAdvisoryDetails(mixed).get(key)?.fix);
    }
    assert.deepEqual([...narrow.keys()], observedAdvisories(mixed));
  });

  it("reads severity off the ADVISORY, never off the package npm rolled it up to", () => {
    // npm reports a package at the highest severity among its advisories, so
    // `dompurify`'s entry says "moderate" while one of its two is low.
    assert.deepEqual(
      [...observedAdvisoryDetails(mixed).values()].map((detail) => detail.severity),
      ["low", "moderate", "high"],
    );
  });

  it("inherits the root's fix verdict for every advisory on it, at any severity", () => {
    assert.deepEqual(
      [...observedAdvisoryDetails(mixed).values()].map((detail) => detail.fix),
      ["in-range", "in-range", "none"],
    );
  });
});

describe("isClean — the one place that decides the exit code", () => {
  const clean = evaluateAudit(report({}), []);

  it("fails on a stale entry, because fixing one is what MAKES it stale", () => {
    // The gate now demands in-range fixes. Applying one removes the advisory
    // from the report, which strands its baseline entry — so leaving staleness
    // advisory-only would mean every fix this gate asks for leaves the accepted
    // list describing a tree that no longer exists, and green.
    const verdict = evaluateAudit(report({}), FIXTURE);
    assert.deepEqual(verdict.stale, [`nanoid#${A1}`, `postcss#${A2}`, `postcss#${A3}`]);
    assert.equal(isClean(verdict), false);
  });

  it("passes only when all three lists are empty", () => {
    assert.equal(isClean(clean), true);
    assert.equal(isClean({ ...clean, unexpected: ["x#y"] }), false);
    assert.equal(isClean({ ...clean, fixableInRange: [{ key: "x#y", severity: "low" }] }), false);
    assert.equal(isClean({ ...clean, stale: ["x#y"] }), false);
    assert.equal(
      isClean({ ...clean, majorOnly: [{ key: "x#y", severity: "critical" }] }),
      true,
      "npm restating a `why` sentence is not a finding",
    );
  });

  it("is what the CLI exits on, rather than a second list of its own", () => {
    // A finding printed by a step that exits 0 is the shape this whole gate
    // replaced, one layer in.
    const script = readRepoFile("scripts/check-audit-baseline.ts");
    assert.match(script, /if \(!isClean\(verdict\)\) process\.exit\(1\)/);
  });

  it("splits `package#advisory` on the LAST separator", () => {
    assert.equal(advisoryPackage("nanoid#GHSA-28wg-ghj8-5hjv"), "nanoid");
    assert.equal(advisoryPackage("@expo/cli#GHSA-1234"), "@expo/cli");
    assert.equal(advisoryPackage("no-separator"), "no-separator");
  });
});

describe("observedAdvisories", () => {
  it("keys every advisory by package and id", () => {
    assert.deepEqual(
      observedAdvisories(
        report({
          tar: { advisories: [{ ghsa: "GHSA-ffff-ffff-fff7", severity: "high" }], dependsOn: ["glob"] },
        }),
      ),
      ["tar#GHSA-ffff-ffff-fff7"],
    );
  });

  it("collapses one advisory seen down several dependency paths", () => {
    // npm emits a `via` object per path, so `brace-expansion`'s three
    // advisories arrived as nine. Keyed on the per-path `source` id the
    // baseline churned with the lockfile — a BLOCKING gate going red for a
    // tree-shape change with no security content, which is how a gate ends up
    // switched off.
    const threePaths = report({
      "brace-expansion": {
        advisories: [
          { ghsa: A1, source: 1, severity: "high" },
          { ghsa: A1, source: 2, severity: "high" },
          { ghsa: A1, source: 3, severity: "high" },
        ],
      },
    });
    assert.deepEqual(observedAdvisories(threePaths), [`brace-expansion#${A1}`]);
  });

  it("skips an advisory object with neither a GHSA nor an id", () => {
    const malformed: AuditReport = {
      vulnerabilities: { mystery: { severity: "high", via: [{ severity: "high" }] } },
    };
    assert.deepEqual(observedAdvisories(malformed), []);
  });

  it("falls back to the numeric id rather than dropping an un-GHSA'd advisory", () => {
    // A worse key — path-sensitive — and still better than a silent hole in a
    // gate whose whole job is to have none.
    assert.equal(advisoryIdentity({ source: 1138811 }), "1138811");
    assert.equal(advisoryIdentity({ source: 1, url: "https://example.test/not-an-advisory" }), "1");
    assert.equal(advisoryIdentity({}), null);
  });

  it("reads the GHSA out of the advisory url", () => {
    assert.equal(
      advisoryIdentity({ source: 9, url: "https://github.com/advisories/GHSA-28wg-ghj8-5hjv" }),
      "GHSA-28wg-ghj8-5hjv",
      "the GHSA wins over the per-path id",
    );
  });

  it("advisoryKey is the one place the format lives", () => {
    assert.equal(advisoryKey("nanoid", "GHSA-28wg-ghj8-5hjv"), "nanoid#GHSA-28wg-ghj8-5hjv");
  });
});

describe("the accepted list is a triage record, not a pile", () => {
  it("gives every entry read advisory ids, a reason, and a reachability answer", () => {
    // `shipsToClient` is the field the severity number cannot answer, and the
    // one that was wrong in SECURITY.md: it claimed every remaining advisory
    // was dev/build-time when `nanoid` had been shipping to users for months.
    for (const entry of ACCEPTED_HIGH_ADVISORIES) {
      assert.ok(entry.package.length > 0);
      assert.ok(
        entry.advisories.length > 0,
        `${entry.package}: an entry with no advisory ids accepts nothing and hides everything`,
      );
      assert.ok(
        entry.advisories.every((id) => /^GHSA-[\w-]+$/.test(id)),
        `${entry.package}: advisories are GHSA ids — npm's numeric \`source\` is per dependency PATH and churns with the lockfile`,
      );
      assert.ok(
        entry.why.length > 20,
        `${entry.package}: "accepted" needs a reason somebody can disagree with`,
      );
      assert.equal(typeof entry.shipsToClient, "boolean");
    }
  });

  it("names no package twice and no advisory id twice", () => {
    const names = ACCEPTED_HIGH_ADVISORIES.map((entry) => entry.package);
    assert.deepEqual([...new Set(names)].sort(), [...names].sort());
    const ids = ACCEPTED_HIGH_ADVISORIES.flatMap((entry) => entry.advisories);
    assert.deepEqual([...new Set(ids)].sort(), [...ids].sort());
  });

  it("is mirrored in SECURITY.md, which is where a human reads it", () => {
    // The list is the machine's copy and SECURITY.md is the one a reviewer or
    // a reporter reads. They drifted once already — that is this whole task.
    const security = readRepoFile("SECURITY.md");
    for (const entry of ACCEPTED_HIGH_ADVISORIES) {
      assert.ok(
        security.includes(`\`${entry.package}\``),
        `${entry.package} is accepted in lib/audit-baseline.ts and absent from SECURITY.md`,
      );
    }
  });

  it("is wired as its own CI step, not as a network-free lint guard", () => {
    // The registry, not the file: `LINT_ALL_EXEMPT` lives in the same module
    // and names this script, which a substring read over the source counts as
    // membership.
    const ci = readRepoFile(".github/workflows/ci.yml");
    assert.match(ci, /^\s*run: npm run lint:audit-baseline$/m);
    // A `run:` line, not any mention: the comment above the step explains what
    // it replaced and names the old command.
    assert.ok(
      !/^\s*run: npm audit --audit-level=/m.test(ci),
      "the always-red step this replaced must not come back beside it",
    );
    assert.ok(
      !LINT_GUARDS.some((guard) => guard.npmScript === "lint:audit-baseline"),
      "a network check is not a code-style guard",
    );
    assert.ok(
      "lint:audit-baseline" in LINT_ALL_EXEMPT,
      "and it has to say why it is not one, or lint-guards.test.ts fails it",
    );
  });
});
