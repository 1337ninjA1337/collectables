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
 */

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
