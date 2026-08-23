/**
 * The question every KEYED provenance table asks about its own keys, written
 * once: is this key one the repository actually publishes a page for?
 *
 * It shipped twice, three hours apart, in two shape halves that open with the
 * same eight lines — a membership test against a closed set, a failure under the
 * same `unknown_language` code, a detail that is the set joined, and a sentence
 * that differs from its neighbour only in which table and which set it names.
 * Two copies of a rule is a shape; the third is where it becomes a problem, and
 * the fourth table's author is not going to remember that this rule exists. So
 * the rule is here and each table brings the three phrases that genuinely differ.
 *
 * WHAT THE RULE IS FOR, since the sentence it prints is long. Every keyed table
 * hands its keys to `privacyPolicySourcePath` in its drift half, which refuses a
 * code no page is published for. That refusal is right and it arrives at the
 * wrong altitude: as an exception, in a script whose every other failure is a
 * `check-...: ERROR — ` line, and only on the run where that entry's value
 * happened to move. Asked HERE it is a report, on every run, before anything
 * reads history — and it does not throw, so the other entries' findings still
 * print.
 *
 * The failure it describes is specifically a SILENT one. A key nothing is
 * published for names a file that has never existed; the drift half looks for
 * that name in the files a diff touched, does not find it, and reports the file
 * as untouched rather than as missing. The message spells that out because a
 * reader who is told only "unknown language" will go looking for the file.
 *
 * Not every provenance table has keys. `SCRUB_PROMISE_BASELINE` is one record
 * measured from one file, so there is nothing here for it to use — see the note
 * in `lib/scrub-promise-provenance.ts`, which says so rather than leaving the
 * absence to be reconstructed from three modules.
 */

import { policySourcePathFor } from "./privacy-body-baselines";

/**
 * The closed set a table's keys must come from, plus the three phrases its
 * refusal needs.
 *
 * `members` is derived from the shipped constant in every real case — a set
 * spelled out here would be a fourth list of the same codes, which is the bug
 * this family of rules keeps finding.
 */
export type ProvenanceKeySet = {
  /** The table whose keys these are, spelled as the message spells it. */
  readonly table: string;
  /**
   * What a key outside the set IS, completing "…is keyed by a language ".
   * Ends without punctuation: "no /privacy page is published for".
   */
  readonly outsideMeans: string;
  /**
   * How the closing sentence introduces the list — "Known codes",
   * "Translated pages".
   */
  readonly listLabel: string;
  readonly members: readonly string[];
};

/**
 * Null when `key` belongs to the set; otherwise the `detail` its failure should
 * carry — the members, joined.
 *
 * Returning the detail rather than a boolean is what keeps the two callers'
 * `failures.push` identical: neither one reaches into the set to build it, so
 * neither can join a different list from the one that was tested.
 */
export function unknownProvenanceKeyDetail(
  key: string,
  set: ProvenanceKeySet,
): string | null {
  return set.members.includes(key) ? null : set.members.join(", ");
}

/**
 * The refusal, in one sentence shape.
 *
 * `detail` comes off the failure record rather than out of `set`, because that
 * is the value the report was built with — a message that re-derived the list
 * would print today's set beside a failure raised against yesterday's.
 */
export function formatUnknownProvenanceKey(
  key: string,
  set: ProvenanceKeySet,
  detail: string | undefined,
): string {
  return `${set.table}["${key}"] is keyed by a language ${set.outsideMeans} — the entry describes ${policySourcePathFor(key)}, a file that does not exist, and the drift half compares that name against the files a diff touched, so it would report the file as untouched rather than as missing. ${set.listLabel}: ${detail ?? set.members.join(", ")}.`;
}
