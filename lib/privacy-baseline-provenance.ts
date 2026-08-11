/**
 * Pure half of the "a baseline may not change quietly" guard — the git half
 * lives in `scripts/check-privacy-baseline-provenance.ts`.
 *
 * Two checks with different inputs, deliberately kept in one report:
 *
 *   1. SHAPE, from the working tree alone. Every entry carries a real date and
 *      a note long enough to have said something. Always runs, needs no
 *      history, and is what stops the convention decaying into `note: "fix"`.
 *   2. DRIFT, against the same table one revision back. A `words` value that
 *      moved must move its `recordedOn` and `note` with it, must name the count
 *      it replaced, and must come with a change to the policy file it claims to
 *      describe. Runs only when a previous revision is readable — see
 *      {@link parsePrivacyBodyBaselines} for why null is a skip and not a
 *      failure.
 *
 * The drift half cannot tell a truncating merge from an amendment; nothing can,
 * because both edit the file and both change the count. It forces the diff to
 * SAY which one it is, in the commit that does it, next to the number. That is
 * a reviewability guarantee rather than a correctness one, and it is the only
 * kind available here.
 */

import {
  privacyPolicySourcePath,
  type PrivacyBodyBaseline,
} from "./privacy-body-baselines";

export type BaselineProvenanceFailureCode =
  | "malformed_date"
  | "note_too_short"
  | "non_positive_words"
  | "policy_unchanged"
  | "provenance_unchanged"
  | "provenance_date_regressed"
  | "note_omits_previous_words";

export type BaselineProvenanceFailure = {
  /** Language code whose entry is at fault. */
  readonly language: string;
  readonly code: BaselineProvenanceFailureCode;
  /** What was measured or read; spliced into the message. */
  readonly detail?: string;
};

/**
 * A note has to be a sentence, not a shrug.
 *
 * Five words is low enough that no honest note trips it and high enough that
 * `note: "updated"` — the shape the whole convention exists to prevent — does.
 * Counted in words rather than characters so a long single token cannot buy its
 * way past.
 */
export const PRIVACY_BASELINE_NOTE_MIN_WORDS = 5;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function noteWordCount(note: string): number {
  return note.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Well-formedness of the table as it stands, independent of any history.
 *
 * Returned in the table's own key order so the report reads like the file.
 */
export function evaluatePrivacyBaselineShape(
  baselines: Readonly<Record<string, PrivacyBodyBaseline>>,
): readonly BaselineProvenanceFailure[] {
  const failures: BaselineProvenanceFailure[] = [];
  for (const [language, baseline] of Object.entries(baselines)) {
    if (!Number.isInteger(baseline.words) || baseline.words <= 0) {
      failures.push({
        language,
        code: "non_positive_words",
        detail: JSON.stringify(baseline.words),
      });
    }
    if (!ISO_DATE.test(baseline.recordedOn)) {
      failures.push({
        language,
        code: "malformed_date",
        detail: JSON.stringify(baseline.recordedOn),
      });
    }
    const words = noteWordCount(baseline.note);
    if (words < PRIVACY_BASELINE_NOTE_MIN_WORDS) {
      failures.push({
        language,
        code: "note_too_short",
        detail: `${words} word(s)`,
      });
    }
  }
  return failures;
}

/**
 * What changed between two revisions of the table, given the files the same
 * diff touched.
 *
 * A language absent from `previous` is NEW and is not a drift finding: it has
 * no prior number to have moved away from, and the shape check has already
 * asked whether its note and date are real. A language absent from `current`
 * was removed, which `evaluatePrivacyPages`' `missing_baseline` and the
 * table ↔ `PRIVACY_PAGE_LANGUAGES` parity test both already speak to — saying
 * it a third time here would only crowd the report.
 *
 * An UNCHANGED `words` produces nothing even when the note and date moved:
 * clarifying a note is a good thing to do and does not need permission.
 *
 * `changedFiles` are repo-relative posix paths, as `git diff --name-only`
 * emits them.
 */
export function evaluatePrivacyBaselineDrift(
  previous: Readonly<Record<string, PrivacyBodyBaseline>>,
  current: Readonly<Record<string, PrivacyBodyBaseline>>,
  changedFiles: readonly string[],
): readonly BaselineProvenanceFailure[] {
  const touched = new Set(changedFiles);
  const failures: BaselineProvenanceFailure[] = [];
  for (const [language, baseline] of Object.entries(current)) {
    const before = previous[language];
    if (before === undefined || before.words === baseline.words) continue;

    const move = `${before.words} → ${baseline.words}`;
    const policyPath = privacyPolicySourcePath(language);
    if (!touched.has(policyPath)) {
      failures.push({
        language,
        code: "policy_unchanged",
        detail: `${move}, but ${policyPath} is untouched`,
      });
    }
    if (
      before.recordedOn === baseline.recordedOn &&
      before.note === baseline.note
    ) {
      failures.push({
        language,
        code: "provenance_unchanged",
        detail: `${move}, still dated ${baseline.recordedOn}`,
      });
      // The two checks below both read the new provenance; with neither field
      // touched there is nothing there to read, and repeating the same cause
      // three times is how a one-line fix reads as three problems.
      continue;
    }
    if (baseline.recordedOn < before.recordedOn) {
      failures.push({
        language,
        code: "provenance_date_regressed",
        detail: `${baseline.recordedOn} is earlier than ${before.recordedOn}`,
      });
    }
    if (!baseline.note.includes(String(before.words))) {
      failures.push({
        language,
        code: "note_omits_previous_words",
        detail: `${move}, note does not mention ${before.words}`,
      });
    }
  }
  return failures;
}

const BASELINE_PROVENANCE_MESSAGE: Record<
  BaselineProvenanceFailureCode,
  (language: string, detail: string | undefined) => string
> = {
  non_positive_words: (language, detail) =>
    `PRIVACY_BODY_BASELINES["${language}"].words is ${detail ?? "not a positive integer"} — a baseline is a measured word count, and a zero or negative one makes the ±band around it meaningless.`,
  malformed_date: (language, detail) =>
    `PRIVACY_BODY_BASELINES["${language}"].recordedOn is ${detail ?? "not a date"} — it must be a YYYY-MM-DD date, because the drift guard compares it against the previous revision's to prove the number was re-recorded and not merely overwritten.`,
  note_too_short: (language, detail) =>
    `PRIVACY_BODY_BASELINES["${language}"].note is ${detail ?? "too short"}, under the ${PRIVACY_BASELINE_NOTE_MIN_WORDS}-word floor — the note is the only place the reason for a size change is written down, and "updated" is the failure this floor exists for. Say what changed in the policy.`,
  policy_unchanged: (language, detail) =>
    `PRIVACY_BODY_BASELINES["${language}"].words changed (${detail ?? "no detail"}) — a baseline describes a policy file, so a commit that moves the number without touching the file is either a typo fix in the wrong place or a red drift gate being silenced. Change the policy in the same commit, or leave the baseline alone.`,
  provenance_unchanged: (language, detail) =>
    `PRIVACY_BODY_BASELINES["${language}"].words changed (${detail ?? "no detail"}) with recordedOn and note untouched — that is exactly the "paste the measured count in and move on" resolution the note field exists to prevent. Set recordedOn to today and write what changed in the policy.`,
  provenance_date_regressed: (language, detail) =>
    `PRIVACY_BODY_BASELINES["${language}"].recordedOn went backwards (${detail ?? "no detail"}) — the date records when the CURRENT number was measured, so a later measurement cannot carry an earlier date. This is usually a bad merge resolution keeping the old entry's date.`,
  note_omits_previous_words: (language, detail) =>
    `PRIVACY_BODY_BASELINES["${language}"].note does not name the count it replaced (${detail ?? "no detail"}) — the convention is "1171 → 980 (dropped the analytics section)", so the size of the change is legible in the diff without checking out the parent commit. Include the old number in the note.`,
};

export type BaselineProvenanceResult = {
  readonly ok: boolean;
  readonly failures: readonly BaselineProvenanceFailure[];
  /** Entries the shape half looked at. */
  readonly checked: number;
  /**
   * Base revision the drift half ran against, or null when it did not run.
   * Reported either way — a check that quietly skipped half of itself and
   * printed a pass is the shape this repo's guards are written against.
   */
  readonly comparedAgainst: string | null;
};

export type BaselineProvenanceInput = {
  readonly current: Readonly<Record<string, PrivacyBodyBaseline>>;
  /** Same table one revision back, or null when it is not readable there. */
  readonly previous: Readonly<Record<string, PrivacyBodyBaseline>> | null;
  /** Label for `previous`'s revision, echoed into the report. */
  readonly baseRef: string | null;
  readonly changedFiles: readonly string[];
};

export function evaluatePrivacyBaselineProvenance(
  input: BaselineProvenanceInput,
): BaselineProvenanceResult {
  const shape = evaluatePrivacyBaselineShape(input.current);
  const { previous, baseRef } = input;
  const compared = previous !== null && baseRef !== null;
  const drift = compared
    ? evaluatePrivacyBaselineDrift(previous, input.current, input.changedFiles)
    : [];
  const failures = [...shape, ...drift];
  const checked = Object.keys(input.current).length;
  return {
    ok: checked > 0 && failures.length === 0,
    failures,
    checked,
    comparedAgainst: compared ? input.baseRef : null,
  };
}

export function formatBaselineProvenanceFailure(
  checkName: string,
  failure: BaselineProvenanceFailure,
): string {
  return `${checkName}: ERROR — ${BASELINE_PROVENANCE_MESSAGE[failure.code](failure.language, failure.detail)}`;
}

export function formatBaselineProvenanceReport(
  checkName: string,
  result: BaselineProvenanceResult,
): string {
  if (result.ok) {
    const against =
      result.comparedAgainst === null
        ? "no previous revision of the table was readable, so only the shape half ran"
        : `compared against ${result.comparedAgainst}`;
    return `${checkName}: ${result.checked} baseline(s) well-formed (${against}).`;
  }
  if (result.checked === 0) {
    return `${checkName}: ERROR — PRIVACY_BODY_BASELINES is empty; a pass over zero baselines is not a pass.`;
  }
  return result.failures
    .map((failure) => formatBaselineProvenanceFailure(checkName, failure))
    .join("\n");
}
