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
 * only when a floor is genuinely no longer holding its property, so it is
 * usable in a pinch as a check without ever being one by default.
 *
 * The suggested minimum reproduces the arithmetic the existing notes use: sit
 * above the largest single root, and leave roughly a quarter of the total
 * deletable. Where the two disagree — a tree so lopsided that "above the
 * largest root" already eats the slack — the property wins and the line says
 * so, because slack is a comfort and the property is the point.
 */

import * as path from "node:path";

import {
  FLOOR_WALKS,
  formatFloorMeasurement,
  measureFloorWalk,
  type FloorMeasurement,
} from "../lib/floor-walks";
import { SCANNED_FLOORS } from "../lib/scanned-floor";
import { SOURCE_EXTENSIONS } from "../lib/source-dirs";
import { listSourceFiles } from "./guard-io";

const REPO_ROOT = path.join(__dirname, "..");

/**
 * One floor's counts, walked. The arithmetic over them is
 * {@link measureFloorWalk} in `lib/floor-walks.ts`, which is where a test can
 * reach it — this half is the disk.
 */
function measure(checkName: string): FloorMeasurement | null {
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
  return measureFloorWalk(checkName, floor.minimum, floor.label, perRoot);
}

function main(): void {
  const rows = Object.keys(FLOOR_WALKS)
    .map(measure)
    .filter((row): row is FloorMeasurement => row !== null);
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
  for (const row of rows) console.log(formatFloorMeasurement(row));
  const moved = rows.filter((row) => !row.holds);
  console.log("");
  if (moved.length === 0) {
    console.log("remeasure-floors: every floor still sits above its largest single scan root.");
    return;
  }
  console.log(
    `remeasure-floors: ${String(moved.length)} floor(s) no longer sit above their largest root: ` +
      `${moved.map((row) => row.checkName).join(", ")}. Edit lib/scanned-floor.ts.`,
  );
  process.exit(1);
}

main();
