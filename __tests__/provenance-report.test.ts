import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  printProvenanceOutput,
  provenanceOutput,
} from "../lib/provenance-report";
import { PROVENANCE_TABLES } from "../lib/provenance-tables";
import type { ProvenanceOutcome } from "../lib/provenance-tables";
import { stripComments } from "../lib/strip-comments";

import { captureConsole } from "./helpers/capture-console";
import { measuredFloor } from "./helpers/coverage-floor";
import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

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
    // `every` over nothing is true, so this would otherwise be a silent pass
    // with no lines at all. `provenanceRegistryRefusal` should have stopped it
    // one level up; that guard runs in a caller this module's suite does not
    // control, which is why the claim is also made here.
    const output = provenanceOutput("guard", [], null);
    assert.equal(output.ok, false);
    assert.equal(output.halted, true);
    assert.deepEqual(textsOn(output, "stdout"), []);
    assert.match(textsOn(output, "stderr")[0], /zero tables is not a pass/);
    // And the guard that should have caught it first is still in the script, so
    // this is a second opinion rather than the only one.
    assert.ok(
      stripComments(
        readRepoFile("scripts/check-privacy-baseline-provenance.ts"),
      ).includes("provenanceRegistryRefusal("),
      "nothing refuses an empty registry before the output decision is made",
    );
  });

  it("prints each line to the stream it was assigned", () => {
    const log: string[] = [];
    const error: string[] = [];
    printProvenanceOutput(
      provenanceOutput(
        "guard",
        [evaluated("passed", true, "skipped"), evaluated("failed", false)],
        null,
      ),
      {
        log: (text: string) => log.push(text),
        error: (text: string) => error.push(text),
      } as unknown as Console,
    );
    assert.deepEqual(log, ["passed", "skipped"]);
    assert.deepEqual(error, ["failed"]);
  });

  it("prints to the real console when no console is passed", () => {
    // The overload the SCRIPT uses. Every case above hands in a capturing
    // object, so the seam was covered and the default — the only spelling that
    // runs in CI — was not: it could have named a method the console does not
    // have, or been dropped in favour of a required parameter, and this suite
    // would have gone on passing while `lint:baseline-provenance` printed
    // nothing at all.
    const written = captureConsole(() => {
      printProvenanceOutput(
        provenanceOutput(
          "guard",
          [evaluated("passed", true, "skipped"), evaluated("failed", false)],
          null,
        ),
      );
    });
    assert.deepEqual(written.log, ["passed", "skipped"]);
    assert.deepEqual(written.error, ["failed"]);
  });

  it("is what the script prints with, rather than a second copy of the rules", () => {
    const script = stripComments(
      readRepoFile("scripts/check-privacy-baseline-provenance.ts"),
    );
    assert.ok(
      script.includes("provenanceOutput("),
      "the script no longer calls provenanceOutput",
    );
    assert.ok(
      script.includes("printProvenanceOutput("),
      "the script no longer prints through this module",
    );
    // The script still has a console of its own — the redirect announcement and
    // the three stops are its own lines, and this is the positive control that
    // keeps the sweep below honest.
    assert.ok(script.includes("console.log"), "the script prints nothing at all");
    // What it must NOT have is a second copy of rules 3 and 4: a stream picked
    // from a verdict, or a walk over the lines.
    assert.ok(
      !/outcome\.ok\s*\?\s*console/.test(script),
      "the script still picks a stream from a verdict, so there are two copies of rule 3",
    );
    assert.ok(
      !script.includes("output.lines"),
      "the script still walks the lines itself",
    );
  });

  it("is named, with every other module in the family, by the script's map", () => {
    // The script's leading comment is now a map of the pure half — five modules
    // and what each decides — because the pure half outgrew the script and the
    // old note still described two tables and a hand-written pass. A map is only
    // worth having if it is checked, so it is derived from the directory rather
    // than read.
    const modules = sourceFiles("lib").filter((file) =>
      /^lib\/(provenance-.*|.*-provenance)\.ts$/.test(file),
    );
    assert.ok(
      modules.length >= 5,
      measuredFloor(modules.length, 5, "module(s) matched the provenance pattern"),
    );
    // The leading comment only — a module named in the import list rather than
    // in the map is exactly what this is looking for.
    const script = readRepoFile("scripts/check-privacy-baseline-provenance.ts");
    const note = script.slice(0, script.indexOf("\nimport "));
    const unnamed = modules.filter((module) => !note.includes(module));
    assert.deepEqual(
      unnamed,
      [],
      `the script's map does not name these modules: ${unnamed.join(", ")}`,
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
