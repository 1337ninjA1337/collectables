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
  fixPackage,
  formatAuditVerdict,
  AUDIT_SKIP_CAUSES,
  AUDIT_TIMEOUT_MS,
  auditInvocationSkip,
  auditSkipHeadline,
  isAuditReport,
  isClean,
  readAuditPayload,
  observedAdvisories,
  observedAdvisoryDetails,
  observedAdvisoryFixes,
  PUBLISHED_ELSEWHERE_NOTE,
  type AcceptedAdvisory,
  type AuditRead,
  type AuditReport,
  type AuditVerdict,
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

/** npm's "only a major fixes this, and here is what I would install". */
const majorFix = (name: string): unknown => ({ name, version: "1.0.0", isSemVerMajor: true });

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

  it("is the reader the gate uses, and the gate prints its sentence", () => {
    const script = readRepoFile("scripts/check-audit-baseline.ts");
    assert.match(
      script,
      /readAuditPayload\(raw\)/,
      "check-audit-baseline no longer decides through readAuditPayload, so its skip and its reason are two statements again",
    );
    assert.match(
      script,
      /skipping \([^)]*\) — \$\{read\.skip\}/,
      "the gate skips without printing the reason it was handed, which is the whole of this",
    );
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
    const script = readRepoFile("scripts/check-audit-baseline.ts");
    assert.match(
      script,
      /timeout: AUDIT_TIMEOUT_MS/,
      "the gate no longer bounds the audit call, so a registry that never answers holds the run again",
    );
    assert.match(
      script,
      /auditInvocationSkip\(error, AUDIT_TIMEOUT_MS\)/,
      "a killed audit's partial output is being parsed as though it were an answer",
    );
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
    const script = readRepoFile("scripts/check-audit-baseline.ts");
    assert.match(
      script,
      /skipping \(\$\{headline\}\)/,
      "the gate prints a skip without saying who gave up, so three skips read alike again",
    );
    assert.match(
      script,
      /title: `\$\{CHECK_NAME\} skipped: \$\{headline\}`/,
      "the annotation title no longer distinguishes the causes, and the title is what a run summary shows",
    );
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
