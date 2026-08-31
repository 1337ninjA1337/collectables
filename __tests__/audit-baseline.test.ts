import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ACCEPTED_HIGH_ADVISORIES,
  advisoryIdentity,
  advisoryKey,
  evaluateAudit,
  formatAuditVerdict,
  observedAdvisories,
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
    }
  >,
): AuditReport {
  return {
    vulnerabilities: Object.fromEntries(
      Object.entries(entries).map(([name, { advisories = [], dependsOn = [] }]) => [
        name,
        {
          severity: advisories[0]?.severity ?? "high",
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
