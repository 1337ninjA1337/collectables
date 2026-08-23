/**
 * What the provenance guard PRINTS, and to which stream — the last piece of
 * `scripts/check-privacy-baseline-provenance.ts` that was a decision rather than
 * a git call.
 *
 * Four rules, none of them obvious, all of them load-bearing:
 *
 *   1. An `unparseable` table STOPS the run, and nothing else prints. That
 *      table's drift half is off, and a pass line beside it is a report from a
 *      guard running on one leg.
 *   2. Reports print in registry order, one per table, all of them, before any
 *      exit code is honoured — the commit that amends the English disclosure
 *      moves the word count AND all five checksums, so stopping at the first
 *      failure would hide half the work behind a fix.
 *   3. Each report goes to the stream its OWN verdict earns. One table passing
 *      while another fails is an ordinary outcome, and a pass line on stderr
 *      reads as part of the failure.
 *   4. Skip lines come last, and there is either ONE of them (no base revision
 *      at all, so every drift half sat out for the same reason) or one per table
 *      that could not be read at a base revision the others managed.
 *
 * Extracted because of what it cost to check. These are claims about ordering
 * and streams — the cheapest properties in the guard — and the only cover they
 * had was a case that builds a throwaway git repository, commits to it twice and
 * spawns the script. That cover is worth keeping for the questions only a
 * repository can answer; it is the wrong altitude for "does the second report
 * print after the first". Text in, lines out, no git.
 */

import { checkError } from "./check-error";
import type { ProvenanceOutcome } from "./provenance-tables";

export type ProvenanceLine = {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
};

export type ProvenanceOutput = {
  /** In print order, already assigned to their streams. */
  readonly lines: readonly ProvenanceLine[];
  /** Whether every table was evaluated and passed. */
  readonly ok: boolean;
  /**
   * True when an `unparseable` table cut the run short. The caller prints
   * {@link lines} and exits non-zero WITHOUT its own trailing summary: a run
   * that stopped this way has not read the other tables, so a line describing
   * what it checked would be describing something that did not happen.
   */
  readonly halted: boolean;
};

/**
 * The four rules above, applied to one run's outcomes.
 *
 * `skipReason` is non-null only when there was no base revision AT ALL (an
 * unborn HEAD, a root commit). That is a property of the run rather than of any
 * table, so it is said once — repeating it per table is how a reader learns to
 * skim these lines. When there WAS a base revision, each table speaks for
 * itself through its own `driftSkipped`, because one table may have compared
 * fine while another could not be read.
 */
export function provenanceOutput(
  checkName: string,
  outcomes: readonly ProvenanceOutcome[],
  skipReason: string | null,
): ProvenanceOutput {
  // `every` over nothing is true, so an empty list would come out of here as a
  // silent pass with no lines at all. `provenanceRegistryRefusal` is what stops
  // that reaching this function and it runs one level up, in the script — which
  // means the claim is guarded by the ORDER of two calls in a caller neither
  // this module nor its suite controls. Refusing here as well costs four lines
  // and makes it local.
  if (outcomes.length === 0) {
    return {
      lines: [
        {
          stream: "stderr",
          text: checkError(
            checkName,
            "no provenance table produced an outcome, and a pass over zero tables is not a pass. Tables are registered in lib/provenance-tables.ts, and provenanceRegistryRefusal — which says the same thing about the REGISTRY, earlier and with the cause named — is what should have refused this before the run got here. Neither is a duplicate of the other: that one can be skipped by a caller that forgets to ask, and this one cannot.",
          ),
        },
      ],
      ok: false,
      halted: true,
    };
  }
  const unparseable = outcomes.find((outcome) => outcome.kind === "unparseable");
  if (unparseable !== undefined && unparseable.kind === "unparseable") {
    return {
      lines: [{ stream: "stderr", text: unparseable.message }],
      ok: false,
      halted: true,
    };
  }

  const lines: ProvenanceLine[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind !== "evaluated") continue;
    lines.push({
      stream: outcome.ok ? "stdout" : "stderr",
      text: outcome.report,
    });
  }
  if (skipReason !== null) {
    lines.push({
      stream: "stdout",
      text: `${checkName}: drift halves skipped — ${skipReason}.`,
    });
  } else {
    for (const outcome of outcomes) {
      if (outcome.kind === "evaluated" && outcome.driftSkipped !== null) {
        lines.push({ stream: "stdout", text: outcome.driftSkipped });
      }
    }
  }
  return {
    lines,
    ok: outcomes.every((outcome) => outcome.kind === "evaluated" && outcome.ok),
    halted: false,
  };
}

/**
 * {@link ProvenanceOutput} to a console, each line on the stream it was assigned.
 *
 * Here rather than in the caller because the map from a stream name to a console
 * method is the last half-sentence of rule 3, and a caller that owns it is a
 * caller that can disagree with the rule that produced the name. The console is
 * a parameter so a test can be the console.
 */
export function printProvenanceOutput(
  output: ProvenanceOutput,
  out: Pick<Console, "log" | "error"> = console,
): void {
  for (const line of output.lines) {
    if (line.stream === "stdout") out.log(line.text);
    else out.error(line.text);
  }
}
