/**
 * What the privacy policy PROMISES is stripped from a crash report, read out of
 * the policy itself.
 *
 * `PRIVACY.md` tells a reader that "personally identifying fields (email
 * address, IP address, cookies, and `Authorization` headers) are stripped
 * client-side before transmission", and `scrubPII` in `lib/sentry.ts` is what
 * makes that true. Both are well covered on their own: the policy's size and
 * translations are guarded, and `__tests__/sentry-scrubber.test.ts` checks each
 * field the scrubber removes. Nothing checked that the two lists are the same
 * list.
 *
 * The gap is one-directional and the direction matters. A field the scrubber
 * removes and the policy does not mention is an app doing MORE than it said,
 * which is fine. A field the policy promises and the scrubber does not remove is
 * the app doing less than it told a user it does, about data it is sending to a
 * third party — and the way it happens is not malice but an edit: somebody
 * widens the promise while writing the disclosure, or narrows the scrubber while
 * refactoring, and each file's own suite stays green because each file is still
 * internally consistent.
 *
 * PARSED rather than declared twice. A hand-kept list of the promised fields
 * would be a third copy of the same sentence and would drift from the policy in
 * exactly the way this module exists to prevent. What is hand-kept is the map
 * from a promised phrase to a probe value the scrubber has to remove, which is
 * the part no parser can infer — and it is checked exhaustive against what the
 * sentence actually says.
 *
 * The exhaustiveness check catches a field ADDED to the promise and cannot catch
 * one NARROWED, which is what {@link SCRUB_PROMISE_BASELINE} is for — see its
 * note.
 */

import {
  normalisePolicyText,
  policyChecksum,
} from "./privacy-translated-section";

/**
 * The phrase that introduces the promise, and the anchor the parenthetical is
 * read from.
 *
 * A literal rather than a pattern: the sentence is a legal commitment, and a
 * loose match would keep finding SOMETHING after a rewrite that changed what was
 * committed to. If this stops matching, that is the correct outcome — the
 * promise was rephrased and somebody has to look at the scrubber.
 */
export const SCRUB_PROMISE_INTRO = "personally identifying fields";

/**
 * The fields the policy says are stripped, in the order it lists them.
 *
 * Reads the parenthetical that follows {@link SCRUB_PROMISE_INTRO}, splits it on
 * commas and a trailing "and", and drops the markdown backticks around
 * `Authorization`. Returns the phrases as written, because they are what a
 * failure message has to quote back.
 *
 * Throws when the anchor or its parenthetical is missing. An empty list would
 * make every parity check below pass with nothing in it, which is the one
 * failure a promise-checker cannot afford.
 */
export function extractScrubPromises(policyText: string): readonly string[] {
  const anchor = policyText.indexOf(SCRUB_PROMISE_INTRO);
  if (anchor === -1) {
    throw new Error(
      `the privacy policy no longer says "${SCRUB_PROMISE_INTRO}" — the sentence promising what is stripped from a crash report was rephrased, and lib/sentry.ts's scrubPII has to be read against whatever replaced it.`,
    );
  }
  const open = policyText.indexOf("(", anchor);
  const close = policyText.indexOf(")", open);
  if (open === -1 || close === -1) {
    throw new Error(
      `"${SCRUB_PROMISE_INTRO}" is no longer followed by a parenthetical list — nothing can now say which fields the policy promises are stripped.`,
    );
  }
  return policyText
    .slice(open + 1, close)
    .split(/,|\band\b/)
    .map((item) => item.replace(/`/g, "").trim())
    .filter((item) => item.length > 0);
}

/**
 * The promise CLAUSE, from its intro through the sentence it ends.
 *
 * Normalised first — the policy is hard-wrapped inside a blockquote, so the
 * clause spans three lines with `> ` markers in front of two of them, and a
 * rewrap must not read as an amendment (the same argument
 * {@link normalisePolicyText} was written for next door).
 *
 * Ends at the first sentence-ending period AFTER the parenthetical, because the
 * parenthetical cannot contain one and the abbreviations that would break a
 * naive split ("e.g.", "i.e.") are what a legal disclosure is written to avoid.
 * A clause with no terminator is a throw rather than a slice to end-of-file: a
 * fingerprint of the whole remaining policy would move on every unrelated edit,
 * which is a rule nobody keeps.
 */
export function scrubPromiseClause(policyText: string): string {
  const normalised = normalisePolicyText(policyText);
  const anchor = normalised.indexOf(SCRUB_PROMISE_INTRO);
  if (anchor === -1) {
    throw new Error(
      `the privacy policy no longer says "${SCRUB_PROMISE_INTRO}" — the sentence promising what is stripped from a crash report was rephrased, and lib/sentry.ts's scrubPII has to be read against whatever replaced it.`,
    );
  }
  const close = normalised.indexOf(")", anchor);
  const stop = close === -1 ? -1 : normalised.indexOf(".", close);
  if (close === -1 || stop === -1) {
    throw new Error(
      `"${SCRUB_PROMISE_INTRO}" is no longer followed by a parenthetical list ending in a sentence — nothing can now fingerprint what the policy promises is stripped.`,
    );
  }
  return normalised.slice(anchor, stop + 1);
}

/** {@link scrubPromiseClause}, fingerprinted the way every other disclosure here is. */
export function scrubPromiseChecksum(policyText: string): string {
  return policyChecksum(scrubPromiseClause(policyText));
}

/**
 * The promise as it was last read against `scrubPII`, and the day somebody read
 * it.
 *
 * WHAT THE FIELD LIST CANNOT SEE. `extractScrubPromises` gives the parity suite
 * the phrases the policy lists, and the suite matches each to a probe by regex —
 * `/^email/i`, `/^ip\b/i`, `/^authorization/i`. Those patterns are anchored on
 * one word on purpose (the policy is prose and the event has keys), and that is
 * also how a NARROWED promise keeps its probe: "email address" reworded to
 * "email domain" still matches `/^email/i`, still claims the same probe, and
 * the exhaustiveness case — which asks whether every phrase is claimed and every
 * probe is used — is satisfied by both. The app would then be stripping the whole
 * address while the policy promised only the domain, or the reverse, and nothing
 * in the suite could tell.
 *
 * The checksum cannot read the new wording either. What it does is refuse to let
 * the rewording pass unlooked-at: any edit to the clause turns the suite red, and
 * the documented repair is to re-read every probe against the new sentence and
 * then record what was found. Same reviewability guarantee, and the same honest
 * limit, as the translation checksums next door — the machine makes somebody
 * look, and looking is still a person's job.
 *
 * `recordedOn` and `note` are the provenance the value needs to be worth
 * anything: a checksum whose repair is a paste is one commit from being a rubber
 * stamp, and the note is the only place the diff says WHICH kind of edit moved
 * it — a rewrap that changed nothing, a narrowed field, or a field added.
 */
export type ScrubPromiseBaseline = {
  /** {@link scrubPromiseChecksum} of `PRIVACY.md` on `recordedOn`. */
  readonly checksum: string;
  /** The day somebody read the clause against the probes. ISO, so it orders. */
  readonly recordedOn: string;
  /** What moved the value, in a sentence. See the note above on why. */
  readonly note: string;
};

export const SCRUB_PROMISE_BASELINE: ScrubPromiseBaseline = {
  checksum: "640db24eb634b89a",
  recordedOn: "2026-08-23",
  note: "First fingerprint of the promise clause, taken against the four probes in sentry-scrub-policy-parity as they stand; the field list was already checked exhaustive, this pins the wording those probes were matched to.",
};


/**
 * The baseline as it stands in a given revision of this module's SOURCE.
 *
 * Text in rather than an import, because the guard that uses it compares this
 * file against its own previous revision — see
 * `scripts/check-privacy-baseline-provenance.ts`. Null means "no comparable
 * record at that revision", which the caller reads as a skip.
 *
 * Anchored on the DECLARATION rather than the name, which also appears in this
 * file's prose above it, and closed by a `};` at column 0 — every field in the
 * literal is indented, so this needs no brace counting. The literal is
 * deliberately annotated with a NAMED type rather than an inline one, so the
 * first `{` after the declaration is the object and not its shape.
 */
export function parseScrubPromiseBaseline(
  source: string,
): ScrubPromiseBaseline | null {
  const start = source.indexOf("export const SCRUB_PROMISE_BASELINE");
  if (start === -1) return null;
  const open = source.indexOf("{", start);
  if (open === -1) return null;
  const close = source.indexOf("\n};", open);
  if (close === -1) return null;
  const body = source.slice(open, close);

  const field =
    /checksum\s*:\s*"([0-9a-f]*)"\s*,\s*recordedOn\s*:\s*"([^"]*)"\s*,\s*note\s*:\s*"((?:[^"\\]|\\.)*)"/;
  const match = field.exec(body);
  if (match === null) return null;
  return {
    checksum: match[1],
    recordedOn: match[2],
    // Only `\"` and `\\` can legally appear; unescaping them keeps a note
    // containing a quote comparable with the imported object.
    note: match[3].replace(/\\(["\\])/g, "$1"),
  };
}
