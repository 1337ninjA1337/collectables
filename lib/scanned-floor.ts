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
  /** A declared fixed input could not be read or parsed at all. */
  | "unreadable_input"
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
  /** Set for the three input codes: which declared input went wrong. */
  readonly input?: string;
  /** Set for `unreadable_input`: what the filesystem or parser said. */
  readonly reason?: string;
  /**
   * Set for `invalid_floor` when the declaration is bogus in a way the bare
   * `minimum` cannot describe (an empty input list, a delegation that also
   * declares a count). A whole sentence, not a fragment — it REPLACES the
   * default numeric clause in the message.
   */
  readonly detail?: string;
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
const NUMERIC_FLOOR_DETAIL = (minimum: number) =>
  `floor of ${minimum} is not a positive integer — a floor below 1 passes over an empty walk, which is the failure it is supposed to catch`;

export function evaluateScannedFloor(
  count: number,
  minimum: number,
  label: string = DEFAULT_SCANNED_LABEL,
): ScannedFloorVerdict {
  if (!Number.isInteger(minimum) || minimum < 1) {
    return {
      ok: false,
      failure: { code: "invalid_floor", count, minimum, label, detail: NUMERIC_FLOOR_DETAIL(minimum) },
    };
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
  // The one code that is about the GUARD's own declaration rather than about
  // the tree, so the sentence comes from whoever spotted the bogus floor.
  invalid_floor: (f) => `${f.detail ?? NUMERIC_FLOOR_DETAIL(f.minimum)}. ${REMEASURE_HINT}`,
  missing_input: (f) =>
    `declared input "${f.input}" was never handed to the floor check — the guard says it reads it, and this run did not. ${REMEASURE_HINT}`,
  unreadable_input: (f) =>
    `declared input "${f.input}" could not be read (${f.reason ?? "no reason given"}) — the guard proves a negative about a file it never opened, and every check against it would find nothing to complain about. Check the scan root still holds it.`,
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

/**
 * What is structurally wrong with ONE {@link SCANNED_FLOORS} entry.
 *
 * These used to live as four hand-rolled loops in `__tests__/scanned-floor.test.ts`
 * — a test asserting properties of a table, next to a runtime branch in
 * `evaluateScannedFloor` asserting one of the same properties again. Two
 * copies of one contract, neither of them the table's own, and the runtime
 * half could never fire: every guard reaches its floor through
 * {@link scannedFloorFor}, which reads this table, and the table is committed
 * source. So the contract moved HERE, beside the table it is about, and both
 * the test and the lookup now read it from one place.
 *
 * A problem is reported rather than thrown so the caller decides: the test
 * lists every one of them at once, and {@link scannedFloorFor} raises the
 * first as the `invalid_floor` failure the wrapper already knows how to print.
 */
export type ScannedFloorProblemCode =
  /** Declares none of `count`, `inputs`, `delegatedTo` — a floor of nothing. */
  | "no_shape"
  /** `count.minimum` is not a positive integer. */
  | "invalid_minimum"
  /** `count.label` is blank, so the failure line would read "scanned 3 (s)". */
  | "empty_label"
  /** `inputs: []` — declared the shape and named nothing to check. */
  | "empty_inputs"
  /** A blank entry in `inputs`, which no wrapper can hand over under a name. */
  | "blank_input"
  /** The same input twice: the second is dead weight the message never names. */
  | "duplicate_input"
  /** `delegatedTo` alongside `count`/`inputs` — two premises, neither owned. */
  | "delegation_with_shape"
  /** `delegatedTo: ""` — says the premise lives elsewhere without saying where. */
  | "empty_delegation"
  /** No note, so the number is a magic constant again. */
  | "empty_note"
  /** A `count` note carrying no date — a measurement nobody can re-take. */
  | "undated_note";

export type ScannedFloorProblem = {
  /** The `SCANNED_FLOORS` key the problem is about. */
  readonly checkName: string;
  readonly code: ScannedFloorProblemCode;
  /** A whole sentence, ready to be handed to `invalid_floor`'s `detail`. */
  readonly detail: string;
};

/** Exhaustive over {@link ScannedFloorProblemCode} — a new code needs a sentence. */
const PROBLEM_DETAIL: Record<ScannedFloorProblemCode, string> = {
  no_shape:
    "declares no premise of any kind — no count to floor, no inputs to read, no delegation, which is the exact hole this table exists to close",
  invalid_minimum:
    "declares a count floor that is not a positive integer — a floor below 1 passes over an empty walk, which is the failure it is supposed to catch",
  empty_label:
    "declares a count floor with no label, so its failure line would name no noun for what it counted",
  empty_inputs:
    "declares an empty input list, so the inputs assertion passes without reading anything",
  blank_input:
    "declares a blank input name, which no wrapper can hand over and no message can name",
  duplicate_input:
    "declares the same input twice — the second copy is never reached, so a wrapper could drop it unnoticed",
  delegation_with_shape:
    "delegates its premise elsewhere AND declares a count or inputs here, so two places claim to own one check and neither is authoritative",
  empty_delegation:
    "delegates its premise without saying where, which is indistinguishable from opting out",
  empty_note:
    "carries no note, so its shape is a decision with no recorded reason",
  undated_note:
    "carries a count floor whose note names no date — an undated measurement is a magic constant with prose around it",
};

/**
 * The sentence this table gives one problem code.
 *
 * `PROBLEM_DETAIL` stays private — it is a record a caller could iterate and
 * reformat — but the sentences themselves are what guards print, so a test
 * asserting what a refusal SAYS should read them from here rather than re-type
 * a fragment. A hand-copied clause drifts silently the first time a sentence
 * is reworded, and turns into a failing assertion in a file that has nothing
 * to do with the rewording.
 */
export function scannedFloorProblemDetail(
  code: ScannedFloorProblemCode,
): string {
  return PROBLEM_DETAIL[code];
}

const MEASUREMENT_DATE = /\d{4}-\d{2}-\d{2}/;

/** The structural problems with one entry, in declaration order. Empty when sound. */
export function validateScannedFloorEntry(
  checkName: string,
  floor: ScannedFloor,
): readonly ScannedFloorProblem[] {
  const problems: ScannedFloorProblem[] = [];
  const add = (code: ScannedFloorProblemCode) =>
    problems.push({ checkName, code, detail: PROBLEM_DETAIL[code] });

  if (!floor.count && !floor.inputs && !floor.delegatedTo) add("no_shape");
  if (floor.delegatedTo !== undefined) {
    if (floor.delegatedTo.trim().length === 0) add("empty_delegation");
    if (floor.count || floor.inputs) add("delegation_with_shape");
  }
  if (floor.count) {
    if (!Number.isInteger(floor.count.minimum) || floor.count.minimum < 1) {
      add("invalid_minimum");
    }
    if (floor.count.label.trim().length === 0) add("empty_label");
  }
  if (floor.inputs) {
    if (floor.inputs.length === 0) add("empty_inputs");
    if (floor.inputs.some((input) => input.trim().length === 0)) add("blank_input");
    if (new Set(floor.inputs).size !== floor.inputs.length) add("duplicate_input");
  }
  if (floor.note.trim().length === 0) add("empty_note");
  else if (floor.count && !MEASUREMENT_DATE.test(floor.note)) add("undated_note");

  return problems;
}

/** Every entry's problems, flattened. Empty means the whole table is sound. */
export function validateScannedFloors(
  table: Readonly<Record<string, ScannedFloor>>,
): readonly ScannedFloorProblem[] {
  return Object.entries(table).flatMap(([checkName, floor]) =>
    validateScannedFloorEntry(checkName, floor),
  );
}

/** One line per problem, prefixed with the entry it is about. */
export function formatScannedFloorProblem(problem: ScannedFloorProblem): string {
  return `${problem.checkName} ${problem.detail}`;
}

/**
 * What a wrapper hands over for an input it tried to read and could not.
 *
 * Without it the two failures collapse: a wrapper that drops the key reports
 * `missing_input` ("this run did not read it"), which is also what an absent
 * FILE would produce, and the reader cannot tell a wiring bug from a moved
 * file. With it, the message names the errno.
 */
export type UnreadableInput = {
  readonly unreadableInput: true;
  /** Errno, parser message — whatever the wrapper caught. */
  readonly reason: string;
};

/** Marker constructor; see {@link UnreadableInput}. */
export function unreadableInput(reason: string): UnreadableInput {
  return { unreadableInput: true, reason };
}

export function isUnreadableInput(value: unknown): value is UnreadableInput {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { unreadableInput?: unknown }).unreadableInput === true
  );
}

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
      failure: {
        code: "invalid_floor",
        count: 0,
        minimum: 0,
        label: "input",
        // The table path can no longer reach this — `scannedFloorFor` rejects
        // an `inputs: []` entry first — so the subject here is whoever called
        // the pure function with a list of nothing.
        detail: `the caller ${PROBLEM_DETAIL.empty_inputs}`,
      },
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
    const value = values[name];
    if (isUnreadableInput(value)) {
      return {
        ok: false,
        failure: {
          code: "unreadable_input",
          count: 0,
          minimum: declared.length,
          label: "input",
          input: name,
          reason: value.reason,
        },
      };
    }
    if (!isNonEmptyInput(value)) {
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
    count: { label: "source file", minimum: 160 },
    note: "app/ + components/ + lib/ held 213 .ts/.tsx files on 2026-08-12 (app 19, components 44, lib 150); 160 leaves a quarter of them deletable. Raised from 150, which was exactly lib/'s own count — a walk that lost BOTH app/ and components/ passed at the boundary, and the note here claimed it would not. The property __tests__/lint-guard-partial-root.test.ts now enforces is the one a floor can hold: no single scan root clears it on its own. Losing app/ or components/ alone still passes, and that is the price of the slack.",
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
    inputs: ["MANUAL-TASKS.md"],
    note: "supabase/migrations held 25 .sql files on 2026-08-12; migrations are append-only, so this floor only ever needs raising — a count BELOW it means the directory moved, not that migrations were deleted. MANUAL-TASKS.md is the other half of the comparison: an empty one makes every migration undocumented (a loud, correct failure), and an unreadable one used to be an ENOENT stack.",
  },
  "check-supabase-migration-naming": {
    count: { label: "migration", minimum: 18 },
    inputs: ["MANUAL-TASKS.md"],
    note: "the same 25-file directory read without the .sql filter on 2026-08-12; append-only for the same reason. Same MANUAL-TASKS.md input as check-migration-docs, for the same reason.",
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

/**
 * Throws if `checkName` has no committed floor — a guard cannot opt out
 * silently — or if the floor it does have is structurally unusable.
 *
 * The second half is why `invalid_floor` is not dead code. Every guard reads
 * its floor through here, so a bogus entry is caught on the guard's own run,
 * inside the `try` its wrapper already wraps `main()` in, and printed as the
 * same one-line refusal as any other floor failure — rather than sailing past
 * as a floor of 0 that greenlights an empty walk. It is thrown as a
 * {@link ScannedFloorError} for exactly that reason: the wrapper catches that
 * type and exits 1 without a stack trace.
 */
export function scannedFloorFor(checkName: string): ScannedFloor {
  const floor = SCANNED_FLOORS[checkName];
  if (!floor) {
    throw new Error(
      `scanned-floor: no committed floor for "${checkName}" — add one to SCANNED_FLOORS in lib/scanned-floor.ts.`,
    );
  }
  const [problem] = validateScannedFloorEntry(checkName, floor);
  if (problem) {
    throw new ScannedFloorError(checkName, {
      code: "invalid_floor",
      count: 0,
      minimum: floor.count?.minimum ?? 0,
      label: floor.count?.label ?? DEFAULT_SCANNED_LABEL,
      detail: `its SCANNED_FLOORS entry ${problem.detail}`,
    });
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
