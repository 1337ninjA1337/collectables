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
 * version of the failure; ONE file is the quiet version. So each guard commits
 * a MEASURED minimum — a fact about the current tree with slack under it, in
 * the same spirit as `PRIVACY_BODY_BASELINES` — rather than a magic constant.
 * When a floor legitimately stops matching the tree, the fix is to re-measure
 * and say so in the commit, which is the point: the number only moves
 * deliberately.
 *
 * There are TWO quiet failures, and only one of them is a count.
 *
 * A walk that lost `app/` but kept `lib/` reports a comfortable-looking
 * number, and that used to be the count floor's job too — carried by
 * arithmetic, since a minimum sitting above the largest single root cannot be
 * cleared by any one root alone. It worked, and it needed re-measuring every
 * time the tree grew past it: five times, twice in one afternoon from one new
 * component, each arriving in a suite unrelated to whatever added the file.
 * That property now belongs to {@link ScannedCountFloor.roots} and
 * {@link evaluateScannedRoots}, which say it directly — every declared root
 * contributed — with no number to go stale.
 *
 * What the count still owns is the walk that came back implausibly SMALL with
 * every root present: a narrowed glob, an extension filter that stopped
 * matching, a widened skip list. No per-root check can see that, and no
 * per-root check should — it is a question about the size of the result, which
 * is what a floor is. The two assertions sit side by side in each multi-root
 * wrapper, roots first, because when both fire only one of them names the
 * directory that went quiet.
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
  | "empty_input"
  /**
   * The guard asked for a floor and {@link SCANNED_FLOORS} has no entry under
   * its name at all — the likeliest of these three after a rename, and the one
   * that used to arrive as a bare `Error` with a node stack.
   */
  | "no_floor_declared"
  /** The entry exists and is not count-shaped, but the wrapper asked for one. */
  | "no_count_floor"
  /** The entry exists and declares no fixed inputs, but the wrapper asked for them. */
  | "no_inputs_floor"
  /**
   * A declared scan root contributed no files to the walk.
   *
   * The property a multi-root floor has always been trying to state, said
   * directly instead of by arithmetic. `below_floor` catches a root going
   * missing only while the committed minimum happens to sit above the largest
   * REMAINING root — which is why that number has had to be re-measured five
   * times as the tree grew, in a suite unrelated to whatever added the file.
   * This code has no number in it and never needs re-measuring.
   */
  | "no_root_files"
  /** The entry exists and names no scan roots, but the wrapper handed some over. */
  | "no_roots_floor";

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
  /** Set for `no_root_files`: which declared scan root turned up nothing. */
  readonly root?: string;
  /** Set for `unreadable_input`: what the filesystem or parser said. */
  readonly reason?: string;
  /**
   * Set for `invalid_floor` when the declaration is bogus in a way the bare
   * `minimum` cannot describe (an empty input list, a delegation that also
   * declares a count).
   *
   * This used to be a rendered SENTENCE, which meant the words a guard printed
   * for `invalid_floor` were chosen by whichever of three call sites built the
   * failure — the one code in the table whose message came from outside
   * {@link FAILURE_MESSAGE}. It is two enums now: WHICH structural problem and
   * WHO it is about. Both are rendered here, so the failure carries facts and
   * this module still owns every word.
   */
  readonly problem?: ScannedFloorProblemRef;
};

export type ScannedFloorVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: ScannedFloorFailure };

const OK: ScannedFloorVerdict = { ok: true };

/** Default noun when a caller does not name what it counted. */
export const DEFAULT_SCANNED_LABEL = "file";

/**
 * Why a floor below 1 is a bug and not a lenient setting. Said by two
 * sentences that are otherwise unrelated — the runtime failure
 * ({@link NUMERIC_FLOOR_DETAIL}, about a number a caller passed) and the table
 * problem (`invalid_minimum`, about a number an entry declares) — so it lives
 * in one place rather than being typed twice and reworded once.
 *
 * Exported for the test that requires both messages to carry it: recovering
 * the clause by slicing one of them on its em-dash would be an assertion about
 * punctuation, and it would go quiet the day either sentence grew a second
 * dash.
 */
export const FLOOR_BELOW_ONE_REASON =
  "a floor below 1 passes over an empty walk, which is the failure it is supposed to catch";

/**
 * A minimum below 1 is a bug in the CALLER, not a finding about the tree: a
 * floor of 0 passes over an empty walk, which is the exact hole this module
 * exists to close, and it would do it while looking like the hole was
 * covered. It is reported as its own failure code rather than thrown so the
 * message can name the guard alongside the other two.
 *
 * The one `invalid_floor` sentence that is NOT about a {@link SCANNED_FLOORS}
 * entry: the number came straight from a caller, so there is no entry to send
 * the reader to and no problem code that fits — the message quotes the number
 * instead. That is why {@link ScannedFloorFailure.problem} is optional: a
 * failure either names a structural problem or reports this bare number, never
 * both, and never neither.
 */
const NUMERIC_FLOOR_DETAIL = (minimum: number) =>
  `floor of ${minimum} is not a positive integer — ${FLOOR_BELOW_ONE_REASON}`;

/**
 * Why a wrapper asking for a shape its entry does not declare is a wiring bug
 * rather than a guard with nothing to check. Said by the two sentences that
 * report it — `no_count_floor` and `no_inputs_floor`, one per direction of the
 * same disagreement — so the reason lives in one place instead of being typed
 * twice and reworded once, the same treatment {@link FLOOR_BELOW_ONE_REASON}
 * gets one table over.
 *
 * Exported for the test that requires both messages to carry it: recovering the
 * clause by slicing either sentence would be an assertion about punctuation.
 */
export const SHAPE_MISMATCH_REASON =
  "the wrapper and the table disagree about which shape this guard's premise has, so the assertion it just made has nothing in the entry to apply to";

export function evaluateScannedFloor(
  count: number,
  minimum: number,
  label: string = DEFAULT_SCANNED_LABEL,
): ScannedFloorVerdict {
  if (!Number.isInteger(minimum) || minimum < 1) {
    return {
      ok: false,
      failure: { code: "invalid_floor", count, minimum, label },
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

/**
 * Whether every declared scan root actually contributed to the walk.
 *
 * The direct form of what a multi-root count floor approximates. A file is
 * attributed to the root it sits under, matched on a path SEGMENT boundary so
 * that `app/` does not claim `apple/`, and a root that ends up with nothing is
 * reported by name.
 *
 * Deliberately not a count: "at least one file" is the whole claim, because
 * the failure this defends against is a root that stopped being walked at all
 * — a deleted directory, a `SCANNED_DIRS` typo, a glob that silently resolved
 * to nothing. A root that legitimately holds one file is a root the guard is
 * reading, and a floor that demanded more of it would be a second measured
 * number needing its own note.
 *
 * Pure and separate from {@link evaluateScannedFloor} on purpose: the two
 * answer different questions about the same walk — "is this enough files" and
 * "did every root turn up" — and a walk can fail either without the other
 * noticing. Reports the FIRST empty root in declared order rather than all of
 * them, matching how `scannedFloorFor` raises the first problem: a guard that
 * lost two roots has one thing wrong with it.
 *
 * Throws on an empty `roots`, for the reason every other emptiness in this
 * module is refused rather than defaulted: a per-root check over no roots
 * passes over anything at all, which is the vacuous pass the file exists to
 * close.
 */
export function evaluateScannedRoots(
  files: readonly string[],
  roots: readonly string[],
  label: string = DEFAULT_SCANNED_LABEL,
): ScannedFloorVerdict {
  if (roots.length === 0) {
    throw new Error(
      "a per-root check over no scan roots passes over any walk, which is the failure it exists to catch",
    );
  }
  for (const root of roots) {
    // Segment boundary, not `startsWith(root)`: `app` must not be satisfied by
    // `apple/foo.ts`, and a walk whose only "app" file was under a
    // similarly-named sibling is exactly the silent miss this is for.
    const prefix = `${root}/`;
    const found = files.filter((file) => file === root || file.startsWith(prefix)).length;
    if (found === 0) {
      return {
        ok: false,
        failure: { code: "no_root_files", count: files.length, minimum: 1, label, root },
      };
    }
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
  // The one code that is about a DECLARATION rather than about the tree. Both
  // branches render here, from the failure's own fields, like the other five:
  // a structural problem when the failure names one, the bare number when the
  // minimum itself is what a caller got wrong.
  invalid_floor: (f) =>
    `${f.problem ? describeScannedFloorProblemRef(f.problem) : NUMERIC_FLOOR_DETAIL(f.minimum)}. ${REMEASURE_HINT}`,
  missing_input: (f) =>
    `declared input "${f.input}" was never handed to the floor check — the guard says it reads it, and this run did not. ${REMEASURE_HINT}`,
  unreadable_input: (f) =>
    `declared input "${f.input}" could not be read (${f.reason ?? "no reason given"}) — the guard proves a negative about a file it never opened, and every check against it would find nothing to complain about. Check the scan root still holds it.`,
  empty_input: (f) =>
    `input "${f.input}" is empty — it was read, so nothing crashed, and every check against it then found nothing to complain about. That is not a pass.`,
  // The three "this guard's premise is not usable" codes. They are about the
  // LOOKUP rather than about a declaration or a tree: the entry is absent, or
  // it is present and shaped unlike what the wrapper asked for. Each was a bare
  // `Error` until this table learned to say it, which meant the reader got a
  // node stack for the same class of failure the other six print in one line.
  no_floor_declared: () =>
    `no committed floor — this guard has no SCANNED_FLOORS entry in lib/scanned-floor.ts, so nothing says what a complete run of it looks like and the negative it proves is over however many files it happened to find. Add an entry keyed by this name: a guard cannot opt out of its own premise by being absent from the table.`,
  no_count_floor: () =>
    `asked for a count floor and its SCANNED_FLOORS entry declares none — ${SHAPE_MISMATCH_REASON}. Either this wrapper wants assertParsedInputs, or the entry in lib/scanned-floor.ts is missing its count.`,
  no_inputs_floor: () =>
    `asked for its declared inputs and its SCANNED_FLOORS entry declares none — ${SHAPE_MISMATCH_REASON}. Either this wrapper wants assertScannedFloor, or the entry in lib/scanned-floor.ts is missing its inputs.`,
  no_roots_floor: () =>
    `handed over its walked files for a per-root check and its SCANNED_FLOORS entry names no roots — ${SHAPE_MISMATCH_REASON}. Either this wrapper walks one root and wants assertScannedFloor alone, or the entry in lib/scanned-floor.ts is missing its roots.`,
  // About the tree, like `no_files` and `below_floor`, and the only one of the
  // three that names WHICH part of the walk went quiet. Deliberately says
  // nothing about re-measuring: there is no number here to move, which is the
  // entire reason this code exists beside `below_floor`.
  no_root_files: (f) =>
    `scan root ${f.root ?? "(unnamed)"}/ contributed 0 of the ${f.count} ${f.label}(s) this walk found — every other root is still there, so the count looks healthy and this guard proved its negative over a tree with a hole in it. Check that ${f.root ?? "the root"}/ still exists, is readable, and is spelled the same way in the wrapper's SCANNED_DIRS as in lib/scanned-floor.ts.`,
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
  /**
   * The directories the walk covers, when it covers more than one.
   *
   * Optional because a single-root walk has nothing to say here: its floor and
   * its root are the same claim, and `no_files` already covers the root
   * vanishing. A MULTI-root walk is the case where the count alone cannot
   * state the property — `app/` disappearing while `lib/` keeps 168 files
   * leaves a comfortable-looking number — and where the arithmetic standing in
   * for it (`minimum > largestRoot`, enforced in
   * `__tests__/lint-guard-partial-root.test.ts`) has needed re-measuring every
   * time the tree grew.
   *
   * Naming the roots lets {@link evaluateScannedRoots} say it with no number
   * at all: every declared root contributed at least one file. Paths are
   * repo-relative and must match the `SCANNED_DIRS` the wrapper walks, which
   * `__tests__/floor-walks.test.ts` pins for every row that declares them.
   */
  readonly roots?: readonly string[];
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
  /**
   * The entry's own KEY is blank — the one problem about the name rather than
   * the declaration under it. A blank key is invisible from every other angle:
   * the shape checks below all pass, `formatScannedFloorProblem` renders the
   * key as the sentence's subject, and the reader gets a line that starts with
   * a space where the guard's name should be.
   */
  | "empty_check_name"
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
  /** `roots: []` — declared the per-root shape and named no roots to check. */
  | "empty_roots"
  /** A blank entry in `roots`, which would match every file in the walk. */
  | "blank_root"
  /** The same root twice: the second is a check that can never fail on its own. */
  | "duplicate_root"
  /** No note, so the number is a magic constant again. */
  | "empty_note"
  /** A `count` note carrying no date — a measurement nobody can re-take. */
  | "undated_note";

/**
 * WHICH entry is wrong and HOW — and deliberately not the words for it.
 *
 * This used to carry a `detail` string as well, always filled from
 * `scannedFloorProblemDetail(code)` by the one producer. That made the object
 * capable of lying: a problem built by hand could carry any sentence in the
 * field, and every renderer would ignore it, because they all derive the words
 * from `code`. A caller that wants the clause asks
 * {@link scannedFloorProblemDetail}; a caller that wants a whole sentence asks
 * {@link describeScannedFloorProblem}. Neither is a copy of the other.
 */
export type ScannedFloorProblem = {
  /** The `SCANNED_FLOORS` key the problem is about. */
  readonly checkName: string;
  readonly code: ScannedFloorProblemCode;
};

/** Exhaustive over {@link ScannedFloorProblemCode} — a new code needs a sentence. */
const PROBLEM_DETAIL: Record<ScannedFloorProblemCode, string> = {
  empty_check_name:
    "is keyed by a blank name, so no wrapper can look its floor up and every sentence about it opens with a space where the guard's name belongs",
  no_shape:
    "declares no premise of any kind — no count to floor, no inputs to read, no delegation, which is the exact hole this table exists to close",
  invalid_minimum: `declares a count floor that is not a positive integer — ${FLOOR_BELOW_ONE_REASON}`,
  empty_label:
    "declares a count floor with no label, so its failure line would name no noun for what it counted",
  empty_inputs:
    "declares an empty input list, so the inputs assertion passes without reading anything",
  blank_input:
    "declares a blank input name, which no wrapper can hand over and no message can name",
  duplicate_input:
    "declares the same input twice — the second copy is never reached, so a wrapper could drop it unnoticed",
  empty_roots:
    "declares an empty scan-root list, so the per-root assertion passes over any walk at all — including the walk that lost every root it was written to notice",
  blank_root:
    "declares a blank scan root, and every path in a walk starts with the empty string, so that entry is satisfied by any file and reports nothing about any directory",
  duplicate_root:
    "declares the same scan root twice — the second copy can only pass when the first already did, so it is a check that cannot fail on its own",
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
 *
 * This is the raw clause — a predicate with no subject, so it composes with
 * whichever subject the caller is talking about. Anything printing a whole
 * sentence should go through {@link describeScannedFloorProblem} instead; this
 * accessor exists for the assertions that want to match a substring of one.
 */
export function scannedFloorProblemDetail(
  code: ScannedFloorProblemCode,
): string {
  return PROBLEM_DETAIL[code];
}

/**
 * The subject {@link scannedFloorFor} speaks about: the guard's own row in
 * {@link SCANNED_FLOORS}, not the tree it was pointed at. Exported so a test
 * asserting the refusal can name the subject the guard actually uses rather
 * than re-typing the phrase and drifting from it.
 */
export const SCANNED_FLOORS_ENTRY_SUBJECT = "its SCANNED_FLOORS entry";

/**
 * The subject {@link evaluateParsedInputs} speaks about when it is handed a
 * declared-input list of nothing. Deliberately NOT the entry subject: the
 * table path cannot reach that branch (`scannedFloorFor` rejects an
 * `inputs: []` entry first), so the only way in is a direct call to the pure
 * function, and pointing that reader at the table would send them to look at
 * a row that is fine.
 */
export const PARSED_INPUTS_CALLER_SUBJECT = "the caller";

/**
 * WHO a reported problem is about, as an id rather than as its words.
 *
 * A {@link ScannedFloorFailure} travels from the pure function that found the
 * problem to the wrapper that prints it, and along the way it must not be able
 * to carry a sentence nobody in this module wrote. The subject is the only
 * part that genuinely varies between producers, so it crosses that gap as one
 * of two ids and is turned into words here.
 */
export type ScannedFloorProblemSubject =
  /** The guard's own row in {@link SCANNED_FLOORS}. */
  | "entry"
  /** Whoever called a pure function directly with an unusable argument. */
  | "caller";

/** WHICH problem and WHO it is about — two enums, no prose. */
export type ScannedFloorProblemRef = {
  readonly subject: ScannedFloorProblemSubject;
  readonly code: ScannedFloorProblemCode;
};

/** Exhaustive over {@link ScannedFloorProblemSubject} — a new subject needs words. */
const PROBLEM_SUBJECT: Record<ScannedFloorProblemSubject, string> = {
  entry: SCANNED_FLOORS_ENTRY_SUBJECT,
  caller: PARSED_INPUTS_CALLER_SUBJECT,
};

/**
 * The words for a subject id. Kept as the single reader of
 * {@link PROBLEM_SUBJECT}, for the same reason
 * {@link scannedFloorProblemDetail} is the single reader of the sentence
 * table: a second reader is a second phrasing waiting to happen.
 */
export function scannedFloorProblemSubject(
  subject: ScannedFloorProblemSubject,
): string {
  return PROBLEM_SUBJECT[subject];
}

/**
 * One whole sentence about one problem, attributed to whoever it is about.
 *
 * The ONE place a subject and the table's clause are joined. Three call sites
 * used to build this string themselves — `formatScannedFloorProblem` with the
 * check name, `scannedFloorFor` with the entry, `evaluateParsedInputs` with
 * the caller — which is three ways to phrase one problem, drifting apart the
 * first time any of them is reworded and impossible to assert against as a
 * group. The subject is what genuinely varies; the clause never does.
 *
 * `subject` is a bare string rather than a {@link ScannedFloorProblemSubject}
 * because one of the three call sites passes a `SCANNED_FLOORS` key, which is
 * not one of the two travelling ids. A BLANK subject would render a sentence
 * with a missing first word; that is not defended here but at the source —
 * {@link validateScannedFloorEntry} reports `empty_check_name` for the one
 * input that could produce it.
 */
export function describeScannedFloorProblem(
  subject: string,
  code: ScannedFloorProblemCode,
): string {
  return `${subject} ${scannedFloorProblemDetail(code)}`;
}

/**
 * The same sentence, for a problem that travelled on a failure: the id is
 * resolved to its words and joined by {@link describeScannedFloorProblem}, so
 * a failure rendered by a wrapper and a problem listed by a test say the same
 * thing about the same code.
 */
export function describeScannedFloorProblemRef(
  ref: ScannedFloorProblemRef,
): string {
  return describeScannedFloorProblem(
    scannedFloorProblemSubject(ref.subject),
    ref.code,
  );
}

const MEASUREMENT_DATE = /\d{4}-\d{2}-\d{2}/;

/** The structural problems with one entry, in declaration order. Empty when sound. */
export function validateScannedFloorEntry(
  checkName: string,
  floor: ScannedFloor,
): readonly ScannedFloorProblem[] {
  const problems: ScannedFloorProblem[] = [];
  const add = (code: ScannedFloorProblemCode) => problems.push({ checkName, code });

  // First, because it is the only check about the entry's NAME: every problem
  // below is rendered as a sentence whose subject is that name, so a blank one
  // turns each of them into a line with a missing first word. Caught here, at
  // the source, rather than left for a renderer to paper over.
  if (checkName.trim().length === 0) add("empty_check_name");
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
    // Same three shape checks `inputs` gets below, for the same reasons: a
    // declared-and-empty list is the shape claimed and nothing checked, and a
    // blank entry is worse than a missing one — `""` makes every path in the
    // walk start with it, so the root check passes on any non-empty walk.
    if (floor.count.roots) {
      if (floor.count.roots.length === 0) add("empty_roots");
      if (floor.count.roots.some((root) => root.trim().length === 0)) add("blank_root");
      if (new Set(floor.count.roots).size !== floor.count.roots.length) add("duplicate_root");
    }
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

/**
 * One line per problem, attributed to the entry it is about.
 *
 * Kept at arity one on purpose rather than growing an optional `subject`
 * parameter: this is the shape `validateScannedFloors(...).map(...)` wants,
 * and a second parameter there would silently receive the array INDEX. A
 * caller with a different subject calls {@link describeScannedFloorProblem}.
 */
export function formatScannedFloorProblem(problem: ScannedFloorProblem): string {
  return describeScannedFloorProblem(problem.checkName, problem.code);
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
        problem: { subject: "caller", code: "empty_inputs" },
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
    count: { label: "source file", minimum: 174, roots: ["app", "components", "lib"] },
    note: "app/ + components/ + lib/ held 233 .ts/.tsx files on 2026-08-21 (app 19, components 46, lib 168); 174 leaves 25% of them deletable. What this number is FOR changed on 2026-08-21 and the number did not: the no-single-root property moved to `roots` below, which the guard asserts directly, so this floor no longer has to ride above lib/'s 168 and no longer needs re-measuring when a root grows past it. It still catches the other failure — a walk that came back implausibly small with every root present (a narrowed glob, a broken extension filter, a widened skip list) — which a per-root check cannot see. Re-measure it only when the walk's TOTAL has drifted far from it; `npm run remeasure-floors` prints the breakdown and suggests 174.",
  },
  "check-secrets": {
    count: { label: "file", minimum: 500 },
    note: "the whole-tree walk (minus node_modules/.git/dist and non-text extensions) held 713 files on 2026-08-12; 500 survives ordinary pruning while a walk that lost __tests__/ or lib/ does not.",
  },
  "check-inline-radius": {
    count: { label: "source file", minimum: 48, roots: ["app", "components"] },
    note: "app/ + components/ held 65 .ts/.tsx files on 2026-08-21; 48 leaves 26% deletable. First entry to declare `roots`, on 2026-08-21, after its floor had been re-measured twice in one afternoon because <RelationshipActionRow> made components/ a 46th file and drew level with it. That comparison is gone: the guard asserts every declared root contributed, so a lost app/ refuses by name whatever this number is. The number's remaining job is the walk that shrank without losing a root.",
  },
  "check-analytics-imports": {
    count: { label: "source file", minimum: 48, roots: ["app", "components"] },
    note: "same app/ + components/ walk as check-inline-radius, 65 files on 2026-08-21; same 48 for the same reason, and it declares the same roots. Aligned deliberately, as before — but the alignment now costs nothing to keep, since neither number moves when a root grows.",
  },
  "check-profile-id-pii": {
    count: { label: "source file", minimum: 200 },
    note: "app/ + components/ + data/ + lib/ + scripts/ held 264 .ts/.tsx files on 2026-08-21; the same walk check-orphan-i18n-keys takes minus its one exclusion, so it carries the same 200 for the same reason — it rides above the 165 that lib/ alone contributes, and lib/ is where every profile-shaping function lives. A walk that had quietly lost lib/ would report a clean tree while reading none of the code this rule is about.",
  },
  "check-orphan-i18n-keys": {
    count: { label: "source file", minimum: 200 },
    note: "app/ + components/ + data/ + lib/ + scripts/ held 262 .ts/.tsx files on 2026-08-21, minus lib/i18n-context.tsx itself (which declares every key, so counting it would make every key read) = 261. 200 rides above the 163 that lib/ alone contributes, so no single root clears this floor on its own — the property matters more here than for most, because a key's only reader is often a TABLE in lib/ rather than a `t()` call in a screen, and a walk that had quietly lost app/ would report those keys live while missing every orphan a screen used to render.",
  },
  "check-problem-phrasing-imports": {
    count: { label: "source file", minimum: 535, roots: ["app", "components", "lib", "scripts", "__tests__"] },
    note: "app/ + components/ + lib/ + scripts/ + __tests__/ held 716 .ts/.tsx files on 2026-08-21 (app 19, components 46, lib 168, scripts 32, tests 451); 535 leaves 25% deletable. It used to have to ride above the 451 that __tests__/ alone contributes, which made it the entry likeliest to need re-measuring next — 96% of the way there at one point. `roots` holds that property now, asserted by the guard rather than by this number, and what is left is a plausibility check on the total.",
  },
  "check-a11y-jsx": {
    count: { label: "screen file", minimum: 48, roots: ["app", "components"] },
    note: "app/ + components/ held 64 .tsx files on 2026-08-21 — the same walk check-clarity-input-mask takes, so it carries the same 48. Aligned deliberately: two floors over one walk that disagreed would be two numbers to think about for one event. Since 2026-08-21 both declare their roots, so neither moves when a root grows and the alignment is stable by default rather than by maintenance.",
  },
  "check-clarity-input-mask": {
    count: { label: "screen file", minimum: 48, roots: ["app", "components"] },
    note: "app/ + components/ held 64 .tsx files on 2026-08-21 (one fewer than the radius walk, which also takes .ts); 48 keeps the two floors aligned since the walks differ by a single extension. It no longer needs to ride above components/'s 45 — `roots` holds that property — so the alignment is a readability choice rather than a second number to re-measure.",
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
 * A failure about the LOOKUP rather than about a walk: there is no count and
 * no minimum to report, because the entry that would have named them is
 * missing or shaped otherwise. The numeric fields are zero and the messages for
 * these three codes read none of them — they are here because
 * {@link ScannedFloorFailure} is one flat type, and giving them made-up values
 * would be worse than giving them empty ones.
 */
function lookupFailure(code: ScannedFloorFailureCode): ScannedFloorFailure {
  return { code, count: 0, minimum: 0, label: DEFAULT_SCANNED_LABEL };
}

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
 *
 * So is the FIRST half, now. A missing entry used to be a bare `Error`, which
 * the wrapper's handler does not recognise and re-throws: no `ERROR —` prefix,
 * no check-name head, and a node stack, for the failure a rename produces most
 * often. Both halves are the same thing from the reader's side — this guard's
 * premise is not usable — so both print alike.
 */
export function scannedFloorFor(checkName: string): ScannedFloor {
  const floor = SCANNED_FLOORS[checkName];
  if (!floor) throw new ScannedFloorError(checkName, lookupFailure("no_floor_declared"));
  const [problem] = validateScannedFloorEntry(checkName, floor);
  if (problem) {
    throw new ScannedFloorError(checkName, {
      code: "invalid_floor",
      count: 0,
      minimum: floor.count?.minimum ?? 0,
      label: floor.count?.label ?? DEFAULT_SCANNED_LABEL,
      problem: { subject: "entry", code: problem.code },
    });
  }
  return floor;
}

/**
 * The `count` half, or a {@link ScannedFloorError} naming the guard that does
 * not declare one — a wrapper asking for a shape its entry does not have is a
 * wiring mistake, and it is printed as one line like every other unusable
 * premise rather than as a stack.
 */
export function countFloorFor(checkName: string): ScannedCountFloor {
  const floor = scannedFloorFor(checkName);
  if (!floor.count) throw new ScannedFloorError(checkName, lookupFailure("no_count_floor"));
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
 * The per-root counterpart to {@link assertScannedFloor}, for the walks that
 * cover more than one directory.
 *
 * The wrapper hands over the file list it just walked instead of its length,
 * because the length is exactly what cannot answer this question: a walk that
 * lost `app/` and kept `lib/` has a healthy count and a hole in it. Called
 * ALONGSIDE the count assertion rather than instead of it — the two catch
 * different failures, and a walk can fail either while passing the other. A
 * glob that broke without emptying a root still trips `below_floor`; a root
 * that vanished entirely trips this, whatever the committed minimum happens to
 * be this month.
 *
 * That last clause is the point. The property "no single scan root clears this
 * floor alone" has been enforced since the floors were written, as arithmetic
 * (`minimum > largestRoot`) in a suite that has to be re-measured every time
 * the tree grows — five times so far, twice in one afternoon from a single new
 * component, always in a suite unrelated to the change that caused it. Stated
 * here there is no number to move.
 */
export function assertScannedRoots(checkName: string, files: readonly string[]): void {
  const floor = countFloorFor(checkName);
  if (!floor.roots) throw new ScannedFloorError(checkName, lookupFailure("no_roots_floor"));
  const verdict = evaluateScannedRoots(files, floor.roots, floor.label);
  if (!verdict.ok) throw new ScannedFloorError(checkName, verdict.failure);
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
  if (!floor.inputs) throw new ScannedFloorError(checkName, lookupFailure("no_inputs_floor"));
  const verdict = evaluateParsedInputs(floor.inputs, values);
  if (!verdict.ok) throw new ScannedFloorError(checkName, verdict.failure);
}
