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
 * WHO CHECKS WHAT, since three things now check one property and the answer
 * had been living in a comment inside one of them:
 *
 * - `__tests__/floor-walks.test.ts` is the CHEAP enforcement. It counts
 *   through `listSourceFiles`, spawns nothing, and covers every walk in the
 *   table — including the five-root one no fixture can afford.
 * - `__tests__/lint-guard-partial-root.test.ts` is the PROOF. It builds a temp
 *   tree per root and runs the real guard binary in it, which is the only
 *   evidence that the wrapper actually refuses; it costs seconds, so it covers
 *   the four walks whose trees are small enough to copy.
 * - `npm run remeasure-floors` is the ADVISORY. Same arithmetic, run by a
 *   person when a floor goes red, and it suggests the number the other two can
 *   only demand. Deliberately not in `lint:all`: a floor is re-measured with a
 *   reason, and a tool in CI that computed one would be writing the half of
 *   the note it cannot write.
 *
 * The two that measure THIS tree — the counting case and the script — take
 * their counts through the same premise, {@link checkWalkPremise}, because a
 * claim about a floor is only as good as the walk under it. The fixture suite
 * needs no premise: it builds the tree it measures.
 *
 * Only the multi-root walks are here. A single-root floor has nothing for this
 * property to say, and a floor over a fixed file list
 * (`check-appstore-config`) is not a walk at all.
 *
 * Pure: names and extension lists, no filesystem. The counting is
 * `scripts/remeasure-floors.ts`, which is where the disk access belongs — the
 * same split `lib/scanned-floor.ts` and the guard wrappers already have.
 */

import { MARKUP_EXTENSIONS, MODULE_EXTENSIONS, SOURCE_EXTENSIONS } from "./source-dirs";

export type FloorWalk = {
  readonly roots: readonly string[];
  readonly extensions?: readonly string[];
};

export const FLOOR_WALKS: Readonly<Record<string, FloorWalk>> = {
  "check-inline-hex": { roots: ["app", "components", "lib"] },
  "check-inline-radius": { roots: ["app", "components"] },
  "check-analytics-imports": { roots: ["app", "components"] },
  "check-clarity-input-mask": { roots: ["app", "components"], extensions: MARKUP_EXTENSIONS },
  "check-a11y-icon-labels": { roots: ["app", "components"], extensions: MARKUP_EXTENSIONS },
  "check-problem-phrasing-imports": {
    roots: ["app", "components", "lib", "scripts", "__tests__"],
  },
};

/**
 * Module extensions a floor walk deliberately does not count, one reason each.
 *
 * The partition {@link checkWalkPremise} makes: an extension found in a scan
 * root is either in the walk's own list, or covered by one of the declared sets
 * in `lib/source-dirs.ts` (which is how a markup walk narrows to `.tsx`
 * without every `.ts` beside it reading as a hole), or named here — and
 * anything else is a file of code in the guard's own scan root that no floor
 * counts and nobody decided to skip.
 *
 * A reason each rather than a bare list, for the same reason
 * {@link import("./source-dirs").NEVER_WALKED_REASONS} carries one: a skip
 * list without reasons stops being reviewable at the second entry, and both of
 * these are excused by a boundary — "run by node, not built by tsc" — that a
 * future file under the same extension could quietly fall the other side of.
 */
export const UNCOUNTED_MODULE_REASONS: Readonly<Record<string, string>> = {
  ".js": "plain node scripts that the TypeScript build never sees — `scripts/serve-dist.js` is invoked by node directly, imports nothing from `app/` or `lib/`, and would be a `.ts` file the moment it did",
  ".mjs": "the runner's module stubs under `__tests__/helpers/stubs/`, resolved by node's loader rather than imported by name, so no rule about how this repository's TypeScript imports things has anything to say about them",
};

/**
 * What one scan root actually holds, as counts somebody else did the walking
 * for.
 *
 * `counted` is the number the floor is measured from — whatever the guard's
 * own walk returned. `present` is the same root walked with NO extension
 * filter, tallied. Two numbers from two walks on purpose: a premise that
 * derived both from one tally could not notice the two walks disagreeing,
 * which is the failure it most wants to catch.
 */
export type RootEvidence = {
  readonly root: string;
  readonly counted: number;
  /** Every file under the root by lower-cased extension, unfiltered. */
  readonly present: Readonly<Record<string, number>>;
};

/**
 * The ways a walk can measure something other than what it claims to.
 *
 * Every one of these leaves the floor comparison TRUE for a reason that has
 * nothing to do with floors, which is what makes them a premise rather than a
 * second claim.
 */
export type WalkPremiseCode =
  /** A root walked to zero files, so it contributes nothing to defend. */
  | "empty_root"
  /**
   * The guard's walk and an unfiltered walk of the same root disagree on how
   * many files carry the walk's extensions — a skip list or a filter that
   * differs between the two, which is invisible in a green run.
   */
  | "count_mismatch"
  /**
   * An extension this walk declares matched nothing under ANY of its roots, so
   * the walk is narrower than it reads and nothing said so.
   */
  | "unused_extension"
  /**
   * A root holds module code under an extension no declared set covers and no
   * entry in {@link UNCOUNTED_MODULE_REASONS} excuses.
   */
  | "uncounted_extension";

/** One finding, as ids and numbers — the words are {@link describeWalkPremiseProblem}'s. */
export type WalkPremiseProblem = {
  readonly checkName: string;
  readonly code: WalkPremiseCode;
  /** The root it is about; absent only for `unused_extension`, which is walk-wide. */
  readonly root?: string;
  /** The extension it is about, for the two codes that are about one. */
  readonly extension?: string;
  /** What the guard's walk returned, for the two codes that are about a count. */
  readonly counted?: number;
  /** What the unfiltered tally held, for `count_mismatch`; the file count for `uncounted_extension`. */
  readonly found?: number;
};

/** Exhaustive over {@link WalkPremiseCode} — a new code needs a sentence. */
const PREMISE_DETAIL: Record<WalkPremiseCode, (p: WalkPremiseProblem) => string> = {
  empty_root: (p) =>
    `${p.root ?? "an unnamed root"}/ walked to zero files, so it defends nothing and the floor above it is cleared by the other roots alone`,
  count_mismatch: (p) =>
    `${p.root ?? "an unnamed root"}/ was counted as ${String(p.counted ?? 0)} file(s) and an unfiltered walk of the same root holds ${String(p.found ?? 0)} with those extensions — the two walks disagree about what is in one directory, so the floor is measured over a set nothing else can reproduce`,
  unused_extension: (p) =>
    `declares ${p.extension ?? "an extension"} and no file under any of its roots carries it, so the walk is narrower than its list reads and the number under it is a count of the other extensions`,
  uncounted_extension: (p) =>
    `${p.root ?? "an unnamed root"}/ holds ${String(p.found ?? 0)} ${p.extension ?? "?"} file(s) that this walk does not count and no declared extension set covers — add it to the walk, or excuse it by name in UNCOUNTED_MODULE_REASONS with the reason it is not this rule's business`,
};

/**
 * One premise problem as the sentence a reader meets, subject first.
 *
 * The detail table stays private and this is the only way out of it, so a
 * caller cannot print half a sentence: the check name is the subject of every
 * one of these, and a message that opened with the predicate would read as a
 * fact about the tree rather than about one guard's walk.
 */
export function describeWalkPremiseProblem(problem: WalkPremiseProblem): string {
  return `${problem.checkName}: ${PREMISE_DETAIL[problem.code](problem)}`;
}

/**
 * Whether a walk measured what it says it measures, over evidence somebody
 * else did the walking for.
 *
 * The claim a floor makes is "no single root clears this alone"; the premise
 * is that the counts on both sides of that comparison came from the tree the
 * guard means. The case enforcing the claim used to check one half of the
 * premise — that each root walked to SOMETHING — which a root whose extension
 * filter had silently stopped matching passes on the files it does still
 * match, while measuring a fraction of the directory.
 *
 * Pure, and here rather than in the suite for the reason the arithmetic above
 * is: the interesting evidence — a root holding an extension nobody accounted
 * for, two walks disagreeing over one directory — is evidence no checkout of
 * this repository currently produces, so a check that could only run against
 * the real tree would be a check of today's tree.
 *
 * Throws on empty evidence, for the same reason {@link measureFloorWalk} does:
 * a premise that passes because there was nothing to look at is the vacuous
 * pass this whole module exists to refuse.
 */
export function checkWalkPremise(
  checkName: string,
  walk: FloorWalk,
  roots: readonly RootEvidence[],
): WalkPremiseProblem[] {
  if (roots.length === 0) {
    throw new Error(`${checkName}: a walk premise checked over no roots has nothing to be a premise about`);
  }
  const extensions = walk.extensions ?? SOURCE_EXTENSIONS;
  const problems: WalkPremiseProblem[] = [];
  const matchedSomewhere = new Set<string>();
  for (const { root, counted, present } of roots) {
    const tallied = extensions.reduce((sum, extension) => sum + (present[extension] ?? 0), 0);
    for (const extension of extensions) {
      if ((present[extension] ?? 0) > 0) matchedSomewhere.add(extension);
    }
    if (counted === 0) {
      problems.push({ checkName, code: "empty_root", root, counted });
    } else if (tallied !== counted) {
      problems.push({ checkName, code: "count_mismatch", root, counted, found: tallied });
    }
    for (const [extension, found] of Object.entries(present)) {
      if (found === 0) continue;
      // Covered by a declared set is not a hole: a markup walk narrowing to
      // `.tsx` leaves `.ts` files beside it uncounted BY DESIGN, and the set
      // that does count them is the reason that is a narrowing rather than a
      // gap. What no declared set names is the case with nobody behind it.
      if (SOURCE_EXTENSIONS.includes(extension)) continue;
      if (!MODULE_EXTENSIONS.includes(extension)) continue;
      if (extension in UNCOUNTED_MODULE_REASONS) continue;
      problems.push({ checkName, code: "uncounted_extension", root, extension, found });
    }
  }
  for (const extension of extensions) {
    if (!matchedSomewhere.has(extension)) {
      problems.push({ checkName, code: "unused_extension", extension });
    }
  }
  return problems;
}

/**
 * Excuses that name an extension the walked tree does not hold.
 *
 * The other half of {@link UNCOUNTED_MODULE_REASONS} being a partition rather
 * than a list: an entry nothing matches is a reason kept for a file that left,
 * and it silently widens the excuse the day a different file arrives under the
 * same extension. The same audit `NOT_SCANNED_EXTENSION_REASONS` gets in
 * `__tests__/secret-scan.test.ts`, which is where the shape comes from.
 */
export function unusedUncountedExcuses(present: Iterable<string>): string[] {
  const held = new Set(present);
  return Object.keys(UNCOUNTED_MODULE_REASONS).filter((extension) => !held.has(extension));
}

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
