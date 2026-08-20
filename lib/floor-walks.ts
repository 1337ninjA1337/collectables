/**
 * What each multi-root floor is measured OVER, so re-measuring one is a command
 * rather than an archaeology dig.
 *
 * A floor on a multi-root walk carries a property its own number cannot state:
 * no single scan root may clear it alone, or a walk that lost every other root
 * still reports green. `__tests__/lint-guard-partial-root.test.ts` enforces
 * that, and it goes red the day an ordinary file lands in the largest root —
 * which has now happened three times to `check-inline-hex` and once to
 * `check-inline-radius`. Each time the fix was the same four steps by hand:
 * count the roots, find the largest, pick a number above it with slack, rewrite
 * a note. `npm run remeasure-floors` does the counting, and this is the table
 * it counts from.
 *
 * Its own module rather than a second table in `lib/scanned-floor.ts`, for a
 * reason found the hard way: it is keyed by the same check names as
 * `SCANNED_FLOORS`, and `entryPatch` — the guard fixture that breaks one entry
 * to prove a wrapper refuses — locates an entry by `indexOf('  "name": {')`.
 * Two tables keyed alike in one file means the patcher silently targets
 * whichever comes first, which is a fixture quietly testing the wrong thing. It
 * reads better here too: a reader of a floor wants the number and its reason,
 * and a reader of this wants the shape of the walk under it.
 *
 * `extensions` omitted means the walk's own default (`SOURCE_EXTENSIONS`, both
 * `.ts` and `.tsx`); `check-clarity-input-mask` takes markup only, which is why
 * its count sits one under the otherwise identical radius walk.
 *
 * Only the multi-root walks are here. A single-root floor has nothing for this
 * property to say, and a floor over a fixed file list
 * (`check-appstore-config`) is not a walk at all.
 *
 * Pure: names and extension lists, no filesystem. The counting is
 * `scripts/remeasure-floors.ts`, which is where the disk access belongs — the
 * same split `lib/scanned-floor.ts` and the guard wrappers already have.
 */

import { MARKUP_EXTENSIONS } from "./source-dirs";

export type FloorWalk = {
  readonly roots: readonly string[];
  readonly extensions?: readonly string[];
};

export const FLOOR_WALKS: Readonly<Record<string, FloorWalk>> = {
  "check-inline-hex": { roots: ["app", "components", "lib"] },
  "check-inline-radius": { roots: ["app", "components"] },
  "check-analytics-imports": { roots: ["app", "components"] },
  "check-clarity-input-mask": { roots: ["app", "components"], extensions: MARKUP_EXTENSIONS },
  "check-problem-phrasing-imports": {
    roots: ["app", "components", "lib", "scripts", "__tests__"],
  },
};

/**
 * Share of the walk a floor is measured to leave deletable.
 *
 * `SCANNED_FLOORS`'s own header says slack is "deliberately generous (~30%)"
 * and the notes that do the arithmetic land between a quarter and a third. A
 * quarter is the number this tool suggests with: it is the tighter reading, so
 * a suggestion never claims more room than the notes it is imitating.
 */
export const FLOOR_SLACK = 0.25;

/** One root's contribution to a walk. */
export type RootCount = { readonly root: string; readonly count: number };

export type FloorMeasurement = {
  readonly checkName: string;
  readonly minimum: number;
  readonly label: string;
  readonly total: number;
  readonly perRoot: readonly RootCount[];
  readonly largestRoot: RootCount;
  /** True while no single root clears the declared minimum on its own. */
  readonly holds: boolean;
  /** Percent of the walk a deletion could remove before the floor trips. */
  readonly slackPercent: number;
  /** What the floor would be if re-measured today. */
  readonly suggested: number;
};

/**
 * The arithmetic of a re-measure, over counts somebody else did the walking
 * for.
 *
 * Pure and here rather than in the script for the reason every guard in this
 * repository splits the same way: the wrapper walks and prints, and the thing
 * that decides what the numbers MEAN is a function a test can call without a
 * filesystem. The interesting cases — a floor level with its largest root, a
 * tree so lopsided that the property and the slack disagree — are ones no
 * checkout of this repository can currently produce, so a test that could only
 * run against the real tree would be a test of today's numbers.
 *
 * Throws on an empty `perRoot`: a measurement over no roots has no largest one,
 * and answering with a zero floor would be this module producing exactly the
 * vacuous number `SCANNED_FLOORS` exists to refuse.
 */
export function measureFloorWalk(
  checkName: string,
  minimum: number,
  label: string,
  perRoot: readonly RootCount[],
): FloorMeasurement {
  if (perRoot.length === 0) {
    throw new Error(
      `${checkName}: a floor measured over no scan roots has no largest root to sit above`,
    );
  }
  const total = perRoot.reduce((sum, entry) => sum + entry.count, 0);
  // Ties go to the first root in declared order, which is the order the guard
  // walks and the order every note reads in.
  const largestRoot = perRoot.reduce((max, entry) => (entry.count > max.count ? entry : max));
  return {
    checkName,
    minimum,
    label,
    total,
    perRoot,
    largestRoot,
    holds: minimum > largestRoot.count,
    slackPercent: total === 0 ? 0 : Math.round(((total - minimum) / total) * 100),
    // Above the largest root, and leaving a quarter of the walk deletable —
    // whichever of the two is STRICTER, because the property is not negotiable
    // and the slack is. On a lopsided tree the first wins and the suggestion is
    // tighter than the notes' usual slack; that is the honest answer, since a
    // floor under its largest root is not a floor.
    suggested: Math.max(largestRoot.count + 1, Math.floor(total * (1 - FLOOR_SLACK))),
  };
}

/**
 * One measurement as the lines a person reads, `MOVE` first when it needs
 * acting on so the column scans.
 *
 * The suggested number appears only when the floor has actually stopped holding
 * its property, or when the slack is TIGHTER than these floors are measured
 * with. A floor with more room than the target is a floor doing its job, and a
 * tool that told its reader to tighten one would be a tool nobody runs twice.
 */
export function formatFloorMeasurement(row: FloorMeasurement): string {
  const breakdown = row.perRoot.map(({ root, count }) => `${root} ${String(count)}`).join(", ");
  const lines = [
    `${row.holds ? "ok  " : "MOVE"} ${row.checkName}`,
    `       declared ${String(row.minimum)} ${row.label}(s); walk holds ${String(row.total)} (${breakdown})`,
    `       largest single root: ${row.largestRoot.root} at ${String(row.largestRoot.count)}` +
      `, ${String(row.slackPercent)}% of the walk currently deletable`,
  ];
  if (!row.holds) {
    lines.push(
      `       ${row.largestRoot.root}/ alone clears the floor, so every other root could vanish and the guard still passes.`,
      `       re-measure to ${String(row.suggested)} and say why in the note — the note is the half this tool cannot write.`,
    );
  } else if (row.slackPercent < FLOOR_SLACK * 100) {
    lines.push(
      `       holds, but only ${String(row.slackPercent)}% is deletable — under the ~${String(FLOOR_SLACK * 100)}% these floors are measured with,`,
      `       so it will trip on ordinary churn before it catches a lost root.`,
    );
  }
  return lines.join("\n");
}
