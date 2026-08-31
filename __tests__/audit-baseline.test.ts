import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ACCEPTED_HIGH_ADVISORIES,
  evaluateAudit,
  formatAuditVerdict,
  isAdvisoryRoot,
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
 * These cases are about the two directions an exemption list can rot in — a
 * new advisory it silently covers, and an entry that stopped applying.
 */

function report(
  entries: Record<string, { severity: string; root?: boolean }>,
): AuditReport {
  return {
    vulnerabilities: Object.fromEntries(
      Object.entries(entries).map(([name, { severity, root = true }]) => [
        name,
        { severity, via: root ? [{ title: `${name} advisory` }] : ["some-other-package"] },
      ]),
    ),
  };
}

const FIXTURE: readonly AcceptedAdvisory[] = [
  { package: "nanoid", shipsToClient: true, why: "vulnerable path unreachable" },
  { package: "postcss", shipsToClient: false, why: "build-time only" },
];

describe("evaluateAudit", () => {
  it("passes when every high root is on the baseline", () => {
    const verdict = evaluateAudit(
      report({ nanoid: { severity: "high" }, postcss: { severity: "high" } }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, []);
    assert.deepEqual(verdict.stillPresent, ["nanoid", "postcss"]);
    assert.deepEqual(verdict.stale, []);
  });

  it("fails on a high advisory nobody has triaged", () => {
    // The case the whole gate exists for: the accepted ones stay quiet, and
    // the new one is the only thing in the output.
    const verdict = evaluateAudit(
      report({
        nanoid: { severity: "high" },
        postcss: { severity: "high" },
        "left-pad": { severity: "critical" },
      }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, ["left-pad"]);
    assert.match(formatAuditVerdict(verdict, "check"), /NEW {2}left-pad/);
  });

  it("reports a baseline entry the audit no longer names as stale", () => {
    // The other direction. An exemption nobody prunes stops describing the
    // tree, and then starts covering something somebody would want to see.
    const verdict = evaluateAudit(report({ nanoid: { severity: "high" } }), FIXTURE);
    assert.deepEqual(verdict.stale, ["postcss"]);
    assert.match(formatAuditVerdict(verdict, "check"), /no longer reported/);
  });

  it("ignores moderate and low, which are not what this gate is for", () => {
    const verdict = evaluateAudit(
      report({ "some-dev-tool": { severity: "moderate" }, esbuild: { severity: "low" } }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, []);
  });

  it("ignores a package that is only vulnerable through a dependency", () => {
    // npm reports both kinds. The dependent kind changes whenever the tree is
    // reshaped and says nothing new about exposure — seven of the thirteen
    // high entries in this tree are that kind, and a baseline listing them
    // would need editing on every lockfile churn.
    const verdict = evaluateAudit(
      report({ expo: { severity: "high", root: false } }),
      FIXTURE,
    );
    assert.deepEqual(verdict.unexpected, [], "a dependent is not a triage decision");
  });

  it("treats an empty report as clean rather than as a broken read", () => {
    assert.deepEqual(evaluateAudit({}, FIXTURE).unexpected, []);
    assert.deepEqual(evaluateAudit({}, FIXTURE).stale, ["nanoid", "postcss"]);
  });
});

describe("isAdvisoryRoot", () => {
  it("is the presence of an advisory object in `via`", () => {
    assert.equal(isAdvisoryRoot([{ title: "an advisory" }]), true);
    assert.equal(isAdvisoryRoot(["another-package"]), false);
    assert.equal(isAdvisoryRoot([]), false);
    assert.equal(isAdvisoryRoot(undefined), false);
  });
});

describe("the accepted list is a triage record, not a pile", () => {
  it("gives every entry a reason and a client-reachability answer", () => {
    // `shipsToClient` is the field the severity number cannot answer, and the
    // one that was wrong in SECURITY.md: it claimed every remaining advisory
    // was dev/build-time when `nanoid` had been shipping to users for months.
    for (const entry of ACCEPTED_HIGH_ADVISORIES) {
      assert.ok(entry.package.length > 0);
      assert.ok(
        entry.why.length > 20,
        `${entry.package}: "accepted" needs a reason somebody can disagree with`,
      );
      assert.equal(typeof entry.shipsToClient, "boolean");
    }
  });

  it("names no package twice", () => {
    const names = ACCEPTED_HIGH_ADVISORIES.map((entry) => entry.package);
    assert.deepEqual([...new Set(names)].sort(), [...names].sort());
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
    // `LINT_GUARDS` documents itself as needing "no network"; this one needs
    // the registry, so it follows `lint:expo-install` and stands alone.
    const ci = readRepoFile(".github/workflows/ci.yml");
    assert.match(ci, /^\s*run: npm run lint:audit-baseline$/m);
    // A `run:` line, not any mention: the comment above the step explains what
    // it replaced and names the old command, which the first draft of this
    // assertion read as the old step still being there.
    assert.ok(
      !/^\s*run: npm audit --audit-level=/m.test(ci),
      "the always-red step this replaced must not come back beside it",
    );
    // The registry, not the file: `LINT_ALL_EXEMPT` lives in the same module
    // and names this script, which a substring read over the source counts as
    // membership. That is twice now in this one suite.
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
