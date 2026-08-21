#!/usr/bin/env tsx
/**
 * What every multi-root floor is worth today, beside what it declares.
 *
 * `__tests__/lint-guard-partial-root.test.ts` enforces the property a
 * multi-root floor cannot state on its own: no single scan root may clear it,
 * or a walk that lost every other root still reports green. That test goes red
 * the day an ordinary file lands in the largest root — three times now for
 * `check-inline-hex`, once for `check-inline-radius` — and the failure arrives
 * in a suite that has nothing to do with the change that caused it. The fix is
 * four manual steps every time: count the roots, find the largest, pick a
 * number above it with slack, rewrite a note.
 *
 * This does the counting. It prints, per floor, the declared minimum, what the
 * walk holds now, the per-root breakdown, the largest single root, and the
 * suggested new minimum when the current one no longer clears that root — so
 * the re-measure is a diff rather than a dig. It DECIDES nothing: the number
 * that lands in `SCANNED_FLOORS` and the sentence explaining it are a person's
 * call, and a script that rewrote the table would be a script that erased the
 * reasoning the table exists to hold.
 *
 * Read-only, and not in `lint:all`: this is a tool a person runs when a floor
 * goes red, not a guard. Nothing here can fail a build — the exit status is 1
 * only when a floor is genuinely no longer holding its property, or when a
 * walk turns out not to be measuring what it declares, so it is usable in a
 * pinch as a check without ever being one by default.
 *
 * The second of those is why every root is walked twice: once through the
 * guard's own filter for the count, and once unfiltered for what is actually
 * there. A tool that only ever saw the filtered walk would happily suggest a
 * SMALLER floor for a guard that had quietly stopped reading half its root —
 * counting the erosion and writing it into the table as the new normal.
 * `checkWalkPremise` states that gap; those lines print under the row they
 * undermine and are named again at the end.
 *
 * The suggested minimum reproduces the arithmetic the existing notes use: sit
 * above the largest single root, and leave roughly a quarter of the total
 * deletable. Where the two disagree — a tree so lopsided that "above the
 * largest root" already eats the slack — the property wins and the line says
 * so, because slack is a comfort and the property is the point.
 */

import * as path from "node:path";

import {
  checkWalkPremise,
  describeWalkPremiseProblem,
  FLOOR_DRIFT,
  FLOOR_WALKS,
  formatFloorMeasurement,
  measureFloorWalk,
  type FloorMeasurement,
  type WalkPremiseProblem,
} from "../lib/floor-walks";
import { SCANNED_FLOORS } from "../lib/scanned-floor";
import { SOURCE_EXTENSIONS } from "../lib/source-dirs";
import { listSourceFiles, tallyExtensions } from "./guard-io";

const REPO_ROOT = path.join(__dirname, "..");

/** A measurement and whether the tree it was taken over is the tree it claims. */
type MeasuredFloor = {
  readonly row: FloorMeasurement;
  readonly premise: readonly WalkPremiseProblem[];
};

/**
 * One floor's counts, walked. The arithmetic over them is
 * {@link measureFloorWalk} in `lib/floor-walks.ts`, which is where a test can
 * reach it — this half is the disk.
 *
 * Two walks per root, not one: the filtered walk is the number, the unfiltered
 * tally beside it is what makes the number checkable. A suggestion computed
 * from a walk that had quietly stopped matching part of its own root would be
 * this tool's worst possible output — a smaller floor, justified by counting,
 * with the erosion it was written to catch baked into the new number.
 */
function measure(checkName: string): MeasuredFloor | null {
  const walk = FLOOR_WALKS[checkName];
  const floor = SCANNED_FLOORS[checkName]?.count;
  // A walk without a count floor is not a thing this tool has an opinion
  // about, and saying so with `null` keeps the caller's loop free of a branch
  // per table.
  if (!walk || !floor) return null;
  const extensions = walk.extensions ?? SOURCE_EXTENSIONS;
  const perRoot = walk.roots.map((root) => ({
    root,
    count: listSourceFiles(REPO_ROOT, [root], extensions).length,
  }));
  return {
    row: measureFloorWalk(
      checkName,
      floor.minimum,
      floor.label,
      perRoot,
      // Which rule this row is judged under. A guard that declares its roots
      // asserts the property itself, so its number is only ever about the
      // other failure — a walk that came back implausibly small with every
      // root present — and this tool stops asking it to move.
      floor.roots ? "declared_roots" : "arithmetic",
    ),
    premise: checkWalkPremise(
      checkName,
      walk,
      perRoot.map(({ root, count }) => ({
        root,
        counted: count,
        present: tallyExtensions(REPO_ROOT, root),
      })),
    ),
  };
}

function main(): void {
  const measured = Object.keys(FLOOR_WALKS)
    .map(measure)
    .filter((entry): entry is MeasuredFloor => entry !== null);
  const rows = measured.map((entry) => entry.row);
  if (rows.length === 0) {
    // FLOOR_WALKS is hand-kept; empty means somebody emptied it, and printing
    // "0 floors, all fine" over that is the vacuous pass these floors exist to
    // refuse one level down.
    console.error("remeasure-floors: no multi-root floors to measure — FLOOR_WALKS is empty.");
    process.exit(1);
  }
  console.log(
    `remeasure-floors: ${String(rows.length)} multi-root floor(s), measured from ${REPO_ROOT}\n`,
  );
  for (const { row, premise } of measured) {
    console.log(formatFloorMeasurement(row));
    // Under the row it undermines rather than in a block of its own: a premise
    // problem is the reason to distrust THAT line's numbers, and a reader who
    // met it after the whole table would have already read the suggestion.
    for (const problem of premise) console.log(`       ! ${describeWalkPremiseProblem(problem)}`);
  }
  const moved = rows.filter((row) => row.actionable);
  const drifted = rows.filter(
    (row) => !row.actionable && row.slackPercent >= FLOOR_DRIFT * 100,
  );
  const unsound = measured.filter((entry) => entry.premise.length > 0);
  console.log("");
  // Named before the early return, because a drifted floor is the one finding
  // here that never fails anything: mentioned only inside the per-row block it
  // would be the line a reader scrolls past on an otherwise-clean run.
  if (drifted.length > 0) {
    console.log(
      `remeasure-floors: ${String(drifted.length)} floor(s) have drifted loose as the tree grew — ` +
        `${drifted.map((row) => row.checkName).join(", ")}. Nothing is broken and nothing will go red for it; ` +
        `re-measure when convenient.`,
    );
  }
  if (moved.length === 0 && unsound.length === 0) {
    console.log(
      "remeasure-floors: nothing to move — every floor either declares its scan roots (so the property is asserted by the guard, not by the number) or still sits above its largest single root.",
    );
    return;
  }
  if (moved.length > 0) {
    console.log(
      `remeasure-floors: ${String(moved.length)} floor(s) hold the no-single-root property by arithmetic and no longer sit above their largest root: ` +
        `${moved.map((row) => row.checkName).join(", ")}. Declare their roots in lib/scanned-floor.ts, or re-measure.`,
    );
  }
  if (unsound.length > 0) {
    // Louder than a moved floor and printed last, because it is the one
    // finding that makes the numbers above unusable: fix what the walk reads
    // before re-measuring anything from it.
    console.log(
      `remeasure-floors: ${String(unsound.length)} walk(s) are not measuring what they declare: ` +
        `${unsound.map((entry) => entry.row.checkName).join(", ")}. ` +
        `Every count above them is a count of some other set of files — settle that first.`,
    );
  }
  process.exit(1);
}

main();
