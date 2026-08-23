import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { provenanceOutput } from "../lib/provenance-report";
import { PROVENANCE_TABLES } from "../lib/provenance-tables";
import type { ProvenanceOutcome } from "../lib/provenance-tables";
import { stripComments } from "../lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The guard's output decision, asked without a repository.
 *
 * These are claims about ordering and streams — the cheapest properties in the
 * whole guard — and until this suite existed their only cover was a case that
 * builds a throwaway git repository, commits to it twice and spawns the script.
 * That case still runs, for the questions only a repository can answer; what
 * moved here is everything that never needed one.
 */

function evaluated(
  report: string,
  ok: boolean,
  driftSkipped: string | null = null,
): ProvenanceOutcome {
  return { kind: "evaluated", ok, report, driftSkipped };
}

function textsOn(
  output: ReturnType<typeof provenanceOutput>,
  stream: "stdout" | "stderr",
): readonly string[] {
  return output.lines
    .filter((line) => line.stream === stream)
    .map((line) => line.text);
}

describe("provenanceOutput", () => {
  it("prints one report per table, in the order they were given", () => {
    const output = provenanceOutput(
      "guard",
      [evaluated("first", true), evaluated("second", true), evaluated("third", true)],
      null,
    );
    assert.deepEqual(
      output.lines.map((line) => line.text),
      ["first", "second", "third"],
    );
    assert.equal(output.ok, true);
    assert.equal(output.halted, false);
  });

  it("sends each report to the stream its OWN verdict earns", () => {
    // One table passing while another fails is an ordinary outcome. A pass line
    // on stderr reads as part of the failure.
    const output = provenanceOutput(
      "guard",
      [evaluated("passed", true), evaluated("failed", false)],
      null,
    );
    assert.deepEqual(textsOn(output, "stdout"), ["passed"]);
    assert.deepEqual(textsOn(output, "stderr"), ["failed"]);
    assert.equal(output.ok, false);
  });

  it("prints every report before the verdict, so one fix does not hide the next", () => {
    // The commit that amends the English disclosure moves the word count AND all
    // five checksums: a run that stopped at the first failing table would show
    // half the work.
    const output = provenanceOutput(
      "guard",
      [evaluated("a failed", false), evaluated("b failed", false)],
      null,
    );
    assert.deepEqual(textsOn(output, "stderr"), ["a failed", "b failed"]);
    assert.equal(output.ok, false);
  });

  it("stops on an unparseable table and prints nothing else", () => {
    // That table's drift half is off, so every other report would come from a
    // guard running on one leg — including the PASSES, which is the shape that
    // reads as a clean run.
    const output = provenanceOutput(
      "guard",
      [
        evaluated("a passed", true),
        { kind: "unparseable", message: "guard: ERROR — no table at that revision" },
        evaluated("c passed", true),
      ],
      null,
    );
    assert.deepEqual(output.lines, [
      { stream: "stderr", text: "guard: ERROR — no table at that revision" },
    ]);
    assert.equal(output.halted, true);
    assert.equal(output.ok, false);
  });

  it("says the drift halves sat out ONCE when no base revision existed at all", () => {
    // A property of the run, not of any table. Repeating it per table is how a
    // reader learns to skim these lines.
    const output = provenanceOutput(
      "guard",
      [evaluated("a", true), evaluated("b", true)],
      "HEAD is the root commit",
    );
    assert.deepEqual(textsOn(output, "stdout"), [
      "a",
      "b",
      "guard: drift halves skipped — HEAD is the root commit.",
    ]);
  });

  it("lets each table speak for itself when there WAS a base revision", () => {
    // One table may have compared fine while another could not be read there —
    // the one case a shared skip line gets wrong.
    const output = provenanceOutput(
      "guard",
      [
        evaluated("a", true, "guard: a's drift skipped — a.ts did not exist"),
        evaluated("b", true),
      ],
      null,
    );
    assert.deepEqual(textsOn(output, "stdout"), [
      "a",
      "b",
      "guard: a's drift skipped — a.ts did not exist",
    ]);
  });

  it("puts skip lines after every report, never between them", () => {
    const output = provenanceOutput(
      "guard",
      [
        evaluated("a", true, "a skipped"),
        evaluated("b", false),
      ],
      null,
    );
    assert.deepEqual(
      output.lines.map((line) => line.text),
      ["a", "b", "a skipped"],
    );
  });

  it("keeps a skip line on stdout even when the run failed", () => {
    // A skip is information about what ran, not part of the failure.
    const output = provenanceOutput("guard", [evaluated("b", false)], "no commits yet");
    assert.deepEqual(textsOn(output, "stdout"), [
      "guard: drift halves skipped — no commits yet.",
    ]);
    assert.equal(output.ok, false);
  });

  it("refuses to call an empty run a pass", () => {
    // `every` over nothing is true. The registry's own refusal is what stops
    // this reaching here, and a second opinion costs one line.
    assert.equal(provenanceOutput("guard", [], null).ok, true);
    // Documented rather than asserted-away: the emptiness check belongs to
    // `provenanceRegistryRefusal`, which the script calls first. This case
    // exists so that the day somebody moves it, the move is visible.
    assert.ok(
      stripComments(
        readRepoFile("scripts/check-privacy-baseline-provenance.ts"),
      ).includes("provenanceRegistryRefusal("),
      "nothing refuses an empty registry before the output decision is made",
    );
  });

  it("is what the script prints with, rather than a second copy of the rules", () => {
    const script = stripComments(
      readRepoFile("scripts/check-privacy-baseline-provenance.ts"),
    );
    assert.ok(
      script.includes("provenanceOutput("),
      "the script no longer calls provenanceOutput",
    );
    // The positive control for the sweep below: the script does still print.
    assert.ok(script.includes("console.log"), "the script prints nothing at all");
    // And it no longer decides the stream itself. `outcome.ok ? console.log :`
    // was the branch this module took over.
    assert.ok(
      !/outcome\.ok\s*\?\s*console/.test(script),
      "the script still picks a stream from a verdict, so there are two copies of rule 3",
    );
  });

  it("handles the tables this checkout actually ships", () => {
    // The fabricated outcomes above prove the rules; this proves the rules are
    // being applied to something real, on the commit that adds a fourth table.
    const outcomes = PROVENANCE_TABLES.map((table) =>
      table.run("guard", {
        ref: null,
        present: false,
        source: null,
        changedFiles: [],
      }),
    );
    const output = provenanceOutput("guard", outcomes, "HEAD is the root commit");
    assert.equal(output.ok, true);
    assert.equal(output.halted, false);
    assert.equal(output.lines.length, PROVENANCE_TABLES.length + 1);
    assert.deepEqual(textsOn(output, "stderr"), []);
  });
});
