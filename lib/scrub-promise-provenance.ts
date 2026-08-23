/**
 * `SCRUB_PROMISE_BASELINE` may not change quietly — the pure half.
 *
 * The checksum landed with a static case: the clause is fingerprinted on every
 * run and the suite goes red the moment somebody edits it. That is the whole
 * point of it, and it is also the shape that decays — the documented repair is
 * "record the new value here", the failure message says so in as many words, and
 * a value whose repair is a paste is one commit from being a rubber stamp. The
 * two tables next door have exactly this problem and exactly this answer: the
 * person changing the value writes down why, in the same commit, next to it, and
 * a guard compares the table against its own previous revision to check that
 * they did.
 *
 * So this is that answer applied to a third value, and it ships as a REGISTRY
 * ENTRY rather than as a third pass in the script — which is the thing the loop
 * was written for. `scripts/check-privacy-baseline-provenance.ts` does not
 * change.
 *
 * Not merged with `lib/privacy-translation-provenance.ts`, and the reason is
 * worth stating rather than leaving to be rediscovered. The two do the same
 * JOB — a fingerprint moved, did its note move, was the file it was measured
 * from touched — over different shapes: that one is a record per language with
 * two checksums each and a message naming the language, this one is a single
 * record with one checksum and messages that would read as noise with a key in
 * them. Merging them means inventing the shape both are instances of, which is a
 * design decision and not a refactor; it is filed as a suggestion instead of
 * smuggled in under this change. What IS shared is `policyChecksum`, so the two
 * values stay comparable, and the loop, so neither owns a copy of the git half.
 *
 * One deliberate divergence from the rule it copies. The translation drift lets
 * a note stay put when only the DATE moved (a re-confirmation of unchanged
 * text); here the checksum moving means the sentence changed, so the note is
 * required to move with it. There is no re-confirmation of an unchanged clause
 * to record — the static case does that on every run.
 */

import { privacyPolicySourcePath } from "./privacy-body-baselines";
import { PRIVACY_DEFAULT_LANGUAGE } from "./privacy-page";
import type { ScrubPromiseBaseline } from "./sentry-scrub-promises";

export type ScrubPromiseFailureCode =
  | "malformed_checksum"
  | "malformed_date"
  | "note_too_short"
  | "note_unchanged"
  | "date_regressed"
  | "policy_unchanged";

export type ScrubPromiseFailure = {
  readonly code: ScrubPromiseFailureCode;
  /** What was read; spliced into the message. */
  readonly detail?: string;
};

/**
 * A note has to be a sentence. Eight rather than five, for the same reason the
 * translation notes ask for eight: this value moves for more than one reason —
 * a rewrap that changed nothing, a field narrowed, a field added — and the note
 * is the only place the diff says which.
 */
export const SCRUB_PROMISE_NOTE_MIN_WORDS = 8;

/**
 * The file the checksum is measured FROM, and so the one that has to move with
 * it.
 *
 * Through `privacyPolicySourcePath` rather than as a literal: this value is
 * compared against `git diff --name-only` output, four other modules ask the
 * same question, and the answer they share is one function. A fifth copy of
 * `"PRIVACY.md"` would be the one that survives a rename.
 */
export const SCRUB_PROMISE_SOURCE_FILE = privacyPolicySourcePath(
  PRIVACY_DEFAULT_LANGUAGE,
);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHECKSUM = /^[0-9a-f]{16}$/;

/** Well-formedness of the record as it stands, independent of any history. */
export function evaluateScrubPromiseShape(
  baseline: ScrubPromiseBaseline,
): readonly ScrubPromiseFailure[] {
  const failures: ScrubPromiseFailure[] = [];
  if (!CHECKSUM.test(baseline.checksum)) {
    failures.push({
      code: "malformed_checksum",
      detail: JSON.stringify(baseline.checksum),
    });
  }
  if (!ISO_DATE.test(baseline.recordedOn)) {
    failures.push({
      code: "malformed_date",
      detail: JSON.stringify(baseline.recordedOn),
    });
  }
  const words = baseline.note.trim().split(/\s+/).filter(Boolean).length;
  if (words < SCRUB_PROMISE_NOTE_MIN_WORDS) {
    failures.push({
      code: "note_too_short",
      detail: `${String(words)} word(s)`,
    });
  }
  return failures;
}

/**
 * What changed between two revisions of the record, given the files the same
 * diff touched.
 *
 * A checksum that did not move produces nothing: the clause is unchanged, and
 * the static case in the parity suite has already said so this run.
 *
 * `changedFiles` are repo-relative posix paths, as `git diff --name-only` emits.
 */
export function evaluateScrubPromiseDrift(
  previous: ScrubPromiseBaseline,
  current: ScrubPromiseBaseline,
  changedFiles: readonly string[],
): readonly ScrubPromiseFailure[] {
  if (previous.checksum === current.checksum) return [];
  const failures: ScrubPromiseFailure[] = [];
  if (!changedFiles.includes(SCRUB_PROMISE_SOURCE_FILE)) {
    failures.push({
      code: "policy_unchanged",
      detail: `${SCRUB_PROMISE_SOURCE_FILE} is untouched in this diff`,
    });
  }
  if (previous.note === current.note) {
    failures.push({
      code: "note_unchanged",
      detail: `still "${current.note.slice(0, 60)}${current.note.length > 60 ? "…" : ""}"`,
    });
    // The date check below reads the new provenance, and one cause reported
    // twice reads as two problems.
    return failures;
  }
  if (current.recordedOn < previous.recordedOn) {
    failures.push({
      code: "date_regressed",
      detail: `${current.recordedOn} is earlier than ${previous.recordedOn}`,
    });
  }
  return failures;
}

const MESSAGE: Record<
  ScrubPromiseFailureCode,
  (detail: string | undefined) => string
> = {
  malformed_checksum: (detail) =>
    `SCRUB_PROMISE_BASELINE.checksum is ${detail ?? "not a checksum"} — expected sixteen lowercase hex characters, which is what scrubPromiseChecksum emits. A value that shape cannot have been measured.`,
  malformed_date: (detail) =>
    `SCRUB_PROMISE_BASELINE.recordedOn is ${detail ?? "not a date"} — it records the day somebody read the promise clause against the scrub probes, and a date nothing can order is a date nobody can act on.`,
  note_too_short: (detail) =>
    `SCRUB_PROMISE_BASELINE.note is ${detail ?? "too short"} — the clause's fingerprint moves for more than one reason (a rewrap, a field narrowed, a field added) and the note is the only place the diff says which.`,
  note_unchanged: (detail) =>
    `SCRUB_PROMISE_BASELINE has a new checksum with the same note (${detail ?? ""}). The value moved because the sentence promising what scrubPII removes moved; say what changed, in this commit, and say whether every probe in __tests__/sentry-scrub-policy-parity.test.ts still matches the field it claims.`,
  date_regressed: (detail) =>
    `SCRUB_PROMISE_BASELINE.recordedOn went backwards — ${detail ?? ""}. A reading cannot have happened before the one it replaces; this is usually a merge that kept the wrong side.`,
  policy_unchanged: (detail) =>
    `SCRUB_PROMISE_BASELINE.checksum moved and ${detail ?? "the policy is untouched"}. The value is measured FROM that file, so either the wrong number was pasted in or the file's change was lost in a merge.`,
};

export type ScrubPromiseProvenanceResult = {
  readonly ok: boolean;
  readonly failures: readonly ScrubPromiseFailure[];
  /** Base revision the drift half ran against, or null when it did not run. */
  readonly comparedAgainst: string | null;
};

export function evaluateScrubPromiseProvenance(input: {
  readonly current: ScrubPromiseBaseline;
  readonly previous: ScrubPromiseBaseline | null;
  readonly baseRef: string | null;
  readonly changedFiles: readonly string[];
}): ScrubPromiseProvenanceResult {
  const shape = evaluateScrubPromiseShape(input.current);
  const compared = input.previous !== null && input.baseRef !== null;
  const drift = compared
    ? evaluateScrubPromiseDrift(
        input.previous as ScrubPromiseBaseline,
        input.current,
        input.changedFiles,
      )
    : [];
  const failures = [...shape, ...drift];
  return {
    ok: failures.length === 0,
    failures,
    comparedAgainst: compared ? input.baseRef : null,
  };
}

export function formatScrubPromiseProvenanceReport(
  checkName: string,
  result: ScrubPromiseProvenanceResult,
): string {
  if (result.ok) {
    const against =
      result.comparedAgainst === null
        ? "no previous revision of the record was readable, so only the shape half ran"
        : `compared against ${result.comparedAgainst}`;
    return `${checkName}: the scrub-promise fingerprint is well-formed (${against}).`;
  }
  return result.failures
    .map((failure) => `${checkName}: ERROR — ${MESSAGE[failure.code](failure.detail)}`)
    .join("\n");
}
