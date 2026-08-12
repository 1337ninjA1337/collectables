/**
 * Shared "the guard actually looked at something" premise for the working-tree
 * `LINT_GUARDS` scanners (pure logic — the walking lives in each
 * `scripts/check-*.ts` wrapper).
 *
 * Every one of these guards proves a NEGATIVE over a directory walk: no inline
 * hex literal, no committed secret, no undocumented migration. A negative
 * proved over zero files is indistinguishable, in the log, from a negative
 * proved over the whole tree — `check-inline-hex` printed
 * `scanned 0 file(s), no inline hex literals.` and exited 0, which is exactly
 * what a renamed directory, a moved source root or a tightened `.gitignore`
 * produces. The guard does not fail; it evaporates, and the green line it
 * leaves behind is the thing that stops anyone from noticing.
 *
 * `evaluatePrivacyBaselineProvenance`'s `checked === 0` refusal ("a pass over
 * zero baselines is not a pass") and `evaluateScannedFiles` in
 * `lib/bundle-premise.ts` are the same instinct, each welded to one guard.
 * This module is that instinct lifted out so all twelve can hold it.
 *
 * A floor is stricter than `count > 0` on purpose. Zero files is the loud
 * version of the failure; ONE file is the quiet version, and a walk that lost
 * `app/` but kept `lib/` still reports a comfortable-looking number. So each
 * guard commits a MEASURED minimum — a fact about the current tree with slack
 * under it, in the same spirit as `PRIVACY_BODY_BASELINES` — rather than a
 * magic constant. When a floor legitimately stops matching the tree, the fix
 * is to re-measure and say so in the commit, which is the point: the number
 * only moves deliberately.
 *
 * Node-pure on purpose: imported by the tsx CLI wrappers and by node tests.
 */

/** Why a floor check failed. */
export type ScannedFloorFailureCode =
  /** The walk found nothing at all — the loud version. */
  | "no_files"
  /** The walk found files, but fewer than the guard has ever seen. */
  | "below_floor"
  /** The FLOOR is bogus (< 1), so the check could never have failed. */
  | "invalid_floor";

export type ScannedFloorFailure = {
  readonly code: ScannedFloorFailureCode;
  /** What the walk actually turned up. */
  readonly count: number;
  /** The committed minimum it was measured against. */
  readonly minimum: number;
  /** Plural noun for what was counted, e.g. `"source file"`. */
  readonly label: string;
};

export type ScannedFloorVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: ScannedFloorFailure };

const OK: ScannedFloorVerdict = { ok: true };

/** Default noun when a caller does not name what it counted. */
export const DEFAULT_SCANNED_LABEL = "file";

/**
 * A minimum below 1 is a bug in the CALLER, not a finding about the tree: a
 * floor of 0 passes over an empty walk, which is the exact hole this module
 * exists to close, and it would do it while looking like the hole was
 * covered. It is reported as its own failure code rather than thrown so the
 * message can name the guard alongside the other two.
 */
export function evaluateScannedFloor(
  count: number,
  minimum: number,
  label: string = DEFAULT_SCANNED_LABEL,
): ScannedFloorVerdict {
  if (!Number.isInteger(minimum) || minimum < 1) {
    return { ok: false, failure: { code: "invalid_floor", count, minimum, label } };
  }
  if (count <= 0) {
    return { ok: false, failure: { code: "no_files", count, minimum, label } };
  }
  if (count < minimum) {
    return { ok: false, failure: { code: "below_floor", count, minimum, label } };
  }
  return OK;
}

const REMEASURE_HINT =
  "If the tree legitimately shrank, re-measure the floor in lib/scanned-floor.ts and say why in the commit.";

/**
 * Exhaustive over {@link ScannedFloorFailureCode}, so a new code cannot ship
 * without a message — same shape as `FAILURE_MESSAGE` in `lib/bundle-premise.ts`.
 */
const FAILURE_MESSAGE: Record<
  ScannedFloorFailureCode,
  (failure: ScannedFloorFailure) => string
> = {
  no_files: (f) =>
    `scanned 0 ${f.label}(s) — a pass over zero ${f.label}s is not a pass, so this guard did not run. Expected at least ${f.minimum}. Check the scan roots still exist and are readable.`,
  below_floor: (f) =>
    `scanned ${f.count} ${f.label}(s), below the committed floor of ${f.minimum} — the walk is missing most of what it used to see, so a green result here proves nothing. ${REMEASURE_HINT}`,
  invalid_floor: (f) =>
    `floor of ${f.minimum} is not a positive integer — a floor below 1 passes over an empty walk, which is the failure it is supposed to catch. ${REMEASURE_HINT}`,
};

/** One-line, prefixed with the guard's own name so the log says who failed. */
export function formatScannedFloorFailure(
  checkName: string,
  failure: ScannedFloorFailure,
): string {
  return `${checkName}: ERROR — ${FAILURE_MESSAGE[failure.code](failure)}`;
}

/** Thrown by {@link assertScanned}; carries the verdict for callers that want it. */
export class ScannedFloorError extends Error {
  readonly failure: ScannedFloorFailure;
  readonly checkName: string;

  constructor(checkName: string, failure: ScannedFloorFailure) {
    super(formatScannedFloorFailure(checkName, failure));
    this.name = "ScannedFloorError";
    this.checkName = checkName;
    this.failure = failure;
  }
}

/**
 * The one line a guard wrapper adds after its walk and before its report.
 * Throws {@link ScannedFloorError} rather than calling `process.exit` so the
 * helper stays node-pure and the wrapper keeps deciding its own exit code.
 */
export function assertScanned(
  checkName: string,
  count: number,
  minimum: number,
  label: string = DEFAULT_SCANNED_LABEL,
): void {
  const verdict = evaluateScannedFloor(count, minimum, label);
  if (!verdict.ok) throw new ScannedFloorError(checkName, verdict.failure);
}

export type ScannedFloor = {
  /** Plural noun for what the guard walks. */
  readonly label: string;
  /** Committed minimum: a measured count of the tree, with slack under it. */
  readonly minimum: number;
  /** What was measured, when, and how much slack the floor leaves. */
  readonly note: string;
};

/**
 * Per-guard floors, keyed by the guard's own check name (the string it prints
 * at the head of its report), NOT by npm script — the name in the message and
 * the name in this table have to be the same thing or the failure line points
 * at a key nobody can find.
 *
 * Each entry is a measurement, not a target. Slack is deliberately generous
 * (~30%): the floor exists to catch a walk that lost a whole source root, not
 * to notice a deleted file, and a floor that trips on ordinary churn is a
 * floor that gets deleted.
 */
export const SCANNED_FLOORS: Readonly<Record<string, ScannedFloor>> = {
  "check-inline-hex": {
    label: "source file",
    minimum: 150,
    note: "app/ + components/ + lib/ held 211 .ts/.tsx files on 2026-08-12; 150 leaves room to delete a quarter of them, but losing any one of the three scan roots drops below it.",
  },
  "check-secrets": {
    label: "file",
    minimum: 500,
    note: "the whole-tree walk (minus node_modules/.git/dist and non-text extensions) held 711 files on 2026-08-12; 500 survives ordinary pruning while a walk that lost __tests__/ or lib/ does not.",
  },
};

/** Throws if `checkName` has no committed floor — a guard cannot opt out silently. */
export function scannedFloorFor(checkName: string): ScannedFloor {
  const floor = SCANNED_FLOORS[checkName];
  if (!floor) {
    throw new Error(
      `scanned-floor: no committed floor for "${checkName}" — add one to SCANNED_FLOORS in lib/scanned-floor.ts.`,
    );
  }
  return floor;
}

/**
 * The floor assertion in the form a wrapper wants it: look the guard's own
 * floor up by name and apply it, so the wrapper never carries a bare number.
 */
export function assertScannedFloor(checkName: string, count: number): void {
  const floor = scannedFloorFor(checkName);
  assertScanned(checkName, count, floor.minimum, floor.label);
}
