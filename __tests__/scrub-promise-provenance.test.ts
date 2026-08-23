import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROVENANCE_TABLES } from "../lib/provenance-tables";
import {
  SCRUB_PROMISE_NOTE_MIN_WORDS,
  SCRUB_PROMISE_SOURCE_FILE,
  evaluateScrubPromiseDrift,
  evaluateScrubPromiseProvenance,
  evaluateScrubPromiseShape,
  formatScrubPromiseProvenanceReport,
  type ScrubPromiseFailureCode,
} from "../lib/scrub-promise-provenance";
import {
  SCRUB_PROMISE_BASELINE,
  parseScrubPromiseBaseline,
  scrubPromiseChecksum,
  type ScrubPromiseBaseline,
} from "../lib/sentry-scrub-promises";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The guard that stops the promise fingerprint being pasted green.
 *
 * The checksum shipped with a static case: edit the sentence and the parity
 * suite goes red. That is what it is for, and it is also the shape that decays,
 * because the documented repair is "record the new value here". A value whose
 * repair is a paste is one commit from being a rubber stamp — the same problem
 * the two tables next door have, with the same answer: whoever moves the value
 * writes down why, in the same commit, and a guard compares this file against
 * its own previous revision to check that they did.
 *
 * What it can and cannot do, stated rather than implied: it cannot tell a
 * re-reading of the probes from a paste. It forces the diff to SAY which.
 */

const baseline = (over: Partial<ScrubPromiseBaseline> = {}): ScrubPromiseBaseline => ({
  checksum: "0123456789abcdef",
  recordedOn: "2026-08-23",
  note: "Recorded after the retention sentence moved; every probe re-read against the new clause.",
  ...over,
});

const codes = (failures: readonly { readonly code: ScrubPromiseFailureCode }[]) =>
  failures.map(({ code }) => code);

describe("the shipped scrub-promise baseline", () => {
  it("is well-formed", () => {
    assert.deepEqual(codes(evaluateScrubPromiseShape(SCRUB_PROMISE_BASELINE)), []);
  });

  it("records the checksum of the clause this checkout actually ships", () => {
    // The value and what it claims to measure, compared. A record that is
    // internally well-formed and describes a different sentence would satisfy
    // every case below.
    assert.equal(
      SCRUB_PROMISE_BASELINE.checksum,
      scrubPromiseChecksum(readRepoFile(SCRUB_PROMISE_SOURCE_FILE)),
    );
  });

  it("round-trips its own module source through the parser", () => {
    // The drift half reads this file as TEXT at a previous revision, so a
    // reformat that defeats the parser turns that half off. Failing here means
    // it fails on the commit that reformats rather than three commits later.
    assert.deepEqual(
      parseScrubPromiseBaseline(readRepoFile("lib/sentry-scrub-promises.ts")),
      SCRUB_PROMISE_BASELINE,
    );
  });

  it("is registered as a provenance table, so the guard compares it against history", () => {
    const entry = PROVENANCE_TABLES.find((table) => table.id === "scrub-promise");
    assert.ok(
      entry !== undefined,
      "the record is guarded by a static case only; nothing asks whether its note moved with it",
    );
    assert.equal(entry.module, "lib/sentry-scrub-promises.ts");
  });
});

describe("evaluateScrubPromiseShape", () => {
  it("refuses a checksum that cannot have been measured", () => {
    for (const checksum of ["", "not-hex", "640DB24EB634B89A", "640db24eb634b89"]) {
      assert.deepEqual(
        codes(evaluateScrubPromiseShape(baseline({ checksum }))),
        ["malformed_checksum"],
        `"${checksum}" was accepted as a fingerprint`,
      );
    }
  });

  it("refuses a date nothing can order", () => {
    for (const recordedOn of ["", "23-08-2026", "August 2026"]) {
      assert.deepEqual(codes(evaluateScrubPromiseShape(baseline({ recordedOn }))), [
        "malformed_date",
      ]);
    }
  });

  it("refuses a note too short to say which kind of edit moved the value", () => {
    const short = Array.from(
      { length: SCRUB_PROMISE_NOTE_MIN_WORDS - 1 },
      (_unused, index) => `word${String(index)}`,
    ).join(" ");
    assert.deepEqual(codes(evaluateScrubPromiseShape(baseline({ note: short }))), [
      "note_too_short",
    ]);
    assert.deepEqual(
      codes(evaluateScrubPromiseShape(baseline({ note: `${short} eighth` }))),
      [],
    );
  });

  it("reports every malformed field rather than stopping at the first", () => {
    assert.deepEqual(
      codes(
        evaluateScrubPromiseShape({
          checksum: "nope",
          recordedOn: "yesterday",
          note: "short",
        }),
      ),
      ["malformed_checksum", "malformed_date", "note_too_short"],
    );
  });
});

describe("evaluateScrubPromiseDrift", () => {
  const moved = baseline({ checksum: "fedcba9876543210" });

  it("says nothing when the fingerprint did not move", () => {
    const same = baseline({ recordedOn: "2026-09-01" });
    assert.deepEqual(codes(evaluateScrubPromiseDrift(baseline(), same, [])), []);
  });

  it("refuses a new fingerprint carrying the note it replaced", () => {
    // The whole point: the repair for this guard's own failure message is a
    // paste, and a paste does not move the note.
    assert.deepEqual(
      codes(
        evaluateScrubPromiseDrift(baseline(), moved, [SCRUB_PROMISE_SOURCE_FILE]),
      ),
      ["note_unchanged"],
    );
  });

  it("refuses a fingerprint that moved with no file behind it", () => {
    // The value is measured FROM PRIVACY.md, so a new number with that file
    // untouched cannot have been measured from anything.
    const renoted = baseline({
      checksum: moved.checksum,
      note: "The German page was re-translated and the English clause was left exactly as it stood.",
    });
    assert.deepEqual(codes(evaluateScrubPromiseDrift(baseline(), renoted, [])), [
      "policy_unchanged",
    ]);
    assert.deepEqual(
      codes(
        evaluateScrubPromiseDrift(baseline(), renoted, ["PRIVACY.md.de"]),
      ),
      ["policy_unchanged"],
      "a translation moving is not the English clause moving",
    );
  });

  it("refuses a reading dated before the one it replaces", () => {
    const backwards = baseline({
      checksum: moved.checksum,
      recordedOn: "2026-08-01",
      note: "Merged the other side by mistake and kept its provenance, which is what this catches.",
    });
    assert.deepEqual(
      codes(
        evaluateScrubPromiseDrift(baseline(), backwards, [SCRUB_PROMISE_SOURCE_FILE]),
      ),
      ["date_regressed"],
    );
  });

  it("reports one cause once when the note did not move at all", () => {
    // With neither field touched there is no new date to read, and one cause
    // reported twice reads as two problems.
    const frozen = baseline({ checksum: moved.checksum, recordedOn: "2026-01-01" });
    assert.deepEqual(
      codes(
        evaluateScrubPromiseDrift(baseline(), frozen, [SCRUB_PROMISE_SOURCE_FILE]),
      ),
      ["note_unchanged"],
    );
  });

  it("accepts the shape of a real repair", () => {
    const repaired = baseline({
      checksum: moved.checksum,
      recordedOn: "2026-09-01",
      note: "The clause now names device identifiers; a fifth probe was added and all five re-checked.",
    });
    assert.deepEqual(
      codes(
        evaluateScrubPromiseDrift(baseline(), repaired, [SCRUB_PROMISE_SOURCE_FILE]),
      ),
      [],
    );
  });
});

describe("evaluateScrubPromiseProvenance and its report", () => {
  it("skips the drift half when there is no previous record", () => {
    const result = evaluateScrubPromiseProvenance({
      current: baseline(),
      previous: null,
      baseRef: "abc123",
      changedFiles: [],
    });
    assert.equal(result.ok, true);
    assert.equal(result.comparedAgainst, null);
    assert.match(
      formatScrubPromiseProvenanceReport("guard", result),
      /only the shape half ran/,
    );
  });

  it("names the base revision it compared against on the pass line", () => {
    const result = evaluateScrubPromiseProvenance({
      current: baseline(),
      previous: baseline(),
      baseRef: "abc123",
      changedFiles: [],
    });
    assert.equal(result.comparedAgainst, "abc123");
    assert.equal(
      formatScrubPromiseProvenanceReport("guard", result),
      "guard: the scrub-promise fingerprint is well-formed (compared against abc123).",
    );
  });

  it("puts both halves' failures in one report", () => {
    const result = evaluateScrubPromiseProvenance({
      // Malformed AND unexplained: the shape half and the drift half both have
      // something to say, and a report that showed one would hide the other
      // behind a fix.
      current: baseline({ checksum: "nope" }),
      previous: baseline({ checksum: "0000000000000000" }),
      baseRef: "abc123",
      changedFiles: [SCRUB_PROMISE_SOURCE_FILE],
    });
    assert.equal(result.ok, false);
    const report = formatScrubPromiseProvenanceReport("guard", result);
    assert.match(report, /sixteen lowercase hex characters/);
    assert.match(report, /same note/);
    for (const line of report.split("\n")) {
      assert.match(line, /^guard: ERROR — /);
    }
  });

  it("says what a reader has to do next, in every failure it can produce", () => {
    // A message that names the field and stops is a message somebody satisfies
    // by pasting. Each of these has to point at the file or the check that has
    // to be re-read.
    const cases: readonly {
      readonly code: ScrubPromiseFailureCode;
      readonly result: ReturnType<typeof evaluateScrubPromiseProvenance>;
    }[] = [
      {
        code: "note_unchanged",
        result: evaluateScrubPromiseProvenance({
          current: baseline({ checksum: "fedcba9876543210" }),
          previous: baseline(),
          baseRef: "abc123",
          changedFiles: [SCRUB_PROMISE_SOURCE_FILE],
        }),
      },
      {
        code: "policy_unchanged",
        result: evaluateScrubPromiseProvenance({
          current: baseline({
            checksum: "fedcba9876543210",
            note: "A different note entirely, long enough to clear the minimum this rule asks for.",
          }),
          previous: baseline(),
          baseRef: "abc123",
          changedFiles: [],
        }),
      },
    ];
    for (const { code, result } of cases) {
      const report = formatScrubPromiseProvenanceReport("guard", result);
      assert.equal(result.ok, false, `${code} produced a passing result`);
      assert.match(
        report,
        /PRIVACY\.md|sentry-scrub-policy-parity/,
        `the ${code} message names neither the file it is about nor the check to re-read: ${report}`,
      );
    }
  });
});
