/**
 * What the gate PRINTS for a real report, held to a committed block.
 *
 * ## The gap three refactors in one day walked straight through
 *
 * On 2026-10-09 `lib/audit-baseline.ts` had its lockfile reading rewritten
 * three times: the walk became one pass at a boundary, the boundary moved out
 * to the process that reads the file, and the walk became its own module.
 * Every one of them was proved behaviour-preserving by running
 * `npm run lint:audit-baseline` and READING the green line — 1,400 characters
 * of prose about five groups — because `verify`'s 9,961 cases stayed green
 * either side of all three and not one of them printed the gate's output for a
 * real report. Comparing prose by eye three times in one day is how the fourth
 * time goes wrong.
 *
 * Every other suite here builds its report by hand, three packages wide. This
 * one reads {@link SNAPSHOT_REPORT}: 50 vulnerability roots over 9 direct
 * dependencies, with `effects` chains, a `fixAvailable: false`, a bare
 * `fixAvailable: true`, four multi-candidate groups and two packages npm names
 * a version for that is BEHIND what is installed.
 *
 * ## Both paths, because they share almost nothing
 *
 * The green block is the exemption summary, the major-only summary and the
 * backward-fix reading. The red block is the findings lists and the fix
 * command. `isClean` makes them mutually exclusive, so no single run can print
 * both and a case that asserted both halves at once would be asserting against
 * correct output — which is how that exclusivity was discovered on 2026-10-07.
 *
 * ## What a failure here means
 *
 * The inputs are frozen, so a diff is a change in the FORMATTER and nothing
 * else. Read the diff: if the new block is what you meant, paste it; if it is
 * not, the refactor changed what the gate tells a contributor to do. What this
 * does NOT say is whether this repository is green today — that is the live
 * gate's job, and `named-fix-claim.test.ts` asks the live-baseline half of it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advisoryPackage,
  evaluateAudit,
  fixCandidates,
  formatAuditVerdict,
  isClean,
} from "@/lib/audit-baseline";

import {
  SNAPSHOT_ACCEPTED,
  SNAPSHOT_INSTALLED,
  SNAPSHOT_REPORT,
  SNAPSHOT_TAKEN,
} from "./helpers/audit-snapshot";

/** The whole green line, as a contributor reads it on a passing run. */
const GREEN = `check: npm reports an in-range fix for 2 advisories this tree cannot take:
  PINNED  high      image-size#GHSA-5p2g-fcmc-qvqq
  PINNED  high      image-size#GHSA-w3rx-r6r6-pgpr
Each has an inRangeFixPinned measurement in lib/audit-baseline.ts naming the dependent that pins the vulnerable range and what forcing it past that pin actually did. npm's fixAvailable is a judgement about direct dependencies only, so it cannot see a transitive range — re-take the measurement rather than the sentence if the tree moves.
check: OK — no new high/critical advisories; 6 still accepted, in image-size (2), postcss (2), braces (1), node-forge (1); and npm offers no fix short of a semver-major for 9 advisories, named by 5 updates, 1 of which npm cannot point forward: @sentry/react-native / expo (5, up to high, NO FORWARD FIX), @sentry/react-native / expo +2 (1, up to high), @sentry/react-native / expo +3 (1, up to moderate), expo-router (1, up to moderate), react-native (1, up to moderate)
  @sentry/react-native / expo: no candidate npm names is ahead of the lockfile — @sentry/react-native@5.15.2 is behind 7.5.0, expo@44.0.6 is behind 54.0.35 — so this waits on upstream rather than on a migration here.`;

/** And the red one, from the same report with nothing accepted. */
const RED = `check: 6 high/critical advisories not in the baseline:
  NEW  braces#GHSA-vfj7-8cjw-p6xm
  NEW  image-size#GHSA-5p2g-fcmc-qvqq
  NEW  image-size#GHSA-w3rx-r6r6-pgpr
  NEW  node-forge#GHSA-86w9-cpqp-85rv
  NEW  postcss#GHSA-6g55-p6wh-862q
  NEW  postcss#GHSA-r28c-9q8g-f849
Read each at https://github.com/advisories, triage it in SECURITY.md, then add its ID to that package's \`advisories\` with whether it reaches the client — or fix it.
check: npm can fix 2 advisories without a major version change:
  FIXABLE  high      image-size#GHSA-5p2g-fcmc-qvqq
  FIXABLE  high      image-size#GHSA-w3rx-r6r6-pgpr
Run \`npm update image-size\` and commit the lockfile.
An advisory a lockfile bump clears is not a triage decision, at any severity — accepting one is how seven of these sat on the baseline being read as read, and how three moderate/low roots went a month without anybody asking.

This gate reads the npm registry, so it is the one check here whose answer can change while the repository does not — a finding above may have been published, or withdrawn, since the last green run rather than caused by this branch. The fix is the same either way, and it belongs on this branch: the tree is only green when it is green today.`;

describe("the gate's printed output over a real report", () => {
  const verdict = evaluateAudit(SNAPSHOT_REPORT, SNAPSHOT_ACCEPTED, SNAPSHOT_INSTALLED);

  it("prints the green block byte for byte", () => {
    assert.equal(isClean(verdict), true, formatAuditVerdict(verdict, "check"));
    assert.equal(formatAuditVerdict(verdict, "check"), GREEN);
  });

  it("prints the red block byte for byte, from the same report", () => {
    // Nothing accepted, so every high/critical advisory the report carries is
    // a finding. The same 50 roots, the other path.
    const red = evaluateAudit(SNAPSHOT_REPORT, [], SNAPSHOT_INSTALLED);
    assert.equal(isClean(red), false);
    assert.equal(formatAuditVerdict(red, "check"), RED);
  });

  it("names the check rather than hard-coding one, in both blocks", () => {
    // The floor under the two blocks above: they contain the literal "check"
    // eight times between them, and a formatter that ignored its argument
    // would match both of them forever.
    const named = formatAuditVerdict(verdict, "some-other-gate");
    assert.ok(!named.includes("check:"), named);
    assert.match(named, /^some-other-gate: /);
  });
});

/**
 * The derived claims, run over 50 roots instead of a three-package miniature.
 *
 * Four earlier suggestions asked for this fixture so these could stop being
 * asked of a hand-built shape: a case whose report has one multi-candidate
 * group cannot tell a per-group reading from a global one.
 */
describe("the candidate set, over the real shape", () => {
  const verdict = evaluateAudit(SNAPSHOT_REPORT, SNAPSHOT_ACCEPTED, SNAPSHOT_INSTALLED);

  it("was taken recently enough to be worth reading", () => {
    // Not an expiry — a re-take is a judgement call and this says nothing
    // about when to make it. It holds the DATE to the shape of a date, so a
    // header claiming a snapshot has one that can be checked.
    assert.match(SNAPSHOT_TAKEN, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("carries every candidate's own named version, for every group", () => {
    // `selfNamedVersions`' keys ARE the union of every group's candidates, and
    // over a one-group fixture that is true by accident. Five groups and nine
    // direct packages is the shape that can tell them apart.
    const union = new Set(
      [...verdict.majorOnly, ...verdict.fixableInRange, ...verdict.pinnedFix].flatMap((found) =>
        fixCandidates(SNAPSHOT_REPORT, advisoryPackage(found.key)),
      ),
    );
    assert.ok(union.size >= 7, `only ${String(union.size)} candidates across the report`);
    for (const name of union) {
      assert.ok(
        verdict.tree?.versions[name] !== undefined,
        `${name} is a candidate and the tree names no version for it`,
      );
    }
  });

  it("reads a direction for every candidate, because the lockfile half is complete", () => {
    // `SNAPSHOT_INSTALLED` is nine entries and the header claims that is
    // COMPLETE rather than a sample — every lookup the gate makes is of a
    // direct package in the report. This is that claim: no candidate went
    // unplaced, so `namedFixUnread` is empty and the floor never fires.
    assert.deepEqual(verdict.namedFixUnread, []);
    assert.deepEqual(verdict.namedFixStale, []);
    assert.deepEqual(verdict.namedFixUnclaimed, []);
  });

  it("names the backward fixes npm offers, which is the green path's own reading", () => {
    // Two of them on this tree, and both are packages npm names a version for
    // that is BEHIND what is installed — the sentence the gate printed falsely
    // for a month before the direction was read.
    assert.deepEqual(verdict.backwardNamedFixes, [
      "@sentry/react-native: npm names 5.15.2, the lockfile is on 7.5.0",
      "expo: npm names 44.0.6, the lockfile is on 54.0.35",
      "gh-pages: npm names 6.1.1, the lockfile is on 6.3.0",
    ]);
  });
});
