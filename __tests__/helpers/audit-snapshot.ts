/**
 * One real `npm audit --json` report, frozen, with the inputs it is read against.
 *
 * ## The gap this closes
 *
 * Every suite that reads an audit report builds one by hand, and the hand-built
 * ones are three packages wide. The shape the design was measured on is fifty
 * vulnerability roots over nine direct dependencies, with `effects` chains, a
 * `fixAvailable: false`, a bare `fixAvailable: true`, four multi-candidate
 * groups and two packages npm names a version for that is BEHIND what is
 * installed. Nothing in the tree carried it, so no case could run over it.
 *
 * It also closes a gap in how changes to the gate were being proved. Three
 * refactors of `lib/audit-baseline.ts` on 2026-10-09 were each verified by
 * running `npm run lint:audit-baseline` and reading 1,400 characters of prose
 * about five groups — `verify`'s 9,961 cases stayed green either side of all
 * three and not one of them printed the gate's output for a real report.
 *
 * ## Why all three inputs are frozen
 *
 * The verdict is a function of three things and every one of them moves:
 *
 * - **the report**, because the registry publishes and withdraws advisories —
 *   and because `fixAvailable` is not even stable between two runs on one
 *   unchanged tree: eleven runs on 2026-10-05 named three different packages
 *   for `braces`. This fixture froze one of those answers (`react-native`),
 *   which is the point rather than a caveat.
 * - **the installed versions**, because a lockfile bump changes them with no
 *   diff in any file a suite reads.
 * - **the accepted list**, because `ACCEPTED_HIGH_ADVISORIES` is a living
 *   triage record that gains and loses entries every week.
 *
 * Read live, any one of them would make a committed expected block churn, and
 * a block that churns is one that gets regenerated rather than read. So this
 * holds the FORMATTER to an output, which is what a refactor needs. Whether
 * this repository's own live baseline still agrees with its own live tree is a
 * different question, asked against the live inputs by
 * `named-fix-claim.test.ts`'s "this repository's own baseline".
 *
 * ## Taken 2026-10-09, and never asserted against by version
 *
 * `npm audit --json` on this tree, written out sorted so a re-take diffs. No
 * case here says "expo is on 54.0.35 today" — that claim belongs to the live
 * suites and is exactly what made a committed version string wrong half the
 * time when one was last tried. Re-take it when the real shape has changed
 * enough to be worth re-reading, and expect the expected block to move with
 * it.
 */

import type { AcceptedAdvisory, AuditReport } from "@/lib/audit-baseline";
import type { InstalledVersions } from "@/lib/lockfile";

import { readRepoFile } from "./repo-file";

/** The date the three snapshots below were taken, for the header above. */
export const SNAPSHOT_TAKEN = "2026-10-09";

/** The committed report: 50 roots, 9 of them direct. */
export const SNAPSHOT_REPORT: AuditReport = JSON.parse(
  readRepoFile("__tests__/fixtures/audit-report.json"),
) as AuditReport;

/**
 * What the lockfile had installed for every package the readers look up.
 *
 * Nine entries and that is COMPLETE rather than a sample: every lookup the
 * gate makes is of a DIRECT package in the report — `selfNamedVersions`' keys
 * are the direct self-naming ones, `candidateFixes` draws from the same
 * filter, and `backwardNamedFixes`' top-up reads `fixAvailable.name`, which is
 * npm's pick of a direct dependency. So an absent key here would be a package
 * nothing asks about.
 */
export const SNAPSHOT_INSTALLED: InstalledVersions = {
  "@expo/ngrok": "4.1.3",
  "@sentry/react-native": "7.5.0",
  expo: "54.0.35",
  "expo-auth-session": "7.0.11",
  "expo-linking": "8.0.12",
  "expo-router": "6.0.24",
  "gh-pages": "6.3.0",
  "react-native": "0.81.5",
  "react-native-reanimated": "4.1.7",
};

/**
 * An accepted list that covers exactly this report's high/critical advisories.
 *
 * Six of them across four packages, so the GREEN path is what the formatter
 * prints: the exemption summary, the major-only summary over five groups, the
 * backward-named-fix list, and the pinned-fix block that `image-size`'s bare
 * `fixAvailable: true` lands in. That green block is the 1,400 characters that
 * three refactors in one day were each verified against by eye.
 *
 * A copy rather than an import of `ACCEPTED_HIGH_ADVISORIES`, for the reason
 * in the header: the live list is a triage record and this is a formatter
 * fixture. The `namedFix` verdicts here are what {@link SNAPSHOT_INSTALLED}
 * actually makes them — `braces` is `forward` because `react-native@0.87.1` is
 * ahead of the locked `0.81.5` while its other three candidates are behind,
 * which is the whole reason the verdict is read over the SET.
 */
export const SNAPSHOT_ACCEPTED: readonly AcceptedAdvisory[] = [
  {
    package: "braces",
    advisories: ["GHSA-vfj7-8cjw-p6xm"],
    shipsToClient: false,
    absentFingerprint: "braces",
    why: "build-time only: micromatch globbing this repo's own paths during the web export",
    namedFix: {
      verdict: "forward",
      read: "2026-10-09",
      observed: "react-native@0.87.1 is ahead of the lockfile; its other three candidates are behind",
    },
  },
  {
    package: "image-size",
    advisories: ["GHSA-5p2g-fcmc-qvqq", "GHSA-w3rx-r6r6-pgpr"],
    shipsToClient: false,
    absentFingerprint: "image-size",
    why: "build-time only: reached through @expo/image-utils during the web export, never bundled",
    inRangeFixPinned: {
      pinnedBy: "node_modules/@expo/image-utils",
      declares: "^1.2.0",
      firstFixed: "2.0.2",
      whenForced: "forcing image-size past the pin left @expo/image-utils unable to resolve it",
      measured: "2026-10-05",
    },
    namedFix: {
      verdict: "unnamed",
      read: "2026-10-09",
      observed: "npm reports fixAvailable: true for it, an in-range fix named by no version",
    },
  },
  {
    package: "node-forge",
    advisories: ["GHSA-86w9-cpqp-85rv"],
    shipsToClient: false,
    absentFingerprint: "node-forge",
    why: "build-time only: a dev tunnel nothing in this repo starts",
    namedFix: {
      verdict: "no-forward",
      read: "2026-10-09",
      observed: "both candidates are behind the lockfile",
    },
  },
  {
    package: "postcss",
    advisories: ["GHSA-6g55-p6wh-862q", "GHSA-r28c-9q8g-f849"],
    shipsToClient: false,
    absentFingerprint: "postcss",
    why: "build-time only: a Metro CSS transform dependency, absent from every bundle chunk",
    namedFix: {
      verdict: "no-forward",
      read: "2026-10-09",
      observed: "both candidates are behind the lockfile",
    },
  },
] as const;
