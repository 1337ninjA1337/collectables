import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import {
  ACCEPTED_HIGH_ADVISORIES,
  answerWithSecondRead,
  advisoryIdentity,
  advisoryKey,
  advisoryPackage,
  evaluateAudit,
  fixCommandPackages,
  fixKind,
  fixPackage,
  formatAuditVerdict,
  formatSecondRead,
  secondReadAgreed,
  secondReadDifference,
  secondReadDisagreements,
  AUDIT_SKIP_CAUSES,
  AUDIT_SPAWN_OPTIONS,
  AUDIT_TIMEOUT_MS,
  auditInvocationSkip,
  auditReader,
  auditSkipHeadline,
  checkedGate,
  isAuditReport,
  isCheckedRun,
  isClean,
  isSkippedRun,
  readAuditPayload,
  skippedGate,
  observedAdvisories,
  observedAdvisoryDetails,
  observedAdvisoryFixes,
  PUBLISHED_ELSEWHERE_NOTE,
  worthAsking,
  reconcileAudit,
  reportCompleteness,
  reportTally,
  runAuditGate,
  skipRead,
  type AcceptedAdvisory,
  type AuditGateChecked,
  type AuditGateRun,
  type AuditGateSkipped,
  type AuditSpawnOptions,
  type AuditRead,
  type AuditSkipCause,
  type AuditReport,
  type AuditVerdict,
} from "@/lib/audit-baseline";
import { isAnnotationLine } from "@/lib/github-annotations";
import { LINT_ALL_EXEMPT, LINT_GUARDS } from "@/lib/lint-guards";

import { measuredFloor } from "./helpers/coverage-floor";
import { moduleDoc, proseNames } from "./helpers/module-doc";
import { readRepoFile, repoPath } from "./helpers/repo-file";
import { sourceCode, sourceFiles } from "./helpers/source-files";

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
      /** npm's `isDirect` — whether `package.json` declares this package. */
      isDirect?: boolean;
      /** npm's `effects` — the vulnerable dependents this advisory reaches. */
      effects?: string[];
    }
  >,
): AuditReport {
  return {
    vulnerabilities: Object.fromEntries(
      Object.entries(entries).map(
        ([name, { advisories = [], dependsOn = [], fixAvailable, isDirect, effects = [] }]) => [
        name,
        {
          severity: advisories[0]?.severity ?? "high",
          fixAvailable,
          isDirect,
          effects,
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
        ],
      ),
    ),
  };
}

/**
 * What a report that accounted for its own totals produces, for the two cases
 * that build a verdict by hand rather than from a report.
 *
 * Those cases are about the printed ORDER of a list no report can produce, so
 * the completeness half is beside their point — but it is not optional, because
 * a `stale: []` means two different things and the verdict is where they are
 * told apart.
 */
const ACCOUNTED_FOR = { claimed: 0, carried: 0, complete: true, underReported: [] } as const;

/** npm's "only a major fixes this, and here is what I would install". */
const majorFix = (name: string): unknown => ({ name, version: "1.0.0", isSemVerMajor: true });

const A1 = "GHSA-aaaa-aaaa-aaa1";
const A2 = "GHSA-bbbb-bbbb-bbb2";
const A3 = "GHSA-cccc-cccc-ccc3";

/**
 * An answered {@link AuditRead}, built rather than spelled.
 *
 * `AuditRead` gained a `kind` so it says which half it is the way
 * `AuditGateRun` does, instead of by whether `report` happened to be present.
 * Sixteen literals in this file would have had to grow the field, which is
 * sixteen chances to write the wrong one.
 *
 * There is no local partner for the skipped half. There was — a `skippedWith`
 * that took `(skip, cause)` and called `skipRead(cause, skip)`, flipping the
 * order in the wrapping, so one pair had two orders in two files that are read
 * together. `skipRead` is exported and is what the module itself builds skips
 * with, which makes it the right thing for a case to build one with too.
 */
const answeredWith = (payload: AuditReport): AuditRead => ({ kind: "answered", report: payload });

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

  it("agrees the stale line with how many entries it names", () => {
    // Three words in one sentence move with the count — "entry"/"entries" and
    // "it"/"them" — and the report is read by a contributor rather than matched
    // by anything. The rule is lib/plural's, which this module used to have a
    // second copy of; these are the two counts that tell the forms apart.
    const two = evaluateAudit(
      report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }),
      FIXTURE,
    );
    assert.match(formatAuditVerdict(two, "check"), /2 baseline entries no longer reported — remove them:/);

    const one = evaluateAudit(
      report({
        nanoid: { advisories: [{ ghsa: A1, severity: "high" }] },
        postcss: { advisories: [{ ghsa: A2, severity: "high" }] },
      }),
      FIXTURE,
    );
    assert.deepEqual(one.stale, [`postcss#${A3}`]);
    assert.match(formatAuditVerdict(one, "check"), /1 baseline entry no longer reported — remove it:/);
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
    assert.deepEqual(verdict.fixableInRange, [
      { key: `nanoid#${A1}`, severity: "high", updatePackage: "nanoid" },
    ]);
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
      { key: `postcss#${A2}`, severity: "high", updatePackage: "expo" },
      { key: `postcss#${A3}`, severity: "high", updatePackage: "expo" },
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
      { key: "browserslist#GHSA-73wf-gq98-2v4g", severity: "high", updatePackage: "browserslist" },
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
      { key: `undici#${A1}`, severity: "moderate", updatePackage: "undici" },
      { key: `undici#${A2}`, severity: "moderate", updatePackage: "undici" },
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
    assert.deepEqual(verdict.fixableInRange, [
      { key: `esbuild#${A3}`, severity: "low", updatePackage: "esbuild" },
    ]);
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
      { key: `decode-uri-component#${A1}`, severity: "moderate", updatePackage: "expo-router" },
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
      { key: `postcss#${A2}`, severity: "high", updatePackage: "postcss" },
      { key: `postcss#${A3}`, severity: "moderate", updatePackage: "postcss" },
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
        { key: `undici#${A1}`, severity: "moderate", updatePackage: "undici" },
        { key: `undici#${A2}`, severity: "moderate", updatePackage: "undici" },
        { key: `esbuild#${A3}`, severity: "low", updatePackage: "esbuild" },
      ]),
      ["undici", "esbuild"],
    );
  });
});

/**
 * The command that ran clean and fixed nothing, found 2026-09-02.
 *
 * The fix rule's first run in anger demanded three updates and printed the
 * wrong package for one of them: `esbuild`'s in-range fix was `npm update
 * tsx`, because `tsx` pinned `esbuild@~0.27.0` while the fix was `>=0.28.1`.
 * `npm update esbuild` exits 0 having changed nothing, which is the worst
 * thing a fix instruction can do — a contributor who follows it literally has
 * no way to tell it did not work except by re-running the gate.
 *
 * The report answered twice over and neither was read: `fixAvailable`'s object
 * shape carries the `name` of the install npm would perform, and where npm
 * names nobody, `effects` plus `isDirect` say which dependent the manifest
 * declares.
 */
describe("the package the command names — npm's report, not the vulnerable one", () => {
  it("names npm's own package when it named one", () => {
    // The strongest source, because npm committed to it: `fixAvailable.name`
    // is the install npm would perform, whatever the advisory is filed under.
    const verdict = evaluateAudit(
      report({
        postcss: {
          advisories: [{ ghsa: A2, severity: "high" }],
          fixAvailable: { name: "expo", version: "57.0.19", isSemVerMajor: false },
        },
      }),
      [],
    );
    assert.deepEqual(verdict.fixableInRange, [
      { key: `postcss#${A2}`, severity: "high", updatePackage: "expo" },
    ]);
    assert.deepEqual(fixCommandPackages(verdict.fixableInRange), ["expo"]);
  });

  it("walks to the dependent the manifest declares when npm named nobody", () => {
    // The `esbuild` shape exactly, and the reason this task exists: npm said
    // `true` and nothing else, `tsx` is what `package.json` declares, and
    // `npm update esbuild` could not have moved anything.
    const verdict = evaluateAudit(
      report({
        esbuild: {
          advisories: [{ ghsa: A3, severity: "low" }],
          fixAvailable: true,
          effects: ["tsx"],
        },
        tsx: { fixAvailable: true, isDirect: true },
      }),
      [],
    );
    assert.deepEqual(verdict.fixableInRange, [
      { key: `esbuild#${A3}`, severity: "low", updatePackage: "tsx" },
    ]);
    assert.deepEqual(fixCommandPackages(verdict.fixableInRange), ["tsx"]);
  });

  it("keeps a direct dependency as its own fix", () => {
    // `package.json` declares it, so it is already the thing `npm update`
    // moves. Walking anywhere from here would name a package further from the
    // problem than the one npm reported.
    const verdict = evaluateAudit(
      report({
        undici: {
          advisories: [{ ghsa: A1, severity: "moderate" }],
          fixAvailable: true,
          isDirect: true,
          effects: ["some-dependent"],
        },
      }),
      [],
    );
    assert.deepEqual(fixCommandPackages(verdict.fixableInRange), ["undici"]);
  });

  it("keeps the vulnerable package when the chain reaches no direct one", () => {
    // Same direction as `fixKind` on an unrecognised shape: fall back to what
    // was true before the field was consulted, never to a guess.
    const verdict = evaluateAudit(
      report({
        "@react-navigation/elements": {
          advisories: [{ ghsa: A1, severity: "moderate" }],
          fixAvailable: true,
          effects: ["@react-navigation/native-stack"],
        },
        "@react-navigation/native-stack": { fixAvailable: true },
      }),
      [],
    );
    assert.deepEqual(fixCommandPackages(verdict.fixableInRange), [
      "@react-navigation/elements",
    ]);
  });

  it("terminates on the cyclic effects this tree actually has", () => {
    // `metro` and `metro-config` list each other. Without the visited set this
    // walk never returns, and the gate hangs rather than fails.
    const cyclic = report({
      metro: { advisories: [{ ghsa: A1, severity: "moderate" }], effects: ["metro-config"] },
      "metro-config": { effects: ["metro"] },
    });
    assert.equal(fixPackage(cyclic, "metro"), "metro");
  });

  it("gives one answer for a package two chains reach", () => {
    // Breadth-first and sorted at each step, so the answer does not depend on
    // which order npm happened to write the report in.
    const diamond = (effects: string[]): AuditReport =>
      report({
        leaf: { advisories: [{ ghsa: A1, severity: "low" }], effects },
        "aaa-root": { isDirect: true },
        "zzz-root": { isDirect: true },
      });
    assert.equal(fixPackage(diamond(["zzz-root", "aaa-root"]), "leaf"), "aaa-root");
    assert.equal(fixPackage(diamond(["aaa-root", "zzz-root"]), "leaf"), "aaa-root");
  });

  it("prefers a nearer direct dependent to a further one", () => {
    // Breadth-first, not depth-first: the shortest path out of the advisory is
    // the smallest upgrade that can clear it.
    const deep = report({
      leaf: { advisories: [{ ghsa: A1, severity: "low" }], effects: ["middle"] },
      middle: { effects: ["far-root"], isDirect: true },
      "far-root": { isDirect: true },
    });
    assert.equal(fixPackage(deep, "leaf"), "middle");
  });

  it("collapses many vulnerable packages onto the one upgrade that clears them", () => {
    // Twelve advisories whose fix is `expo@57` are one `npm update expo`.
    // Naming the vulnerable packages produced a command with twelve names for
    // a single upgrade, which is a command a reader stops trusting.
    const verdict = evaluateAudit(
      report({
        postcss: {
          advisories: [{ ghsa: A1, severity: "high" }],
          fixAvailable: { name: "expo", version: "57.0.19", isSemVerMajor: false },
        },
        "image-size": {
          advisories: [{ ghsa: A2, severity: "moderate" }],
          fixAvailable: { name: "expo", version: "57.0.19", isSemVerMajor: false },
        },
      }),
      [],
    );
    assert.deepEqual(fixCommandPackages(verdict.fixableInRange), ["expo"]);
  });

  it("says on the finding itself where the fix lives, and only when it moved", () => {
    // A redirect on every line is how the redirect stops being read on the one
    // line where it is the whole answer.
    const printed = formatAuditVerdict(
      evaluateAudit(
        report({
          esbuild: {
            advisories: [{ ghsa: A3, severity: "low" }],
            fixAvailable: true,
            effects: ["tsx"],
          },
          tsx: { fixAvailable: true, isDirect: true },
          undici: {
            advisories: [{ ghsa: A1, severity: "moderate" }],
            fixAvailable: true,
            isDirect: true,
          },
        }),
        [],
      ),
      "check",
    );
    assert.match(printed, /FIXABLE {2}low {7}esbuild#[\w-]+ {2}\(fix in tsx\)/);
    assert.doesNotMatch(
      printed,
      /undici#[\w-]+ {2}\(fix in/,
      "a fix in the package's own name is not a redirect worth printing",
    );
    assert.match(
      printed,
      /npm update undici tsx`/,
      "the command names both, in the order the findings printed",
    );
  });

  it("reads a `name` npm has not used yet as no name at all", () => {
    // The shape guard `fixKind` already has, for the same reason: a field npm
    // changes must not be able to put a nonsense token in a command a
    // contributor is told to run.
    const named = (fixAvailable: unknown): string =>
      fixPackage(report({ undici: { fixAvailable } }), "undici");
    assert.equal(named({ isSemVerMajor: false }), "undici");
    assert.equal(named({ name: "" }), "undici");
    assert.equal(named({ name: 7 }), "undici");
    assert.equal(named(true), "undici");
    assert.equal(named(null), "undici");
    assert.equal(fixPackage({}, "undici"), "undici", "a report with no vulnerabilities at all");
  });
});

/**
 * What a passing run is allowed to say, decided 2026-09-02.
 *
 * The OK line listed every major-only advisory by `package#GHSA` and severity.
 * That was four names when the fix rule read high/critical only, and became
 * EIGHT the day it widened to every severity — a green line long enough to
 * wrap, half of it moderates the baseline deliberately does not triage. Noise
 * on the green path is how the previous version of this gate stopped being
 * read, and nothing decided how much a passing run could say.
 *
 * It says UPGRADES now: bounded by how many packages would clear the
 * advisories rather than by how many advisories there are, and in the same
 * vocabulary the failing path has used since it started naming npm's own fix
 * target.
 */
describe("the OK line — upgrades, never advisories", () => {
  /**
   * The real tree's shape: two highs the baseline has read, two moderates it
   * deliberately has not, four advisories over three vulnerable packages, and
   * two upgrades that clear all of them.
   */
  const expoTree = (): AuditReport =>
    report({
      postcss: {
        advisories: [
          { ghsa: A1, severity: "high" },
          { ghsa: A2, severity: "moderate" },
        ],
        fixAvailable: majorFix("expo"),
      },
      "image-size": {
        advisories: [{ ghsa: A3, severity: "high" }],
        fixAvailable: majorFix("expo"),
      },
      "decode-uri-component": {
        advisories: [{ ghsa: A1, severity: "moderate" }],
        fixAvailable: majorFix("expo-router"),
      },
    });

  /** The two highs above, triaged — otherwise they are findings, not an OK line. */
  const TRIAGED: readonly AcceptedAdvisory[] = [
    { package: "postcss", advisories: [A1], shipsToClient: false, why: "build-time only" },
    { package: "image-size", advisories: [A3], shipsToClient: false, why: "build-time only" },
  ];

  /**
   * Default `[]`: a baseline entry the fixture does not produce is STALE, and
   * a stale entry is a failing run with no OK line to read.
   */
  const okLine = (fixture: AuditReport, accepted: readonly AcceptedAdvisory[] = []): string =>
    formatAuditVerdict(evaluateAudit(fixture, accepted), "check");

  it("counts advisories and names the upgrades that clear them", () => {
    assert.equal(
      isClean(evaluateAudit(expoTree(), TRIAGED)),
      true,
      "major-only is reported, never failed",
    );
    const printed = okLine(expoTree(), TRIAGED);
    assert.match(printed, /no fix short of a semver-major for 4 advisories, cleared by 2 upgrades/);
    assert.match(printed, /expo \(3, up to high\)/);
    assert.match(printed, /expo-router \(1, up to moderate\)/);
  });

  it("prints no advisory ids at all on the green path", () => {
    // The ids are what a FAILING run prints. A reader who wants them on a
    // green run wants `npm audit`, and eight of them was the noise this line
    // was rewritten to stop producing.
    assert.doesNotMatch(okLine(expoTree(), TRIAGED), /GHSA-/);
  });

  it("names each upgrade once, however many advisories it covers", () => {
    assert.equal(
      okLine(expoTree(), TRIAGED).match(/\bexpo \(/g)?.length,
      1,
      "three advisories cleared by `expo` are one upgrade, not three",
    );
  });

  it("orders most severe first, then by how much the upgrade buys", () => {
    // An OK line that reshuffles between runs is one nobody can diff — the
    // same reason the findings have a total order.
    const printed = okLine(
      report({
        low1: { advisories: [{ ghsa: A1, severity: "low" }], fixAvailable: majorFix("zeta") },
        low2: { advisories: [{ ghsa: A2, severity: "low" }], fixAvailable: majorFix("zeta") },
        alpha: { advisories: [{ ghsa: A3, severity: "low" }], fixAvailable: majorFix("alpha") },
        mid: { advisories: [{ ghsa: A1, severity: "moderate" }], fixAvailable: majorFix("omega") },
      }),
    );
    const order = [...printed.matchAll(/([\w-]+) \(\d+, up to/g)].map((m) => m[1]);
    assert.deepEqual(order, ["omega", "zeta", "alpha"]);
  });

  it("derives each group's worst severity rather than trusting the list's order", () => {
    // `majorOnly` arrives sorted, so the worst of a group is first BY LUCK.
    // The verdict is built by hand here precisely because no report can
    // produce this order — which is the point: a summary that read position 0
    // would be wrong the day the ordering is decided somewhere else.
    const printed = formatAuditVerdict(
      {
        unexpected: [],
        stillPresent: [],
        stale: [],
        completeness: ACCOUNTED_FOR,
        fixableInRange: [],
        majorOnly: [
          { key: `mild#${A1}`, severity: "low", updatePackage: "one-root" },
          { key: `severe#${A2}`, severity: "high", updatePackage: "one-root" },
        ],
      },
      "check",
    );
    assert.match(printed, /one-root \(2, up to high\)/);
  });

  it("says nothing at all when npm has no major-only advisory to report", () => {
    const printed = okLine(report({}));
    assert.match(printed, /none accepted\.$/);
    assert.doesNotMatch(printed, /semver-major/, "a clause about an empty list is pure noise");
  });

  it("names the packages the run is still accepting, not just how many", () => {
    // The half of the line that records a HUMAN decision was a bare count
    // while the half npm computes had been given a vocabulary. "4 accepted
    // high/critical advisories" tells a reader nothing to look up; the
    // packages are what SECURITY.md is indexed by.
    const printed = okLine(expoTree(), TRIAGED);
    assert.match(printed, /2 still accepted, in image-size \(1\), postcss \(1\)/);
    assert.doesNotMatch(printed, /GHSA-/, "the ids stay on the failing path");
  });

  it("groups the accepted half by the vulnerable package, not the upgrade", () => {
    // The two halves group by different things on purpose: one reader is
    // about to run `npm update`, the other is about to re-read a `why`
    // sentence. `postcss` is accepted here and cleared by `expo` there, and
    // the line says both.
    const printed = okLine(expoTree(), TRIAGED);
    assert.match(printed, /still accepted, in [^;]*postcss/);
    assert.match(printed, /cleared by 2 upgrades: expo \(/);
    assert.doesNotMatch(printed, /still accepted, in [^;]*\bexpo\b/);
  });

  it("orders the accepted packages widest first, then by name", () => {
    // Same total order the upgrade groups have, minus the severity: every
    // key here is high or critical, because that is what the baseline is a
    // list of. A green line that reshuffles is one nobody can diff.
    const printed = formatAuditVerdict(
      {
        unexpected: [],
        stillPresent: [`alpha#${A1}`, `wide#${A1}`, `wide#${A2}`, `mid#${A3}`],
        stale: [],
        completeness: ACCOUNTED_FOR,
        fixableInRange: [],
        majorOnly: [],
      },
      "check",
    );
    const order = [...printed.matchAll(/([\w-]+) \(\d+\)/g)].map((m) => m[1]);
    assert.deepEqual(order, ["wide", "alpha", "mid"]);
  });

  it("separates the three clauses with semicolons, because two end in lists", () => {
    // `image-size (2), postcss (2), and npm offers…` put the last group and
    // the next clause in the same punctuation, which is how a reader loses
    // track of which list they are still in.
    const printed = okLine(expoTree(), TRIAGED);
    assert.match(printed, /OK — no new high\/critical advisories; /);
    assert.match(printed, /; and npm offers no fix/);
  });

  it("is absent from a failing run, where the findings are the message", () => {
    const printed = formatAuditVerdict(
      evaluateAudit(
        report({ undici: { advisories: [{ ghsa: A1, severity: "moderate" }], fixAvailable: true } }),
        [],
      ),
      "check",
    );
    assert.doesNotMatch(printed, /OK —/);
  });
});

/**
 * The failure shape nobody had met, added 2026-09-02.
 *
 * Eight of the nine `verify` legs read the tree: the same commit gives the
 * same answer next year. This one asks the registry what the world knows
 * today, so a green tree goes red with no commit in between — and the first
 * reading of a red gate on your own PR is that your diff did it, because every
 * other red in this repo means exactly that.
 */
describe("the note on every failure — the run that fails is not the run that caused it", () => {
  const failing = (verdict: AuditVerdict): string => formatAuditVerdict(verdict, "check");

  it("rides on all three failing paths, not just the untriaged one", () => {
    // An advisory published makes `unexpected`, a fix published makes
    // `fixableInRange`, an advisory withdrawn makes `stale`. All three can
    // arrive overnight, so all three carry the sentence.
    const unexpected = evaluateAudit(
      report({ browserslist: { advisories: [{ ghsa: A1, severity: "high" }] } }),
      FIXTURE,
    );
    const fixable = evaluateAudit(
      report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }], fixAvailable: true } }),
      FIXTURE,
    );
    const stale = evaluateAudit(report({}), FIXTURE);
    for (const [label, verdict] of [
      ["unexpected", unexpected],
      ["fixableInRange", fixable],
      ["stale", stale],
    ] as const) {
      assert.equal(isClean(verdict), false, label);
      assert.ok(failing(verdict).includes(PUBLISHED_ELSEWHERE_NOTE), label);
    }
  });

  it("is absent from a passing run, where it would be noise on the green path", () => {
    const clean = evaluateAudit(report({}), []);
    assert.equal(isClean(clean), true);
    assert.ok(!failing(clean).includes(PUBLISHED_ELSEWHERE_NOTE));
  });

  it("says the fix still belongs on this branch, rather than excusing the red", () => {
    // The sentence exists to stop a reader hunting their own diff. It must not
    // also read as permission to merge past the gate, which is the direction
    // "your PR did not do this" slides in on its own.
    assert.match(PUBLISHED_ELSEWHERE_NOTE, /npm registry/);
    assert.match(PUBLISHED_ELSEWHERE_NOTE, /belongs on this branch/);
  });

  it("names the event that produces each of the three lists, not just publication", () => {
    // It rode all three paths saying "may have been published since the last
    // green run", and nothing is published INTO `stale` — an entry lands there
    // when an advisory is WITHDRAWN. A reader of a stale finding was being sent
    // to look for an event that cannot have caused it.
    assert.match(PUBLISHED_ELSEWHERE_NOTE, /published, or withdrawn,/);
  });

  it("comes last, after the findings and the instruction that fixes them", () => {
    // A reader who stops at the first line has to see the finding, not the
    // caveat. Its position is the difference between context and an excuse.
    const printed = failing(
      evaluateAudit(
        report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }], fixAvailable: true } }),
        FIXTURE,
      ),
    );
    const lines = printed.split("\n");
    assert.equal(lines.at(-1), PUBLISHED_ELSEWHERE_NOTE);
    assert.ok(
      lines.findIndex((line) => line.includes("FIXABLE")) < lines.length - 1,
      "the finding must be printed above the note",
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
    assert.equal(
      isClean({ ...clean, fixableInRange: [{ key: "x#y", severity: "low", updatePackage: "x" }] }),
      false,
    );
    assert.equal(isClean({ ...clean, stale: ["x#y"] }), false);
    assert.equal(
      isClean({ ...clean, majorOnly: [{ key: "x#y", severity: "critical", updatePackage: "x" }] }),
      true,
      "npm restating a `why` sentence is not a finding",
    );
  });

  it("is what the CLI exits on, rather than a second list of its own", () => {
    // A finding printed by a step that exits 0 is the shape this whole gate
    // replaced, one layer in. Run rather than read for: the gate's `clean` is
    // this predicate over the verdict it printed, on every path.
    const accepted = FIXTURE;
    const red: [string, Parameters<typeof report>[0]][] = [
      ["an untriaged advisory", { browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } }],
      ["one npm can fix", { nanoid: { advisories: [{ ghsa: A1, severity: "high" }], fixAvailable: true } }],
      ["a baseline entry that is gone", {}],
    ];
    for (const [label, entries] of red) {
      const run = runAuditGate({
        read: () => answeredWith(report(entries)),
        checkName: "check",
        underActions: false,
        accepted,
      });
      assert.equal(run.kind, "checked", label);
      assert.equal(run.clean, isCheckedRun(run) && isClean(run.verdict), label);
      assert.equal(run.clean, false, `${label}: a finding was printed by a step that exits 0`);
    }
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

describe("isAuditReport — npm failing is not npm reporting nothing", () => {
  // The gate's own doc comment promises a soft skip when the registry cannot
  // be reached, and the reader that implements it asked whether the payload
  // PARSES. npm's registry failures parse: `npm audit --json` answers with a
  // JSON error object, which carries no `vulnerabilities` — and no findings is
  // exactly what "every accepted advisory has been withdrawn" looks like from
  // inside `evaluateAudit`.
  //
  // CI run 1573 is the case for these: five and a half minutes in `npm audit`,
  // then a red naming all four baseline entries as no longer reported, on a
  // commit whose diff was four test files. The edit it asked for — delete the
  // baseline — is the one edit that lets a real advisory through in silence.

  it("rejects npm's error payload, which parses and says nothing", () => {
    assert.equal(
      isAuditReport({ error: { code: "ENOTFOUND", summary: "request to registry failed" } }),
      false,
    );
    // With `vulnerabilities` alongside it, too: an error is an error, and the
    // findings beside one are whatever npm had before it gave up.
    assert.equal(isAuditReport({ error: { code: "EAI_AGAIN" }, vulnerabilities: {} }), false);
  });

  it("rejects a payload with no findings key at all", () => {
    // Neither an error npm named nor a report: a truncated read, a proxy's
    // interstitial, a future npm that renamed the field. What they share is
    // that the answer to "which advisories are open?" is not in there.
    assert.equal(isAuditReport({}), false);
    assert.equal(isAuditReport({ metadata: { vulnerabilities: { high: 9 } } }), false);
    assert.equal(isAuditReport({ vulnerabilities: null }), false);
    assert.equal(isAuditReport({ vulnerabilities: "none" }), false);
  });

  it("rejects what is not an object, including the JSON literals", () => {
    for (const parsed of [null, undefined, 0, "", "npm ERR!", true, []]) {
      // An array has `typeof "object"` and no `vulnerabilities`, which is the
      // one non-object shape that would otherwise reach the findings walk.
      assert.equal(isAuditReport(parsed), false, `${JSON.stringify(parsed) ?? "undefined"} is not a report`);
    }
  });

  it("accepts a CLEAN tree, which is the answer this must not swallow", () => {
    // npm answers a tree with nothing open as `"vulnerabilities": {}` — the key
    // present and empty. That is a report, and the staleness it produces is
    // real: every accepted entry has genuinely been fixed. A predicate that
    // rejected it would turn the day the baseline empties into a silent skip.
    assert.equal(isAuditReport({ vulnerabilities: {} }), true);
  });

  it("accepts a report with findings in it", () => {
    assert.equal(
      isAuditReport({ vulnerabilities: { postcss: { severity: "high", via: [] } } }),
      true,
    );
  });

  it("is what stands between a registry failure and an empty baseline", () => {
    // The consequence, stated as a measurement rather than as prose: hand the
    // error payload to the evaluator and every accepted advisory comes back
    // stale, with nothing unexpected beside it — which is precisely the red CI
    // printed, and precisely the red a contributor would "fix" by deleting the
    // list.
    const asIfItWereAReport = { error: { code: "ENOTFOUND" } } as AuditReport;
    const verdict = evaluateAudit(asIfItWereAReport);
    assert.equal(verdict.unexpected.length, 0);
    assert.equal(verdict.stillPresent.length, 0);
    assert.equal(
      verdict.stale.length,
      ACCEPTED_HIGH_ADVISORIES.reduce((total, entry) => total + entry.advisories.length, 0),
      "the whole baseline reads as withdrawn, which is why the payload must never reach here",
    );
    assert.equal(isClean(verdict), false);
    // And the gate is only safe because the payload is turned away first.
    assert.equal(isAuditReport(asIfItWereAReport), false);
  });

  it("is the predicate the gate's reader applies, not a spare one", () => {
    // Related by behaviour rather than by a line of source: `readAuditPayload`
    // is what the gate calls, and what makes this predicate load-bearing is
    // that the two agree about every payload. A reader that stopped consulting
    // it would turn these comparisons red without anything reading a file.
    for (const raw of ['{"error":{"code":"ENOTFOUND"}}', "{}", '{"vulnerabilities":null}']) {
      assert.equal(isAuditReport(JSON.parse(raw)), false, `${raw} is not a report`);
      assert.equal(
        readAuditPayload(raw).report,
        undefined,
        `${raw} reached evaluateAudit even though it is not a report`,
      );
    }
    const answered = '{"vulnerabilities":{}}';
    assert.equal(isAuditReport(JSON.parse(answered)), true);
    assert.notEqual(
      readAuditPayload(answered).report,
      undefined,
      "npm answering with a clean tree is being skipped, which hides the day the baseline empties",
    );
  });
});

describe("reportCompleteness — the registry failing quietly, which no predicate caught", () => {
  // WHAT WENT WRONG. `isAuditReport` draws the line at "npm answered", and
  // `readAuditPayload` at "the answer is readable". Both were written for a
  // registry that fails LOUDLY. On 2026-09-04 it failed quietly: `npm audit
  // --json` returned a well-formed report whose high/critical entries were
  // missing, every predicate said yes, `observedAdvisories` came back empty,
  // every baseline entry read as stale, and the gate turned CI red demanding
  // the removal of four advisories that were all still live. Two calls nine
  // minutes apart disagreed; a third agreed with the baseline again.
  //
  // The report says so itself: `metadata.vulnerabilities` is npm's own tally
  // over the entries it emitted. Measured against this tree's real audit on
  // 2026-09-04: `high: 9` in the totals, nine entries at `"high"` in the map.

  /** A report whose totals and entries can be set independently. */
  const withTotals = (
    totals: Record<string, unknown> | undefined,
    entries: Record<string, { severity: string }> = {},
  ): AuditReport => ({
    vulnerabilities: Object.fromEntries(
      Object.entries(entries).map(([name, { severity }]) => [name, { severity, via: [] }]),
    ),
    ...(totals === undefined ? {} : { metadata: { vulnerabilities: totals } }),
  });

  it("reads a report that accounts for its totals as complete", () => {
    const answered = withTotals({ moderate: 1, high: 2, critical: 0, total: 3 }, {
      nanoid: { severity: "high" },
      postcss: { severity: "high" },
      undici: { severity: "moderate" },
    });
    assert.deepEqual(reportCompleteness(answered), {
      claimed: 2,
      carried: 2,
      complete: true,
      underReported: [],
    });
  });

  it("catches the shape that cost the red run: totals counted, entries missing", () => {
    const degraded = withTotals({ moderate: 0, high: 9, critical: 0, total: 9 });
    assert.deepEqual(reportCompleteness(degraded), {
      claimed: 9,
      carried: 0,
      complete: false,
      underReported: [{ severity: "high", claimed: 9, carried: 0 }],
    });
  });

  it("counts high and critical together, and ignores the severities the baseline does not triage", () => {
    // The baseline is a list of high/critical roots, so those are the only
    // totals whose absence can invent a withdrawal. Nineteen unreported
    // moderates say nothing about it — and are still RECORDED, because the fix
    // rule reads every severity and a shortfall there is a quieter finding
    // list rather than a wrong one.
    const shy = reportCompleteness(withTotals({ moderate: 19, low: 4 }));
    assert.equal(shy.complete, true);
    assert.deepEqual(shy.underReported, [
      { severity: "moderate", claimed: 19, carried: 0 },
      { severity: "low", claimed: 4, carried: 0 },
    ]);
    assert.deepEqual(
      reportCompleteness(withTotals({ high: 2, critical: 3 }, { one: { severity: "critical" } })),
      {
        claimed: 5,
        carried: 1,
        complete: false,
        underReported: [
          { severity: "critical", claimed: 3, carried: 1 },
          { severity: "high", claimed: 2, carried: 0 },
        ],
      },
    );
  });

  it("reads absent totals as no claim rather than as a claim of zero", () => {
    // Every fixture in this file, and any npm that stops emitting the key. The
    // alternative direction — treating a missing tally as "npm said zero" —
    // would withhold the staleness check on every run, which is the check
    // being switched off to protect it.
    assert.deepEqual(reportCompleteness(withTotals(undefined, { nanoid: { severity: "high" } })), {
      claimed: 1,
      carried: 1,
      complete: true,
      underReported: [],
    });
    assert.equal(reportCompleteness({ vulnerabilities: {} }).complete, true);
    assert.equal(reportCompleteness({ metadata: {} }).complete, true);
  });

  it("does not let a junk tally withhold the check", () => {
    // A negative, a NaN, a string, a null: npm saying something this cannot
    // use. Reading any of them as a claim would switch off staleness over a
    // number nobody can act on.
    for (const high of [-3, Number.NaN, Number.POSITIVE_INFINITY, "9", null, {}]) {
      assert.equal(
        reportCompleteness(withTotals({ high })).complete,
        true,
        `a \`high\` of ${JSON.stringify(high) ?? "undefined"} was read as a claim`,
      );
    }
    assert.equal(reportCompleteness(withTotals({ vulnerabilities: null } as never)).complete, true);
  });

  it("skips `total`, which is the sum of the others and not a severity", () => {
    // A row for it would read as "npm counted 28 roots at severity `total`",
    // and would be under-reported on every run of every healthy report.
    const rows = reportTally(withTotals({ moderate: 1, total: 1 }, { a: { severity: "moderate" } }));
    assert.deepEqual(
      rows.map((row) => row.severity),
      ["moderate"],
    );
  });

  it("orders the rows worst-severity first, so a printed list is diffable", () => {
    const rows = reportTally(
      withTotals({ low: 1, critical: 1, moderate: 1, high: 1, info: 1, spicy: 1 }),
    );
    assert.deepEqual(
      rows.map((row) => row.severity),
      ["critical", "high", "moderate", "low", "info", "spicy"],
    );
  });

  it("keeps a severity npm has not used yet rather than dropping it", () => {
    // The same choice `fixKind` and `severityRank` make about a field npm
    // changes: an unrecognised value sorts to the bottom and is still counted.
    assert.deepEqual(reportTally(withTotals({ spicy: 3 })), [
      { severity: "spicy", claimed: 3, carried: 0 },
    ]);
  });

  it("applies the no-claim rule per row, not to the whole `metadata` block", () => {
    // An npm that stops emitting ONE severity's tally is not an npm that
    // stopped emitting totals, and the row it did not mention must not read as
    // a claim of zero against the entries that are right there.
    assert.deepEqual(
      reportTally(withTotals({ high: 1 }, { a: { severity: "high" }, b: { severity: "low" } })),
      [
        { severity: "high", claimed: 1, carried: 1 },
        { severity: "low", claimed: 1, carried: 1 },
      ],
    );
  });

  it("carries more than it counts, which is odd and is not this function's failure", () => {
    // Over-reporting cannot invent a withdrawal — the direction that matters
    // here is entries MISSING. A report with more entries than totals is npm
    // being strange and is not a reason to stop checking staleness.
    assert.equal(
      reportCompleteness(withTotals({ high: 1 }, { a: { severity: "high" }, b: { severity: "high" } }))
        .complete,
      true,
    );
  });
});

describe("evaluateAudit on a report short of its own totals", () => {
  const degraded = (accepted: readonly AcceptedAdvisory[] = FIXTURE) =>
    evaluateAudit(
      { vulnerabilities: {}, metadata: { vulnerabilities: { high: 9, critical: 0 } } },
      accepted,
    );

  it("does not read a whole baseline as withdrawn, which is the red run", () => {
    const verdict = degraded();
    assert.deepEqual(verdict.stale, [], "the baseline was pruned on a report that said nothing");
    assert.equal(
      isClean(verdict),
      true,
      "the gate is still failing over advisories npm never mentioned",
    );
  });

  it("says why the list is empty, because an empty `stale` means two things", () => {
    // "npm reported these as gone" and "npm did not mention them" produce the
    // same list. The verdict is where they are told apart, so the ambiguity
    // travels with the list rather than being left to each caller.
    assert.equal(degraded().completeness.complete, false);
    assert.equal(evaluateAudit(report({}), []).completeness.complete, true);
  });

  it("still reports what a partial report can only under-report", () => {
    // `unexpected` and `fixableInRange` need a FINDING to fire, so a report
    // that says less makes them quieter — the safe direction, and the reason
    // a partial report is evaluated rather than skipped outright.
    const verdict = evaluateAudit(
      {
        vulnerabilities: {
          browserslist: {
            severity: "high",
            fixAvailable: true,
            via: [{ severity: "high", url: `https://github.com/advisories/${A1}` }],
          },
        },
        metadata: { vulnerabilities: { high: 9 } },
      },
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, [`browserslist#${A1}`]);
    assert.deepEqual(
      verdict.fixableInRange.map((found) => found.key),
      [`browserslist#${A1}`],
    );
    assert.equal(isClean(verdict), false);
    assert.deepEqual(verdict.stale, [], "staleness was computed from a report known to be short");
  });

  it("prints the withholding on the green path, where nothing else would say so", () => {
    // A run that passes because a question was not asked, and a green line
    // that does not say so, is how a half-checked run gets read as checked.
    const printed = formatAuditVerdict(degraded(), "check");
    assert.match(printed, /short of its own totals/);
    assert.match(printed, /high \(0 of 9\)/);
    assert.match(
      printed,
      /staleness was NOT checked on this run — npm counted 9 high\/critical roots and reported 0\./,
    );
    assert.match(printed, /OK — no new high\/critical advisories/);
  });

  it("says the shortfall even where it withholds nothing, because the fix rule reads it", () => {
    // Nineteen moderates npm counted and did not report: staleness is a
    // high/critical question and is still answered, and `fixableInRange` reads
    // every severity and has just been handed a population it cannot see the
    // size of.
    const printed = formatAuditVerdict(
      evaluateAudit({ vulnerabilities: {}, metadata: { vulnerabilities: { moderate: 19 } } }, []),
      "check",
    );
    assert.match(printed, /it counted more roots than it reported, at moderate \(0 of 19\)/);
    assert.match(printed, /an UNDER-count/);
    assert.doesNotMatch(
      printed,
      /staleness was NOT checked/,
      "a shortfall below the triaged severities switched off a check it says nothing about",
    );
  });

  it("names every short severity on the one line, worst first", () => {
    const printed = formatAuditVerdict(
      evaluateAudit(
        { vulnerabilities: {}, metadata: { vulnerabilities: { low: 4, high: 2, moderate: 19 } } },
        [],
      ),
      "check",
    );
    assert.match(printed, /at high \(0 of 2\), moderate \(0 of 19\), low \(0 of 4\)\./);
  });

  it("says nothing at all when the report accounts for itself", () => {
    // The overwhelming majority of runs, including every fixture in this file
    // and the live gate on a healthy registry. A caveat printed on a sound run
    // is how the caveat stops being read on the run that needs it.
    const printed = formatAuditVerdict(evaluateAudit(report({}), []), "check");
    assert.doesNotMatch(printed, /short of its own totals/);
    assert.doesNotMatch(printed, /NOT checked/);
  });

  it("agrees with the number the annotation on the run summary carries", () => {
    // The log line and the annotation are two sentences about one measurement.
    // Run rather than read for: both are lines the gate returns, so the numbers
    // can be compared instead of the expressions that produce them.
    const short = {
      vulnerabilities: {},
      metadata: { vulnerabilities: { high: 9 } },
    } as unknown as AuditReport;
    const run = runAuditGate({
      read: () => answeredWith(short),
      checkName: "check",
      underActions: true,
      accepted: FIXTURE,
    });
    const mark = run.lines.find(isAnnotationLine);
    assert.ok(
      mark !== undefined,
      "a withheld staleness check no longer leaves a mark on the run summary, so it is only visible in a log nobody opens on a green run",
    );
    assert.match(mark, /9 high\/critical roots counted, 0 reported/);
    assert.ok(
      run.lines.some((line) => /npm counted 9 high\/critical roots and reported 0/.test(line)),
      "the log line and the annotation disagree about one measurement",
    );
  });

  it("pins what a report with no `vulnerabilities` key at all does", () => {
    // `AuditReport` declares the key optional, `observedAdvisories` handles the
    // `undefined`, and what falls out is "the whole baseline is stale" — a
    // decision no case stated and no reader would predict from the type. It is
    // the right one: such a payload never reaches here, because `isAuditReport`
    // is what the gate's reader consults, and the alternative would be a gate
    // that silently passes on a shape it cannot read.
    assert.equal(isAuditReport({}), false);
    const verdict = evaluateAudit({}, FIXTURE);
    assert.deepEqual(verdict.stale, [`nanoid#${A1}`, `postcss#${A2}`, `postcss#${A3}`]);
    assert.deepEqual(verdict.completeness, {
      claimed: 0,
      carried: 0,
      complete: true,
      underReported: [],
    });
    assert.equal(isClean(verdict), false);
  });

  it("says the singular when npm counted one", () => {
    const printed = formatAuditVerdict(
      evaluateAudit({ vulnerabilities: {}, metadata: { vulnerabilities: { high: 1 } } }, FIXTURE),
      "check",
    );
    assert.match(printed, /npm counted 1 high\/critical root and reported 0\./);
  });
});

describe("worthAsking — the one leg that can answer differently, and could not check", () => {
  // On 2026-09-04 a degraded registry produced two red runs claiming the whole
  // baseline had been withdrawn. What established otherwise was a human
  // re-running the step by hand — twice, nine minutes apart, one call each
  // time. The gate had no way to do that for itself.

  const staleOnly = evaluateAudit(report({}), FIXTURE);
  const short = evaluateAudit(
    { vulnerabilities: {}, metadata: { vulnerabilities: { high: 9 } } },
    FIXTURE,
  );

  it("asks again about a red built entirely out of what npm did not say", () => {
    assert.equal(isClean(staleOnly), false);
    assert.deepEqual(staleOnly.unexpected, []);
    assert.deepEqual(staleOnly.fixableInRange, []);
    assert.equal(worthAsking(staleOnly), true);
  });

  it("asks again about a report short of its own totals, red or not", () => {
    // The same claim caught one layer earlier: the run passes, and it passes
    // because a question was withheld rather than answered.
    assert.equal(isClean(short), true);
    assert.equal(worthAsking(short), true);
  });

  it("does not spend a call on a finding npm positively reported", () => {
    // A second read of a `unexpected` or `fixableInRange` red can only agree or
    // say less, and saying less is the degraded direction. Neither outcome is
    // worth 49 seconds on every failing run.
    const unexpected = evaluateAudit(
      report({ browserslist: { advisories: [{ ghsa: A1, severity: "high" }] } }),
      FIXTURE,
    );
    const fixable = evaluateAudit(
      report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }], fixAvailable: true } }),
      FIXTURE,
    );
    for (const [label, verdict] of [
      ["unexpected", unexpected],
      ["fixableInRange", fixable],
    ] as const) {
      assert.equal(isClean(verdict), false, label);
      assert.equal(worthAsking(verdict), false, label);
    }
  });

  it("does not spend a call on a run that is simply clean", () => {
    // The overwhelming majority, and the reason this costs nothing on a healthy
    // registry: the second read is reached by the runs that would otherwise be
    // red or half-answered, and by no others.
    assert.equal(worthAsking(evaluateAudit(report({}), [])), false);
    assert.equal(
      worthAsking(
        evaluateAudit(
          report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }),
          [{ package: "nanoid", advisories: [A1], shipsToClient: true, why: "unreachable" }],
        ),
      ),
      false,
    );
  });

  it("is the predicate the gate spends its second call on", () => {
    // Executed rather than read for: the reader counts its own calls, so "a
    // clean run does not pay for a second `npm audit`" is measured here instead
    // of inferred from an `if` somebody could rewrite around.
    let calls = 0;
    const never = (): AuditRead => {
      calls += 1;
      return answeredWith(report({}));
    };
    const clean = evaluateAudit(report({}), []);
    const answered = answerWithSecondRead({
      first: clean,
      readAgain: never,
      checkName: "check",
      underActions: false,
    });
    assert.equal(calls, 0, "a run with nothing to re-ask about paid for a second registry call");
    assert.deepEqual(answered.lines, []);
    assert.equal(answered.verdict, clean, "the first verdict was rebuilt rather than returned");
  });

  it("delegates the gate's decisions to the ones the tests can run", () => {
    // The one source read left: that the script is the two things only a
    // process can do — read the registry and exit — and that everything else
    // is `runAuditGate`, executed below.
    const script = readRepoFile("scripts/check-audit-baseline.ts");
    assert.match(script, /runAuditGate\(\{/);
    assert.match(
      script,
      /read: auditReader\(/,
      "the gate builds its own reader again, so the bound is back on the far side of the boundary from the argument for it",
    );
    assert.match(script, /underActions: runningUnderActions\(\),/);
    assert.match(
      script,
      /for \(const line of run\.lines\) console\.log\(line\);/,
      "the gate drops the lines the decision produced, so nothing it says reaches the log",
    );
    assert.match(
      script,
      /if \(!run\.clean\) process\.exit\(1\);/,
      "a run that decided it was red exits 0",
    );
  });
});

describe("answerWithSecondRead — the gate's second read, run rather than read for", () => {
  // Six facts about this decision used to be established by matching exact
  // expressions in `scripts/check-audit-baseline.ts`, which is the shape a
  // dozen entries in this file are about: a check that reads for a spelling is
  // checking the spelling. The reader is an argument now, so all three paths
  // run here.

  const staleOnly = evaluateAudit(report({}), FIXTURE);
  const landing = (entries: Parameters<typeof report>[0]) => () => answeredWith(report(entries));

  it("announces the second call before it makes it", () => {
    const answered = answerWithSecondRead({
      first: staleOnly,
      readAgain: landing({}),
      checkName: "check",
      underActions: false,
      accepted: FIXTURE,
    });
    assert.match(answered.lines[0] ?? "", /^check: this answer rests on what npm did NOT report/);
    assert.match(answered.lines[1] ?? "", /^check: the second read landed/);
  });

  it("keeps the first answer, and says so, when the second read does not land", () => {
    // The registry stopped answering between the two calls. That says nothing
    // about the first answer either way, so the first answer stands — with the
    // same withholding it always had.
    const answered = answerWithSecondRead({
      first: staleOnly,
      readAgain: () => skipRead("refused", "registry unreachable"),
      checkName: "check",
      underActions: true,
      accepted: FIXTURE,
    });
    assert.equal(answered.verdict, staleOnly);
    assert.equal(answered.lines.length, 2);
    // With the headline the first read's skip carries, for the same reason: a
    // second read the registry refused and one abandoned after three minutes
    // call for opposite responses and used to print the same sentence.
    assert.equal(
      answered.lines[1],
      `check: the second read did not land (${auditSkipHeadline("refused")}) — registry unreachable; reporting the first.`,
    );
    assert.ok(
      !answered.lines.some(isAnnotationLine),
      "a run that got one answer was annotated as a run that got two",
    );
  });

  it("reconciles the two reads and prints the account of them", () => {
    const answered = answerWithSecondRead({
      first: staleOnly,
      readAgain: landing({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }),
      checkName: "check",
      underActions: false,
      accepted: FIXTURE,
    });
    assert.deepEqual(
      answered.verdict.stale,
      [`postcss#${A2}`, `postcss#${A3}`],
      "an entry one read reported was pruned on the other read's silence",
    );
    assert.equal(answered.lines.length, 2, "the account is missing, or a second one appeared");
    assert.ok((answered.lines[1] ?? "").includes(`nanoid#${A1}`));
  });

  it("annotates a disagreement under Actions, and prints the same account either way", () => {
    const options = {
      first: staleOnly,
      readAgain: landing({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }),
      checkName: "check",
      accepted: FIXTURE,
    };
    const local = answerWithSecondRead({ ...options, underActions: false });
    const actions = answerWithSecondRead({ ...options, underActions: true });
    assert.deepEqual(local.lines, actions.lines.slice(0, 2), "the log differs by where it runs");
    assert.equal(actions.lines.length, 3);
    const mark = actions.lines[2] ?? "";
    assert.match(mark, /^::notice title=check%3A the two reads of the registry disagreed::/);
    assert.ok(
      mark.includes("npm answered this tree two different ways in one run."),
      "the annotation does not say what it is marking",
    );
    assert.ok(
      mark.includes((local.lines[1] ?? "").replace(/%/g, "%25")),
      "the summary mark and the log line are two separate accounts of one run",
    );
  });

  it("leaves a run where the reads agreed unmarked", () => {
    const answered = answerWithSecondRead({
      first: staleOnly,
      readAgain: landing({}),
      checkName: "check",
      underActions: true,
      accepted: FIXTURE,
    });
    assert.equal(answered.lines.length, 2, "a run whose two reads agreed was annotated");
    assert.deepEqual(answered.verdict.stale, staleOnly.stale);
  });
});

describe("runAuditGate — the gate minus the two things only a process can do", () => {
  // `main` read the registry, decided, printed and exited, so the skip
  // headline, the skip's annotation, the under-report warning and the exit
  // decision were reachable only by reading the script for an expression. The
  // reads are arguments now and the lines are a return value.

  /**
   * The gate, run over a staged sequence of reads, with the reader accounted
   * for in BOTH directions.
   *
   * The gate takes one reader for both its calls, so how many calls a run makes
   * is a property of the reader — which is what makes "a healthy run does not
   * pay for a second `npm audit`" measurable rather than inferred from an `if`
   * somebody could rewrite around. The reader that did this was half of the
   * measurement: it failed on a call PAST the staged answers and said nothing
   * about answers left unused. A case staging two reads and getting one passed
   * silently, which is precisely the direction the single-reader change was
   * made to catch — a gate that stopped asking again is a gate that prunes the
   * baseline over one read's silence, and that is the incident, not a
   * regression in a message.
   *
   * Both halves are here because the count is only meaningful as an equality,
   * and it is asserted by the runner rather than offered to the case: a
   * `drained()` a case has to remember to call is the same bug one screen
   * later. That is also why staging and running are one function instead of a
   * reader handed to a `runAuditGate` call — eight cases were building the same
   * options object by hand, four of its five fields identical in every one, and
   * a case that reached for the raw call could still stage nothing.
   *
   * The two unbounded readers this replaced (`() => ({ report: short })`,
   * answering forever) said "the registry is still degraded" and could not say
   * how many times it was asked. Two staged copies of the same short report say
   * both.
   */
  const gateRun = (
    reads: readonly AuditRead[],
    options: {
      readonly underActions?: boolean;
      readonly checkName?: string;
      readonly accepted?: readonly AcceptedAdvisory[];
    } = {},
  ): AuditGateRun => {
    let call = 0;
    const run = runAuditGate({
      read: (): AuditRead => {
        const read = reads[call];
        assert.ok(
          read !== undefined,
          `the gate made ${String(call + 1)} reads and ${String(reads.length)} were staged`,
        );
        call += 1;
        return read;
      },
      checkName: options.checkName ?? "check",
      underActions: options.underActions ?? false,
      accepted: options.accepted ?? FIXTURE,
    });
    assert.equal(
      call,
      reads.length,
      `${String(reads.length)} read(s) were staged and the gate made ${String(call)} — an answer nobody asked for is a run that stopped asking, and the case it was staged for is now proving something else`,
    );
    return run;
  };
  const live = {
    nanoid: { advisories: [{ ghsa: A1, severity: "high" }] },
    postcss: { advisories: [{ ghsa: A2, severity: "high" }, { ghsa: A3, severity: "high" }] },
  };

  it("passes a clean run, printing the verdict and nothing else", () => {
    const run = gateRun([answeredWith(report(live))], { underActions: true });
    assert.equal(run.clean, true);
    assert.equal(run.lines.length, 1);
    assert.match(run.lines[0] ?? "", /^check: OK — no new high\/critical advisories/);
  });

  it("skips at 0, says which failure it was, and marks the run", () => {
    // A skip exits 0, so a week of registry outages is a week of green runs
    // with the reason in a log nobody opens on a green run. The annotation is
    // the only thing between that and a run that looks checked.
    const run = gateRun([skipRead("refused", "npm reported an error")], { underActions: true });
    assert.equal(run.clean, true, "a skip failed the run");
    assert.equal(run.kind, "skipped", "a run that read nothing was reported as a checked one");
    assert.equal(run.lines.length, 2);
    assert.equal(
      run.lines[0],
      `check: skipping (${auditSkipHeadline("refused")}) — npm reported an error.`,
    );
    // `:` is escaped in a property value — a title with a raw colon in it cuts
    // the annotation in half, which is why `escapeAnnotationProperty` exists.
    assert.match(run.lines[1] ?? "", /^::warning title=check skipped%3A /);
    assert.match(run.lines[1] ?? "", /The advisory baseline was NOT checked on this run\./);
  });

  it("leaves a local skip unannotated and still exits 0", () => {
    const run = gateRun([skipRead("abandoned", "we stopped waiting")]);
    assert.equal(run.clean, true);
    assert.deepEqual(run.lines, [
      `check: skipping (${auditSkipHeadline("abandoned")}) — we stopped waiting.`,
    ]);
  });

  it("fails a run with an advisory nobody triaged", () => {
    const run = gateRun([
      answeredWith(report({ ...live, browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } })),
    ]);
    assert.equal(run.clean, false);
    assert.deepEqual(run.verdict?.unexpected, [`browserslist#${A2}`]);
    assert.ok((run.lines[0] ?? "").includes(`NEW  browserslist#${A2}`));
  });

  it("asks again on a stale-only red, and reconciles what comes back", () => {
    // The whole mechanism, end to end: a report that mentions nothing reads as
    // the whole baseline being withdrawn, the second read reports two of the
    // three, and the gate goes green on the one both reads agree is gone.
    const run = gateRun([
      answeredWith(report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } })),
      answeredWith(report(live)),
    ]);
    assert.deepEqual(run.verdict?.stale, []);
    assert.equal(run.clean, true, "a baseline entry was pruned over one read's silence");
    assert.match(run.lines[0] ?? "", /asking once more before acting on it\./);
    assert.match(run.lines[1] ?? "", /the reads disagree about 2 baseline entries/);
  });

  it("marks a run whose report was short of its own totals", () => {
    const short = {
      vulnerabilities: {
        nanoid: {
          severity: "high",
          effects: [],
          via: [{ url: `https://github.com/advisories/${A1}`, severity: "high", title: "t" }],
        },
      },
      metadata: { vulnerabilities: { high: 9 } },
    } as unknown as AuditReport;
    // A short report is worth re-asking about, and the second read is short
    // too: the registry is still degraded, and the run still says so. Staging
    // it twice is what makes "it asked again" part of what this case proves —
    // a reader answering forever passed whether the gate asked once or twice.
    const run = gateRun([answeredWith(short), answeredWith(short)], { underActions: true });
    assert.equal(run.clean, true, "a withheld staleness check failed the run");
    assert.equal(run.verdict?.completeness.complete, false);
    const marks = run.lines.filter(isAnnotationLine);
    assert.equal(marks.length, 1, "the under-report warning is missing, or doubled");
    assert.match(marks[0] ?? "", /^::warning title=check%3A npm's report was short of its own totals::/);
    assert.match(marks[0] ?? "", /Baseline staleness was NOT checked: 9 high\/critical roots counted, 1 reported\./);
  });

  it("says nothing on the summary about a shortfall when it runs locally", () => {
    const short = {
      vulnerabilities: {},
      metadata: { vulnerabilities: { high: 9 } },
    } as unknown as AuditReport;
    const run = gateRun([answeredWith(short), answeredWith(short)]);
    assert.ok(
      !run.lines.some(isAnnotationLine),
      "a local run printed workflow commands into a terminal",
    );
    assert.ok(run.lines.some((line) => /staleness was NOT checked on this run/.test(line)));
  });

  /**
   * The runner counts in both directions, which is the only reason the counts
   * above mean anything.
   *
   * Every case here states how many times the registry is asked, in the length
   * of the array it stages. That statement is worth exactly what the accounting
   * behind it is worth — and for as long as the reader only refused an EXTRA
   * call, half of every one of those statements was decoration. These two run
   * the runner against the one gate whose read count is known either way.
   */
  it("hands a caller a run it can narrow, on the field that says which it is", () => {
    // What naming the two halves buys, run rather than argued. `AuditGateRun`
    // was two anonymous members, so a caller holding a checked run could not
    // name what it was holding — and the skip's `clean: true` was a guarantee
    // the only caller could not reach, because it read `run.clean` for both
    // kinds without narrowing. Narrowing gets both halves.
    //
    // Through the module's own guards, which is the other half of what this
    // proves: the narrowing used to be an inline arrow written here twice
    // (`((run: AuditGateRun) => run.kind === "checked" ? run : undefined)(…)`),
    // a type guard spelled as an expression because the module that owns the
    // union did not ship one.
    const answeredRun = gateRun([answeredWith(report(live))]);
    assert.ok(isCheckedRun(answeredRun), "an answered read produced a run with no verdict on it");
    // `checked` is typed as the narrow half, so this line stops compiling the
    // day the guard stops narrowing — which is the half of a type guard an
    // assertion cannot reach.
    const checked: AuditGateChecked = answeredRun;
    assert.notEqual(checked.verdict, undefined, "the checked half no longer carries its verdict");

    const skippedRun = gateRun([skipRead("refused", "npm reported an error")]);
    assert.ok(isSkippedRun(skippedRun), "a run that read nothing was reported as a checked one");
    const skipped: AuditGateSkipped = skippedRun;
    // `true` by type as well as by value: a skip has no other outcome, and the
    // narrowed half is where a caller can see that without checking.
    assert.equal(skipped.clean, true);
    assert.equal(skipped.verdict, undefined, "a run that read nothing produced a verdict");
  });

  /**
   * The guards and the field they read, held together.
   *
   * Two spellings of one question is the arrangement half of this module's
   * history is about, and a guard is a second spelling by construction. What
   * keeps it from being a divergence is that it is the ONLY other one: the
   * predicates are `kind` comparisons in the module that declares `kind`, and
   * this drives both over both halves so a guard that started answering by
   * testing `verdict` for absence — the discrimination `kind` replaced — is a
   * red run rather than a quiet reintroduction.
   */
  it("answers its guards exactly as the discriminator does, both ways", () => {
    const runs: readonly AuditGateRun[] = [
      gateRun([answeredWith(report(live))]),
      ...AUDIT_SKIP_CAUSES.map((cause) => gateRun([skipRead(cause, "npm said nothing usable")])),
    ];
    for (const run of runs) {
      assert.equal(isCheckedRun(run), run.kind === "checked", run.kind);
      assert.equal(isSkippedRun(run), run.kind === "skipped", run.kind);
      // Exhaustive as well as agreeing: a third kind added without a guard
      // would answer `false` to both and pass every assertion above.
      assert.notEqual(isCheckedRun(run), isSkippedRun(run), "a run was both halves, or neither");
    }
  });

  /**
   * Nothing bypasses the constructors, which is what makes them the place the
   * two invariants live.
   *
   * A skip's `clean` is `true` because a third party's availability must not
   * decide whether this repo's tests can run, and a checked run's is
   * `isClean(verdict)` — the one predicate that says which of three lists made
   * a run red. Both used to be spelled at the construction inside
   * `runAuditGate`, where a `clean` disagreeing with the printed verdict was a
   * shape the type allowed. These compare what the gate returns against what
   * the constructors build from the same parts.
   */
  it("builds both halves through the constructors the module exports", () => {
    const skipped = gateRun([skipRead("refused", "npm reported an error")], { underActions: true });
    assert.deepEqual(skipped, skippedGate(skipped.lines));

    const checked = gateRun([
      answeredWith(report({ ...live, browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } })),
    ]);
    assert.ok(isCheckedRun(checked));
    assert.deepEqual(checked, checkedGate(checked.lines, checked.verdict));
    assert.equal(checked.clean, false, "an untriaged advisory did not fail the run");
  });

  it("reads `clean` off the verdict rather than taking it from the caller", () => {
    // The constructor's whole job: `checkedGate` has no `clean` parameter, so
    // there is no call that can claim a red verdict passed. Driven over a
    // verdict of each colour, from the gate itself so the verdicts are real.
    // An untriaged advisory rather than a stale-only red: this gate asks twice
    // when the only finding is staleness, and the colour is what the case is
    // about, not the read count.
    const red = gateRun([
      answeredWith(report({ ...live, browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } })),
    ]);
    const green = gateRun([answeredWith(report(live))]);
    for (const run of [red, green]) {
      assert.ok(isCheckedRun(run));
      assert.equal(checkedGate([], run.verdict).clean, isClean(run.verdict));
    }
    assert.equal(red.clean, false);
    assert.equal(green.clean, true);
  });

  it("takes its kind from the read's, which is why they spell `skipped` the same", () => {
    // Two unions in one module for one fact — npm answered, or it did not —
    // and they used to be discriminated two different ways: `AuditGateRun` by
    // `kind`, `AuditRead` by whether `report` happened to be present. They say
    // it the same way now, and this is what keeps the shared word honest: a
    // gate that returned `kind: "checked"` for a read that skipped would be a
    // run reported as having checked the baseline when nothing was read.
    //
    // Every declared cause, because the mapping is one branch and a cause added
    // without one is exactly the shape that branch would miss.
    for (const cause of AUDIT_SKIP_CAUSES) {
      assert.equal(gateRun([skipRead(cause, "npm said nothing usable")]).kind, "skipped");
    }
    assert.equal(gateRun([answeredWith(report(live))]).kind, "checked");
  });

  it("refuses a run that asks past the answers staged for it", () => {
    // A stale-only red asks twice. Stage one and the second call has nothing.
    assert.throws(
      () => gateRun([answeredWith(report({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }))]),
      /the gate made 2 reads and 1 were staged/,
    );
  });

  it("refuses a run that leaves an answer unasked for", () => {
    // The half that was missing. A clean report is not worth asking about, so
    // the gate reads once — and a case staging a second answer is describing a
    // run that did not happen. Silently, until now: the extra answer was simply
    // never returned, and the case went green having proved a different gate.
    assert.throws(
      () => gateRun([answeredWith(report(live)), answeredWith(report(live))]),
      /2 read\(s\) were staged and the gate made 1/,
    );
  });
});

describe("reconcileAudit — findings unioned, staleness intersected", () => {
  // The asymmetry `reportCompleteness` is built on, applied to two answers: a
  // finding is something npm SAID, so either read having said it is enough and
  // no union can invent one. Staleness is something npm did not say, so it
  // takes both reads failing to mention an advisory before the baseline is
  // told to drop it — the edit that, if wrong, lets a real advisory through.

  const complete = (entries: Parameters<typeof report>[0]) => evaluateAudit(report(entries), FIXTURE);

  it("keeps a finding either read reported", () => {
    const sawNanoid = complete({
      nanoid: { advisories: [{ ghsa: A1, severity: "high" }], fixAvailable: true },
    });
    const sawBrowserslist = complete({
      browserslist: { advisories: [{ ghsa: A2, severity: "high" }] },
    });
    const both = reconcileAudit(sawNanoid, sawBrowserslist);
    assert.deepEqual(both.unexpected, [`browserslist#${A2}`]);
    assert.deepEqual(
      both.fixableInRange.map((found) => found.key),
      [`nanoid#${A1}`],
    );
  });

  it("prunes only what both reads failed to mention", () => {
    // The whole point. One read saw nothing and one saw `nanoid` — an advisory
    // one call says is gone and the other says is live is not one to delete a
    // baseline entry over.
    const sawNothing = complete({});
    const sawNanoid = complete({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } });
    assert.deepEqual(sawNothing.stale, [`nanoid#${A1}`, `postcss#${A2}`, `postcss#${A3}`]);
    assert.deepEqual(reconcileAudit(sawNothing, sawNanoid).stale, [
      `postcss#${A2}`,
      `postcss#${A3}`,
    ]);
  });

  it("agrees with both reads when both reads agree", () => {
    const twice = reconcileAudit(complete({}), complete({}));
    assert.deepEqual(twice.stale, [`nanoid#${A1}`, `postcss#${A2}`, `postcss#${A3}`]);
    assert.equal(isClean(twice), false);
  });

  it("lets an incomplete read abstain rather than vote empty", () => {
    // A read that lost its entries observed neither a withdrawal nor a
    // survival. Intersecting its empty `stale` with a complete read's would let
    // the degraded answer decide, which is the failure this whole mechanism
    // exists to undo.
    const degraded = evaluateAudit(
      { vulnerabilities: {}, metadata: { vulnerabilities: { high: 9 } } },
      FIXTURE,
    );
    const sound = complete({});
    assert.deepEqual(degraded.stale, []);
    for (const [label, merged] of [
      ["degraded first", reconcileAudit(degraded, sound)],
      ["degraded second", reconcileAudit(sound, degraded)],
    ] as const) {
      assert.deepEqual(
        merged.stale,
        [`nanoid#${A1}`, `postcss#${A2}`, `postcss#${A3}`],
        `${label}: the read that could not answer decided the answer`,
      );
      assert.equal(merged.completeness.complete, true, label);
    }
  });

  it("answers nothing when neither read could", () => {
    const degraded = evaluateAudit(
      { vulnerabilities: {}, metadata: { vulnerabilities: { high: 9 } } },
      FIXTURE,
    );
    const merged = reconcileAudit(degraded, degraded);
    assert.deepEqual(merged.stale, []);
    assert.equal(merged.completeness.complete, false);
    assert.match(
      formatAuditVerdict(merged, "check"),
      /staleness was NOT checked/,
      "two degraded reads print as an answered run",
    );
  });

  it("keeps the printed findings in the one total order they are diffed in", () => {
    const first = complete({
      undici: { advisories: [{ ghsa: A1, severity: "moderate" }], fixAvailable: true },
    });
    const second = complete({
      nanoid: { advisories: [{ ghsa: A2, severity: "high" }], fixAvailable: true },
    });
    assert.deepEqual(
      reconcileAudit(first, second).fixableInRange.map((found) => found.key),
      [`nanoid#${A2}`, `undici#${A1}`],
      "the merged list is not in severity-then-key order, so two runs of the same pair print differently",
    );
  });
});

describe("the second read says what it did, to a log that only said it started", () => {
  // The gate announced "asking once more", called npm again, and printed a
  // verdict — nothing in between. Whether the second read landed, agreed, or
  // was the one that changed the answer is most of what the second call exists
  // to establish, and none of it reached the log.

  const complete = (entries: Parameters<typeof report>[0]) => evaluateAudit(report(entries), FIXTURE);
  /** A well-formed report whose high/critical entries are simply missing. */
  const degraded = (claimed: number) =>
    evaluateAudit({ vulnerabilities: {}, metadata: { vulnerabilities: { high: claimed } } }, FIXTURE);

  it("opens with the check's name and the fact that the call landed", () => {
    // Every other line this gate prints is `check: …`, and this one is read in
    // the same log beside them.
    const line = formatSecondRead(complete({}), complete({}), "check");
    assert.match(line, /^check: the second read landed — /);
    assert.match(line, /\.$/);
  });

  it("says both reads carried npm's tally, and what they agreed was unreported", () => {
    const line = formatSecondRead(complete({}), complete({}), "check");
    assert.match(line, /both reads carried npm's own tally/);
    assert.match(line, /3 baseline entries went unreported in both reads/);
    for (const key of [`nanoid#${A1}`, `postcss#${A2}`, `postcss#${A3}`]) {
      assert.ok(line.includes(key), `${key} is pruned by this run and unnamed in its account`);
    }
  });

  it("names the entry the reads disagree about, and says it stays", () => {
    // The failure the second call was added for: one read said `nanoid` was
    // gone, the other reported it. The verdict keeps it, and the line is the
    // only place saying the two calls differed at all.
    const line = formatSecondRead(
      complete({}),
      complete({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }),
      "check",
    );
    assert.match(line, /the reads disagree about 1 baseline entry/);
    assert.ok(line.includes(`nanoid#${A1}`), "the disputed entry is not named");
    assert.match(line, /so it stays on the baseline/);
  });

  it("carries the shortfall of a first read the reconciled verdict drops", () => {
    // `reconcileAudit` keeps the completeness of the read that DECIDED, which
    // is right and means a degraded first read vanishes from the run's output
    // once a sound second read exists. This is where that survives.
    const first = degraded(9);
    const second = complete({});
    const line = formatSecondRead(first, second, "check");
    assert.match(line, /the first read was short of its own totals \(0 of 9 high\/critical roots reported\)/);
    assert.match(line, /so the second read decided staleness/);
    assert.doesNotMatch(
      formatAuditVerdict(reconcileAudit(first, second), "check"),
      /short of its own totals/,
      "the verdict already says the registry was degraded, so this case is measuring nothing",
    );
  });

  it("says which read decided when the SECOND is the degraded one", () => {
    const line = formatSecondRead(complete({}), degraded(4), "check");
    assert.match(line, /the second read was short of its own totals \(0 of 4 high\/critical roots reported\)/);
    assert.match(line, /so the first read decided staleness/);
    // One vote, so its own list is the answer — not a disagreement with a read
    // that abstained.
    assert.doesNotMatch(line, /disagree/);
    assert.match(line, /went unreported in the read that decided/);
  });

  it("says staleness is still unchecked when neither read carried its tally", () => {
    const line = formatSecondRead(degraded(9), degraded(2), "check");
    // The noun once, governed by the count beside it — the phrase written twice
    // is how "0 of 9 high/critical roots reported, then 0 of 2 high/critical
    // roots reported" reads, and both halves are the same failure.
    assert.match(line, /neither read carried npm's own tally \(0 of 9, then 0 of 2 high\/critical roots reported\)/);
    assert.match(line, /so staleness is still unchecked/);
    assert.doesNotMatch(line, /baseline entr/, "a run that answered nothing printed a staleness answer");
  });

  it("names a finding only the second read reported", () => {
    const line = formatSecondRead(
      complete({}),
      complete({ browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } }),
      "check",
    );
    assert.match(line, /the second read reported 1 finding the first did not/);
    assert.ok(line.includes(`browserslist#${A2}`), "the late finding is not named");
  });

  it("says a finding the second read did not repeat is kept", () => {
    // A finding is something npm SAID, so the union keeps it. The verdict
    // prints it with no sign that only one of the two calls saw it.
    const line = formatSecondRead(
      complete({ browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } }),
      complete({}),
      "check",
    );
    assert.match(line, /1 finding the second read did not repeat/);
    assert.match(line, /is kept/);
    assert.ok(line.includes(`browserslist#${A2}`), "the dropped finding is not named");
  });

  it("says nothing reads as stale when the baseline is fully reported", () => {
    const live = {
      nanoid: { advisories: [{ ghsa: A1, severity: "high" }] },
      postcss: { advisories: [{ ghsa: A2, severity: "high" }, { ghsa: A3, severity: "high" }] },
    };
    const line = formatSecondRead(complete(live), complete(live), "check");
    assert.match(line, /every baseline entry was reported, so nothing reads as stale/);
  });
});

describe("secondReadAgreed — whether the run gets a mark for a registry that changed its mind", () => {
  // The reconciled verdict cannot be asked this: its whole job is to look like
  // one answer. So the disagreement is measured before it, and it decides an
  // annotation rather than the exit code — the answer printed IS sound.

  const complete = (entries: Parameters<typeof report>[0]) => evaluateAudit(report(entries), FIXTURE);

  it("agrees with itself", () => {
    assert.equal(secondReadAgreed(complete({}), complete({})), true);
  });

  it("catches a staleness list that changed between the calls", () => {
    assert.equal(
      secondReadAgreed(complete({}), complete({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } })),
      false,
    );
  });

  it("catches a finding only one call reported", () => {
    assert.equal(
      secondReadAgreed(
        complete({}),
        complete({ browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } }),
      ),
      false,
    );
    assert.equal(
      secondReadAgreed(
        complete({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }], fixAvailable: true } }),
        complete({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }),
      ),
      false,
      "an advisory npm could fix on one call and not the other reads as agreement",
    );
  });

  it("is the absence of the differences the printed account names", () => {
    // The predicate decides an annotation and the account writes the sentence
    // beside it. Asked separately they could answer differently — a log line
    // saying the reads agreed under a summary mark saying they did not — so
    // both read one `secondReadDifference`, and this is what holds them to it.
    const degraded = (claimed: number) =>
      evaluateAudit(
        { vulnerabilities: {}, metadata: { vulnerabilities: { high: claimed } } },
        FIXTURE,
      );
    const live = { nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } };
    const surprise = { browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } };
    for (const [label, first, second] of [
      ["two clean reads", complete({}), complete({})],
      ["a staleness list that moved", complete({}), complete(live)],
      ["a first read that could not answer", degraded(9), complete({})],
      ["a second read that could not answer", complete({}), degraded(9)],
      ["two reads that could not answer", degraded(9), degraded(2)],
      ["a finding only the second saw", complete({}), complete(surprise)],
      ["a finding only the first saw", complete(surprise), complete({})],
      ["the same live advisory twice", complete(live), complete(live)],
    ] as const) {
      const line = formatSecondRead(first, second, "check");
      // The clauses come from the formatter, not from a pattern typed here: a
      // reworded clause has to keep this honest rather than quietly stop
      // matching, which is a check that turns off instead of going red.
      const disagreements = secondReadDisagreements(first, second);
      assert.equal(
        secondReadAgreed(first, second),
        disagreements.length === 0,
        `${label}: the annotation and the account describe different runs — ${line}`,
      );
      for (const clause of disagreements) {
        assert.ok(line.includes(clause), `${label}: "${clause}" is measured and never printed`);
      }
    }
  });

  it("says nothing about a shortfall both reads share", () => {
    // Two reads that answered nothing answered it the same way. The account
    // still names the shortfall — that is what the run cost — and the run is
    // not annotated for a disagreement it did not have.
    const degraded = (claimed: number) =>
      evaluateAudit(
        { vulnerabilities: {}, metadata: { vulnerabilities: { high: claimed } } },
        FIXTURE,
      );
    assert.deepEqual(secondReadDisagreements(degraded(9), degraded(2)), []);
    assert.match(formatSecondRead(degraded(9), degraded(2), "check"), /neither read carried/);
  });

  it("names the disputed entries and the one-sided findings once, for both readers", () => {
    const difference = secondReadDifference(
      complete({ browserslist: { advisories: [{ ghsa: A2, severity: "high" }] } }),
      complete({ nanoid: { advisories: [{ ghsa: A1, severity: "high" }] } }),
    );
    assert.deepEqual(difference.disputedStale, [`nanoid#${A1}`]);
    assert.deepEqual(difference.onlyFirst, [`browserslist#${A2}`]);
    assert.deepEqual(difference.onlySecond, []);
    assert.equal(difference.completenessDiffers, false);
  });

  it("leaves an abstaining read out of the disputed list", () => {
    // The whole baseline would be "disputed" on every degraded run otherwise:
    // an incomplete read's `stale` is empty because it could not ask, and the
    // complete read's is the answer.
    const degraded = evaluateAudit(
      { vulnerabilities: {}, metadata: { vulnerabilities: { high: 9 } } },
      FIXTURE,
    );
    const difference = secondReadDifference(degraded, complete({}));
    assert.deepEqual(difference.disputedStale, []);
    assert.equal(difference.completenessDiffers, true);
  });

  it("catches one call that carried its totals and one that did not", () => {
    // The two reads can agree on every list and still differ in the one field
    // that decides whether either list was an answer.
    const degraded = evaluateAudit(
      { vulnerabilities: {}, metadata: { vulnerabilities: { high: 9 } } },
      FIXTURE,
    );
    const sound = evaluateAudit(
      { vulnerabilities: {}, metadata: { vulnerabilities: { high: 0 } } },
      FIXTURE,
    );
    assert.deepEqual(degraded.unexpected, sound.unexpected);
    assert.equal(secondReadAgreed(degraded, sound), false);
  });
});

describe("readAuditPayload — a skip that says which failure it was", () => {
  // The skip printed one sentence for every way of failing: "no parseable
  // audit report (registry unreachable?)". Two red runs on `main` were read as
  // the registry moving rather than as the registry being down, and that
  // sentence is why — it cannot tell a contributor whether npm answered, and
  // it appears whether or not npm said what went wrong.

  it("hands back npm's own account of the failure, code and summary", () => {
    const read = readAuditPayload(
      JSON.stringify({
        error: { code: "ENOTFOUND", summary: "request to https://registry.npmjs.org/ failed" },
      }),
    );
    assert.equal(read.report, undefined);
    assert.match(String(read.skip), /ENOTFOUND/);
    assert.match(String(read.skip), /request to https:\/\/registry\.npmjs\.org\/ failed/);
  });

  it("still skips when npm names the error and nothing else", () => {
    // `code` without `summary`, and an error object with neither: npm having
    // less to say is not a reason to read its failure as a clean tree.
    assert.match(String(readAuditPayload('{"error":{"code":"EAI_AGAIN"}}').skip), /EAI_AGAIN/);
    assert.match(String(readAuditPayload('{"error":{}}').skip), /no code/);
    assert.match(String(readAuditPayload('{"error":"broke"}').skip), /npm reported an error/);
  });

  it("tells the four failures apart", () => {
    // Different problems with different fixes: npm never ran, npm printed
    // something that is not JSON, npm printed a JSON value that is not an
    // object, npm printed an object with no findings in it.
    assert.match(String(readAuditPayload("").skip), /printed nothing/);
    assert.match(String(readAuditPayload("   ").skip), /printed nothing/);
    assert.match(String(readAuditPayload("npm ERR! code E401").skip), /not JSON/);
    assert.match(String(readAuditPayload("null").skip), /is a null/);
    assert.match(String(readAuditPayload('"done"').skip), /is a string/);
    assert.match(String(readAuditPayload("{}").skip), /no `vulnerabilities`/);
  });

  it("bounds what it quotes back, because this goes into a CI log", () => {
    // npm's non-JSON output on a bad day is a stack trace, and a skip line that
    // reprints all of it is a skip nobody reads.
    const skip = String(readAuditPayload("x".repeat(5000)).skip);
    assert.ok(skip.length < 200, `the skip line is ${String(skip.length)} characters long`);
  });

  it("hands back the report when npm answered, clean tree included", () => {
    const findings = readAuditPayload('{"vulnerabilities":{"postcss":{"severity":"high"}}}');
    assert.equal(findings.skip, undefined);
    assert.deepEqual(Object.keys(findings.report?.vulnerabilities ?? {}), ["postcss"]);
    // The empty-but-present key is npm saying "nothing is open", which is an
    // answer and must not be swallowed by the reader that catches its silence.
    const clean = readAuditPayload('{"vulnerabilities":{}}');
    assert.equal(clean.skip, undefined);
    assert.deepEqual(clean.report, { vulnerabilities: {} });
  });

  it("is the reader the gate uses, and its sentence is what the run prints", () => {
    // Run, not read for. `auditReader` is what the gate is handed, so the
    // question "does the gate still decide through `readAuditPayload`?" is
    // answered by giving it npm's error object and comparing — where it used
    // to be answered by matching `readAuditPayload(raw)` in the script's text,
    // which a rename satisfies and a rewrite does not disturb.
    const payload = '{"error":{"code":"ENOTFOUND"}}';
    assert.deepEqual(
      auditReader(() => payload)(),
      readAuditPayload(payload),
      "the gate's reader no longer decides through readAuditPayload, so its skip and its reason are two statements again",
    );
    // The printing is executed too: the reason this reader produced is the
    // reason the run's first line carries.
    const skipped = readAuditPayload(payload);
    const run = runAuditGate({
      read: (): AuditRead => skipped,
      checkName: "check",
      underActions: false,
      accepted: FIXTURE,
    });
    assert.notEqual(skipped.skip, undefined);
    assert.ok(
      (run.lines[0] ?? "").includes(skipped.skip ?? "never"),
      "the gate skips without printing the reason it was handed, which is the whole of this",
    );
  });
});

describe("auditReader — the bounded read, which used to be unreachable", () => {
  /**
   * Thirty lines in `scripts/check-audit-baseline.ts` with four arguments
   * inside it and no doc comment of its own, none of it runnable.
   *
   * Everything below was previously either untested or established by matching
   * an expression in the script's text. The spawn is an argument now, so the
   * three ways a read can end — an answer, a throw carrying a report, a throw
   * carrying nothing — are each driven here.
   */
  const throwing = (failure: unknown) =>
    auditReader(() => {
      throw failure;
    });

  it("passes the bound to the spawn rather than trusting it to have one", () => {
    let seen: AuditSpawnOptions | undefined;
    auditReader((options) => {
      seen = options;
      return "{}";
    })();
    assert.deepEqual(seen, AUDIT_SPAWN_OPTIONS);
    assert.equal(seen?.timeout, AUDIT_TIMEOUT_MS, "the bound and the argument for it disagree");
  });

  it("keeps stderr out of the payload it is about to parse", () => {
    // npm writes progress to stderr, and the reader parses stdout. A spawn
    // configured to merge them turns every healthy run into "npm's output is
    // not JSON", which is the skip for a registry that answered badly.
    assert.deepEqual(AUDIT_SPAWN_OPTIONS.stdio, ["ignore", "pipe", "ignore"]);
    assert.equal(AUDIT_SPAWN_OPTIONS.encoding, "utf8");
  });

  it("gives the report room, because a truncated one parses as garbage", () => {
    // The default 1 MiB cuts a whole-graph advisory report mid-JSON, and the
    // failure arrives looking like npm answering badly rather than like a
    // buffer this repo chose.
    assert.ok(
      AUDIT_SPAWN_OPTIONS.maxBuffer >= 8 * 1024 * 1024,
      `maxBuffer is ${String(AUDIT_SPAWN_OPTIONS.maxBuffer)} bytes, which truncates a full report into unparseable JSON`,
    );
  });

  it("reads the answer npm printed when npm exits 0", () => {
    const read = auditReader(() => '{"vulnerabilities":{"nanoid":{"severity":"high"}}}')();
    assert.equal(read.skip, undefined);
    assert.deepEqual(Object.keys(read.report?.vulnerabilities ?? {}), ["nanoid"]);
  });

  it("salvages the report from a findings-present exit, which is every real run", () => {
    // `npm audit` exits non-zero WHENEVER it finds anything at or above the
    // default level, so for this tree the throw is the normal path and the
    // report is on `stdout` of the error. A reader that trusted the status
    // would skip every run and the gate would be green for a year.
    const read = throwing({ status: 1, stdout: '{"vulnerabilities":{"postcss":{"severity":"high"}}}' })();
    assert.equal(read.skip, undefined);
    assert.deepEqual(Object.keys(read.report?.vulnerabilities ?? {}), ["postcss"]);
  });

  it("asks whether it was killed BEFORE it looks at what was flushed", () => {
    // The order is the whole of it. A killed process's stdout is whatever had
    // been written when the signal arrived — here, valid JSON with no findings,
    // which is exactly what "every accepted advisory has been withdrawn" looks
    // like. Salvaging first would prune the baseline over a timeout.
    const read = throwing({ signal: "SIGKILL", stdout: '{"vulnerabilities":{}}' })();
    assert.equal(read.report, undefined, "a killed read was parsed as an answer");
    assert.equal(read.cause, "abandoned");
    assert.match(String(read.skip), new RegExp(`after ${String(AUDIT_TIMEOUT_MS / 1000)}s`));
  });

  it("skips rather than throwing when the failure carries nothing at all", () => {
    // `execFileSync` throws for reasons that are not npm's — ENOENT on the
    // binary, a spawn that never started — and the error has no `stdout`. That
    // is an empty payload, which `readAuditPayload` names.
    const read = throwing(new Error("spawn npm ENOENT"))();
    assert.equal(read.report, undefined);
    assert.equal(read.cause, "unreadable");
    assert.match(String(read.skip), /npm printed nothing/);
  });

  it("calls the spawn once per read, and reads only when asked", () => {
    let calls = 0;
    const read = auditReader(() => {
      calls += 1;
      return "{}";
    });
    assert.equal(calls, 0, "building the reader already spent a registry call");
    read();
    read();
    assert.equal(calls, 2, "the reader is caching, so the gate's second read is the first one again");
  });
});

describe("auditInvocationSkip — a registry that never answers held the whole run", () => {
  // The gate had no time bound. What that cost is measured, not imagined: a
  // healthy run answers in 49 seconds, and on 2026-09-04 three runs on `main`
  // sat in `npm audit` for 5m35s, 7m and past 13m against a degraded registry.
  // The first two then produced a WRONG answer — every baseline entry read as
  // withdrawn — and the third was still running when this was written.

  it("skips when the child was killed, whichever way node says so", () => {
    // The timeout kills the child, so the signal is the reliable half.
    assert.match(
      String(auditInvocationSkip({ signal: "SIGKILL", status: null }, 180_000)?.skip),
      /killed with SIGKILL after 180s/,
    );
    // `ETIMEDOUT` is node's own name for it, checked separately because a
    // future node could set one without the other.
    assert.match(
      String(auditInvocationSkip({ code: "ETIMEDOUT" }, 180_000)?.skip),
      /did not answer within 180s/,
    );
  });

  it("does NOT skip an ordinary findings-present exit", () => {
    // `npm audit` exits non-zero whenever it finds anything, and that exit
    // carries the whole report on stdout. Treating it as a kill would skip
    // every run of a tree that has advisories in it — which is every run.
    assert.equal(auditInvocationSkip({ status: 1, signal: null }, 180_000), undefined);
    assert.equal(auditInvocationSkip({ status: 1 }, 180_000), undefined);
    // An empty signal is not a signal.
    assert.equal(auditInvocationSkip({ signal: "" }, 180_000), undefined);
  });

  it("does not read a failure out of something that is not one", () => {
    for (const failure of [null, undefined, "boom", 7]) {
      assert.equal(auditInvocationSkip(failure, 180_000), undefined);
    }
  });

  it("says how long it waited, from the bound the gate actually uses", () => {
    // The number in the sentence comes from the argument, so the message
    // cannot claim a bound the call did not apply.
    assert.match(String(auditInvocationSkip({ signal: "SIGKILL" }, 30_000)?.skip), /after 30s/);
    assert.match(
      String(auditInvocationSkip({ signal: "SIGKILL" }, AUDIT_TIMEOUT_MS)?.skip),
      new RegExp(`after ${String(AUDIT_TIMEOUT_MS / 1000)}s`),
    );
  });

  it("is a bound with headroom over a healthy run, and it is applied", () => {
    // Three minutes against a 49-second healthy answer. A bound that is hit
    // produces a skip — a run that did not check advisories and says so on the
    // summary — so being slightly too tight costs one annotated skip, while
    // having no bound cost the run and, twice, the answer.
    assert.ok(AUDIT_TIMEOUT_MS >= 120_000, "the bound is tighter than a slow but healthy answer");
    assert.ok(AUDIT_TIMEOUT_MS <= 300_000, "the bound is longer than the failures it exists to cut");
    // Applied, not spelled. Both facts were established by matching
    // `timeout: AUDIT_TIMEOUT_MS` and `auditInvocationSkip(error,
    // AUDIT_TIMEOUT_MS)` in the script, which is a check on two expressions
    // that a reader with no bound at all could be rewritten to keep.
    let applied: AuditSpawnOptions | undefined;
    auditReader((options) => {
      applied = options;
      return "{}";
    })();
    assert.equal(
      applied?.timeout,
      AUDIT_TIMEOUT_MS,
      "the reader no longer bounds the audit call, so a registry that never answers holds the run again",
    );
    assert.equal(applied?.killSignal, "SIGKILL", "the bound waits on a process waiting on a socket");
    assert.match(
      String(
        auditReader(() => {
          throw { signal: "SIGKILL", stdout: '{"vulnerabilities":{}}' };
        })().skip,
      ),
      new RegExp(`after ${String(AUDIT_TIMEOUT_MS / 1000)}s`),
      "a killed audit's partial output is being parsed as though it were an answer",
    );
  });
});

describe("skipRead — the one construction every skipped read goes through", () => {
  // Nine of these were built by hand in `lib/audit-baseline.ts`, each spelling
  // `kind: "skipped"` for itself. The compiler catches a branch that writes
  // `"answered"` only because the other two fields contradict it, which is a
  // guarantee resting on a shape somebody could reasonably tidy away.

  it("builds a read that is a skip, whatever cause it is given", () => {
    // Over every declared cause, so a fourth is covered by arriving rather
    // than by somebody adding a row here.
    for (const cause of AUDIT_SKIP_CAUSES) {
      const read = skipRead(cause, "something went wrong");
      assert.equal(read.kind, "skipped");
      assert.equal(read.cause, cause);
      assert.equal(read.skip, "something went wrong");
      assert.equal(read.report, undefined, "a skip carries a report");
    }
  });

  it("takes the cause first, in the order the headline reads it", () => {
    // The argument for the parameter order, made runnable: the sentence is
    // printed under a headline the cause chooses, so a call site with the two
    // swapped is a pair a reader can see is wrong. This is what would fail if
    // the signature were flipped without the call sites following.
    const read = skipRead("abandoned", "npm audit did not answer");
    assert.equal(auditSkipHeadline(read.cause), "we stopped waiting");
  });

  it("is what the readers in this module return, not a shape beside them", () => {
    // The point of the constructor is that nothing bypasses it. Both readers
    // are driven here — a killed invocation and npm's error object — and both
    // answers have to be indistinguishable from a built one.
    // The sentence is asserted independently rather than read off the answer
    // and fed back in: `skipRead(cause, read.skip)` compares a value against
    // itself on the one field that carries what happened, so a reader
    // returning the wrong text under the right cause would pass.
    const killed = auditInvocationSkip({ signal: "SIGKILL" }, AUDIT_TIMEOUT_MS);
    assert.deepEqual(
      killed,
      skipRead("abandoned", `npm audit was killed with SIGKILL after ${String(AUDIT_TIMEOUT_MS / 1000)}s — the registry was not answering, and a partial read is not an answer`),
    );
    const refused = readAuditPayload('{"error":{"code":"ENOTFOUND"}}');
    assert.deepEqual(refused, skipRead("refused", "npm reported an error: ENOTFOUND"));
  });
});

describe("the skip's cause — who gave up, which the sentence does not say", () => {
  // Three skips in a row read identically and called for opposite responses.
  // A bound this gate applied means the registry may be perfectly fine and the
  // three minutes may be too few; an error npm reported means the registry was
  // reached and refused, and the bound is beside the point; output that is not
  // a report means neither of them said anything and npm itself has changed.

  it("blames the gate when the gate stopped waiting", () => {
    // Both timeout shapes, because both are this gate giving up.
    assert.equal(auditInvocationSkip({ signal: "SIGKILL" }, 180_000)?.cause, "abandoned");
    assert.equal(auditInvocationSkip({ code: "ETIMEDOUT" }, 180_000)?.cause, "abandoned");
  });

  it("blames npm when npm named the failure", () => {
    // The registry answered here. It said no, which is an answer.
    assert.equal(readAuditPayload('{"error":{"code":"ENOTFOUND"}}').cause, "refused");
    assert.equal(readAuditPayload('{"error":{}}').cause, "refused");
  });

  it("blames nobody when the output is not a report", () => {
    // Nothing said the registry was down; what arrived just is not an answer.
    for (const raw of ["", "   ", "npm ERR! code E401", "null", '"done"', "{}"]) {
      assert.equal(
        readAuditPayload(raw).cause,
        "unreadable",
        `${JSON.stringify(raw)} should be unreadable rather than blamed on either side`,
      );
    }
  });

  it("carries no cause when npm answered", () => {
    // The success arm has no cause, and the type says so — a reader that
    // switched on it would have to handle the report case first.
    assert.equal(readAuditPayload('{"vulnerabilities":{}}').cause, undefined);
  });

  it("gives each cause a headline a reader can tell apart at a glance", () => {
    // The population comes from the module, not from a second copy of the same
    // three literals: a fourth cause used to be a compile error in the headline
    // switch and an untested headline here.
    const headlines = AUDIT_SKIP_CAUSES.map(auditSkipHeadline);
    assert.deepEqual(new Set(headlines).size, headlines.length, "two causes read the same");
    for (const headline of headlines) {
      assert.ok(headline.length > 0 && headline.length < 40, `"${headline}" is not a headline`);
    }
    // The one distinction the whole thing exists for: whether WE gave up.
    assert.match(auditSkipHeadline("abandoned"), /^we /);
    assert.doesNotMatch(auditSkipHeadline("refused"), /^we /);
    assert.doesNotMatch(auditSkipHeadline("unreadable"), /^we /);
  });

  it("is printed by the gate, in the log line and on the annotation", () => {
    // Every cause, executed: the headline reaches the log line AND the
    // annotation title, which is what a run summary shows.
    for (const cause of AUDIT_SKIP_CAUSES) {
      const run = runAuditGate({
        read: () => skipRead(cause, "npm said nothing usable"),
        checkName: "check",
        underActions: true,
        accepted: FIXTURE,
      });
      const headline = auditSkipHeadline(cause);
      assert.ok(
        (run.lines[0] ?? "").includes(`skipping (${headline})`),
        `${cause}: the gate prints a skip without saying who gave up, so three skips read alike again`,
      );
      assert.ok(
        (run.lines[1] ?? "").includes(`title=check skipped%3A ${headline}`),
        `${cause}: the annotation title no longer distinguishes the causes, and the title is what a run summary shows`,
      );
    }
  });
});

describe("the declared causes and the produced ones are the same set", () => {
  it("declares each cause once", () => {
    assert.equal(
      new Set(AUDIT_SKIP_CAUSES).size,
      AUDIT_SKIP_CAUSES.length,
      "a cause is listed twice, so the headline record has fewer keys than the array has entries",
    );
  });

  /**
   * One input per way the readers can decide to skip, each named by the branch
   * it exercises.
   *
   * It was six expressions in an array literal, and what they were a sample OF
   * was not written down anywhere — so the seventh branch was simply missing:
   * a JSON payload that parses to something which is not an object had no
   * input, and nothing could have said so. A sample nobody can audit is a
   * sample that quietly shrinks.
   *
   * Naming the branch is the whole of the fix: a reader that grew an eighth way
   * to skip is still not covered automatically, but the omission is now visible
   * as a branch with no row rather than as an array that looks complete.
   */
  const SKIP_INPUTS: Readonly<Record<string, () => AuditRead | undefined>> = {
    "killed, reported as a signal": () => auditInvocationSkip({ signal: "SIGKILL" }, 180_000),
    "killed, reported as ETIMEDOUT": () => auditInvocationSkip({ code: "ETIMEDOUT" }, 180_000),
    "npm named an error": () => readAuditPayload('{"error":{"code":"ENOTFOUND"}}'),
    "npm printed nothing": () => readAuditPayload(""),
    "npm printed something that is not JSON": () => readAuditPayload("npm ERR!"),
    "npm printed JSON that is not an object": () => readAuditPayload("null"),
    "npm printed an object with no findings key": () => readAuditPayload("{}"),
  };

  it("skips on every input in the sample, so none of them is dead", () => {
    // An input that stopped producing a skip would drop out of the set below
    // silently, and the comparison would go on passing as long as some other
    // input still reached the same cause. This is what makes each row carry
    // its own weight.
    for (const [branch, read] of Object.entries(SKIP_INPUTS)) {
      const answer = read();
      assert.notEqual(answer, undefined, `\`${branch}\` no longer produces anything`);
      assert.equal(answer?.report, undefined, `\`${branch}\` is being read as an answer now`);
      assert.ok(
        answer?.cause !== undefined,
        `\`${branch}\` produces a skip with no cause on it`,
      );
    }
  });

  it("produces every cause it declares, and declares every cause it produces", () => {
    // The array is the one door onto the population, and a door onto nothing is
    // what the derivation would otherwise buy: a cause could be declared, given
    // a headline, looped over by every case here, and never returned by any
    // reader for any input.
    //
    // The inputs are real ones — a killed call, npm's error object, and five
    // shapes of output that is not a report — so what this compares is the
    // declaration against the behaviour rather than against another list.
    const produced = new Set(
      Object.values(SKIP_INPUTS)
        .map((read) => read()?.cause)
        .filter((cause) => cause !== undefined),
    );
    assert.deepEqual(
      [...produced].sort(),
      [...AUDIT_SKIP_CAUSES].sort(),
      "the causes the readers actually return and the causes the module declares have drifted apart",
    );
  });
});

/**
 * The header points at code, and nothing checked that the code was still there.
 *
 * `scripts/check-audit-baseline.ts` is now four statements and a reader, and
 * the reason it can be that short is its header: five sentences saying every
 * decision is `runAuditGate` in `lib/audit-baseline.ts`, that the reader is
 * here because it is the process boundary, and that `readAuditPayload` tells a
 * report from a registry failure that parses like one. That paragraph is the
 * first thing a contributor reads and the only thing telling them where to go.
 *
 * It is also prose. The week this file's decisions moved into `lib/`, the
 * header moved with them by hand — and a rename does not move prose. `tsc`
 * would rewrite the import and leave the sentence pointing at a function that
 * no longer exists, which is the exact failure `plural.ts` grew a case for
 * when its "who else asks" paragraph fell a caller behind.
 *
 * ## What is checked, and the much larger half that is not
 *
 * `classifyProseName` claims a backticked span only on shape: a camel, Pascal
 * or SCREAMING_SNAKE identifier, or a slashed path with an extension.
 * Everything else in this header — `npm audit --json`, `check-expo-install`,
 * `SIGKILL` — is left alone, because a rule that demanded npm's lifecycle
 * hooks and the kernel's signals resolve to something in this tree would be
 * red on correct prose. The floors below are what keep that honesty from
 * turning into a check of nothing: a header reworded until it names no code is
 * a header that stopped pointing anywhere, and that is a finding, not a pass.
 *
 * Resolution is EXPORTS rather than "appears somewhere in the tree". The claim
 * the sentence makes is that a reader can go and find `runAuditGate`, so a
 * dead name surviving as somebody's local variable is not the sentence being
 * true. The script's own declarations count for the same reason — `readAudit`
 * and `main` are findable in the file the reader already has open.
 */
describe("the gate script's header names things that exist", () => {
  const GATE = "scripts/check-audit-baseline.ts";
  const header = moduleDoc(readRepoFile(GATE));
  const named = proseNames(header);

  /**
   * Every name `lib/` and `scripts/` export, plus what the gate declares.
   *
   * Both forms of export are read: the declaration (`export function x`) and
   * the list (`export { x, y }`). Reading only the first would have reported
   * every re-exported name as missing, which is a red run about the regex
   * wearing a message about the paragraph — the same failure mode the
   * extraction itself was rewritten to avoid.
   */
  const findable = new Set<string>();
  for (const file of sourceFiles("lib", "scripts")) {
    const code = sourceCode(file);
    for (const match of code.matchAll(
      /export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
    )) {
      findable.add(match[1]);
    }
    for (const match of code.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
      for (const part of match[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) findable.add(name);
      }
    }
  }
  // Plus what the gate itself declares or imports. Both are findable from the
  // file the reader already has open, which is the whole of what "go and find
  // `runAuditGate`" asks — and `execFileSync` is neither ours to export nor
  // ours to declare. A rename still fails: `tsc` rewrites the import to the
  // NEW name, so the one in the paragraph is left resolving to nothing.
  for (const match of sourceCode(GATE).matchAll(
    /(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    findable.add(match[1]);
  }
  for (const match of sourceCode(GATE).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) findable.add(name);
    }
  }

  it("names an identifier a reader can go and find, for every one it names", () => {
    const missing = named.identifiers.filter((name) => !findable.has(name));
    assert.deepEqual(
      missing,
      [],
      `the header of ${GATE} names ${missing.join(", ")} and nothing under lib/ or scripts/ exports it — the sentence is the only thing telling a contributor where the gate's decisions live, and it is now pointing somewhere they are not`,
    );
  });

  it("names a file that is on disk, for every path it names", () => {
    const missing = named.paths.filter((rel) => !existsSync(repoPath(rel)));
    assert.deepEqual(
      missing,
      [],
      `the header of ${GATE} names ${missing.join(", ")} and no such file exists — a path in prose is a rename away from being directions to nowhere`,
    );
  });

  it("still names the entry point the script actually calls", () => {
    // The floors below say the header names SOME code. This says it names the
    // one thing the file exists to reach: `main` calls exactly one function
    // out of `lib/audit-baseline.ts`, and a header that stopped mentioning it
    // could satisfy every count here while describing a different gate.
    const called = [...sourceCode(GATE).matchAll(/\b([a-z][\w$]*)\(\{/g)].map((m) => m[1]);
    assert.ok(
      called.length > 0,
      "the gate's main no longer calls anything with an options object, so this case is reading for a shape the script does not have",
    );
    const unnamed = called.filter((name) => !header.includes(name));
    assert.deepEqual(
      unnamed,
      [],
      `the gate calls ${unnamed.join(", ")} and its header does not name it — "every decision is X" is the header's whole claim, and X is now something else`,
    );
  });

  it("names enough code that a reworded header cannot pass by naming none", () => {
    // Measured, not chosen: four identifiers and one path today. A floor of
    // zero is what an honesty-first classifier degrades to when somebody
    // rewrites the paragraph in plain words, and the pass would look identical
    // to the pass a correct header gets.
    assert.ok(
      named.identifiers.length >= 3,
      measuredFloor(named.identifiers.length, 3, `identifier(s) named in the header of ${GATE}`),
    );
    assert.ok(
      named.paths.length >= 1,
      measuredFloor(named.paths.length, 1, `repo path(s) named in the header of ${GATE}`),
    );
  });
});
