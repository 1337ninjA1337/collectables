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
  | "invalid_floor"
  /** A declared fixed input was never handed over by the wrapper. */
  | "missing_input"
  /** A declared fixed input parsed, but to nothing worth checking. */
  | "empty_input";

export type ScannedFloorFailure = {
  readonly code: ScannedFloorFailureCode;
  /** What the walk actually turned up. */
  readonly count: number;
  /** The committed minimum it was measured against. */
  readonly minimum: number;
  /** Plural noun for what was counted, e.g. `"source file"`. */
  readonly label: string;
  /** Set for the two input codes: which declared input went wrong. */
  readonly input?: string;
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
  missing_input: (f) =>
    `declared input "${f.input}" was never handed to the floor check — the guard says it reads it, and this run did not. ${REMEASURE_HINT}`,
  empty_input: (f) =>
    `input "${f.input}" is empty — it was read, so nothing crashed, and every check against it then found nothing to complain about. That is not a pass.`,
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

/** The walking shape: a measured minimum over whatever the guard enumerates. */
export type ScannedCountFloor = {
  /** Plural noun for what the guard walks. */
  readonly label: string;
  /** Committed minimum: a measured count of the tree, with slack under it. */
  readonly minimum: number;
};

/**
 * Three shapes, because the twelve guards are not all walks:
 *
 * - `count` — the guard enumerates something (files, migrations, taxonomy
 *   rows) and a shrunken enumeration is the failure. Most of them.
 * - `inputs` — the guard reads a FIXED set of files by name. There is no
 *   count to floor; `readFileSync` already throws on a missing one, so the
 *   hole is the file that reads fine and carries nothing (`{}`, `""`), which
 *   every downstream check then passes with no complaints.
 * - `delegatedTo` — the guard already enforces its own premise elsewhere,
 *   named here so the registry can iterate all twelve and find no gaps.
 *
 * A guard may declare `count` and `inputs` together when it does both.
 */
export type ScannedFloor = {
  readonly count?: ScannedCountFloor;
  /** Display names of the fixed inputs the guard must have parsed non-empty. */
  readonly inputs?: readonly string[];
  /** Set instead of the other two: where this guard's premise is enforced. */
  readonly delegatedTo?: string;
  /** What was measured, when, and how much slack the floor leaves. */
  readonly note: string;
};

/** True when a parsed input carries something worth checking. */
export function isNonEmptyInput(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  // A number or boolean cannot be "empty" — presence is the whole question.
  return true;
}

/**
 * The `inputs` counterpart to {@link evaluateScannedFloor}: every declared
 * input must be present in what the wrapper handed over AND carry something.
 * Undeclared extras are ignored — the table names the minimum, not the maximum.
 */
export function evaluateParsedInputs(
  declared: readonly string[],
  values: Readonly<Record<string, unknown>>,
): ScannedFloorVerdict {
  if (declared.length === 0) {
    return {
      ok: false,
      failure: { code: "invalid_floor", count: 0, minimum: 0, label: "input" },
    };
  }
  for (const name of declared) {
    if (!(name in values)) {
      return {
        ok: false,
        failure: {
          code: "missing_input",
          count: 0,
          minimum: declared.length,
          label: "input",
          input: name,
        },
      };
    }
    if (!isNonEmptyInput(values[name])) {
      return {
        ok: false,
        failure: {
          code: "empty_input",
          count: 0,
          minimum: declared.length,
          label: "input",
          input: name,
        },
      };
    }
  }
  return OK;
}

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
    count: { label: "source file", minimum: 150 },
    note: "app/ + components/ + lib/ held 212 .ts/.tsx files on 2026-08-12; 150 leaves room to delete a quarter of them, but losing any one of the three scan roots drops below it.",
  },
  "check-secrets": {
    count: { label: "file", minimum: 500 },
    note: "the whole-tree walk (minus node_modules/.git/dist and non-text extensions) held 713 files on 2026-08-12; 500 survives ordinary pruning while a walk that lost __tests__/ or lib/ does not.",
  },
  "check-inline-radius": {
    count: { label: "source file", minimum: 45 },
    note: "app/ + components/ held 63 .ts/.tsx files on 2026-08-12; 45 rides above the 44 that components/ alone contributes, so losing app/ — the root that holds most of the geometry literals — fails rather than passes.",
  },
  "check-analytics-imports": {
    count: { label: "source file", minimum: 45 },
    note: "same app/ + components/ walk as check-inline-radius, 63 files on 2026-08-12; same 45 for the same reason.",
  },
  "check-clarity-input-mask": {
    count: { label: "screen file", minimum: 45 },
    note: "app/ + components/ held 62 .tsx files on 2026-08-12 (one fewer than the radius walk, which also takes .ts); 45 keeps the two floors aligned since the walks differ by a single extension.",
  },
  "check-env-inlining": {
    count: { label: "config file", minimum: 3 },
    note: "lib/*-config.ts was 5 files on 2026-08-12. The smallest floor here, and the one most worth having: the glob is a filename SUFFIX, so a single rename to lib/config-foo.ts silently drops a resolver out of the scan.",
  },
  "check-migration-docs": {
    count: { label: "migration", minimum: 18 },
    note: "supabase/migrations held 25 .sql files on 2026-08-12; migrations are append-only, so this floor only ever needs raising — a count BELOW it means the directory moved, not that migrations were deleted.",
  },
  "check-supabase-migration-naming": {
    count: { label: "migration", minimum: 18 },
    note: "the same 25-file directory read without the .sql filter on 2026-08-12; append-only for the same reason.",
  },
  "check-appstore-config": {
    inputs: ["app.json"],
    note: "reads one fixed file, so there is no count to floor. readFileSync already throws on a missing app.json; the hole is an app.json that parses to {} — every required-key check then reports its issue, which is a genuine failure, so this assertion is the cheaper and clearer one: say the input was empty instead of listing nine consequences of it.",
  },
  "check-sentry-version": {
    inputs: ["package.json", "package-lock.json"],
    note: "two fixed files, no count. Deliberately does NOT declare the resolved version strings as inputs: findSentryVersionIssues already reports a missing declaration and a missing lockfile entry in its own words, and duplicating that here would turn a legitimate 'the SDK was removed' into a premise failure.",
  },
  "generate-powerbi-schema-doc": {
    count: { label: "taxonomy event", minimum: 12 },
    inputs: ["docs/powerbi-connection.md"],
    note: "the only guard needing both shapes. ANALYTICS_EVENTS held 17 events on 2026-08-12; an empty taxonomy renders a header-only table that matches a header-only doc and reports 'up to date', which is the drift check passing precisely because there is no schema left to drift. The doc file is the fixed input beside it.",
  },
  "check-privacy-baseline-provenance": {
    delegatedTo:
      "evaluatePrivacyBaselineProvenance's `checked === 0` refusal in lib/privacy-baseline-provenance.ts",
    note: "the guard that had this instinct first, and the reason the helper exists. Listed so the registry can walk all twelve and find no silent gap; its premise stays where it is because the thing it counts (baseline entries) is the same object it validates.",
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

/** The `count` half, or a throw naming the guard that does not declare one. */
export function countFloorFor(checkName: string): ScannedCountFloor {
  const floor = scannedFloorFor(checkName);
  if (!floor.count) {
    throw new Error(
      `scanned-floor: "${checkName}" declares no count floor — it is an inputs-shaped guard.`,
    );
  }
  return floor.count;
}

/**
 * The floor assertion in the form a wrapper wants it: look the guard's own
 * floor up by name and apply it, so the wrapper never carries a bare number.
 */
export function assertScannedFloor(checkName: string, count: number): void {
  const floor = countFloorFor(checkName);
  assertScanned(checkName, count, floor.minimum, floor.label);
}

/**
 * The `inputs` counterpart to {@link assertScannedFloor}. The wrapper hands
 * over what it parsed, keyed by the same display names the table declares —
 * so a wrapper that stops reading one of them fails on `missing_input`
 * instead of quietly checking one file fewer.
 */
export function assertParsedInputs(
  checkName: string,
  values: Readonly<Record<string, unknown>>,
): void {
  const floor = scannedFloorFor(checkName);
  if (!floor.inputs) {
    throw new Error(
      `scanned-floor: "${checkName}" declares no fixed inputs — it is a count-shaped guard.`,
    );
  }
  const verdict = evaluateParsedInputs(floor.inputs, values);
  if (!verdict.ok) throw new ScannedFloorError(checkName, verdict.failure);
}
