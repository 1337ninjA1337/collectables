import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PRIVACY_BODY_BASELINES } from "../lib/privacy-body-baselines";
import { PRIVACY_TRANSLATION_SOURCES } from "../lib/privacy-translated-section";
import {
  PROVENANCE_TABLES,
  changedFilesRefusal,
  defineProvenanceTable,
  provenanceRegistryRefusal,
  type ProvenanceBaseRevision,
  type ProvenanceRevision,
  type ProvenanceTable,
  type ProvenanceVerdict,
} from "../lib/provenance-tables";

import { PRIVACY_DEFAULT_LANGUAGE } from "../lib/privacy-languages";
import { privacyPolicySourcePath } from "../lib/privacy-body-baselines";
import { SCRUB_PROMISE_SOURCE_FILE } from "../lib/scrub-promise-provenance";
import { stripComments } from "../lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The loop that replaced two copies of the same six steps.
 *
 * `scripts/check-privacy-baseline-provenance.ts` asked one question of two
 * tables and asked it twice, in two hand-written passes that had already begun
 * to differ in ways nobody chose (one three-way classification, one two-way; one
 * `git diff --name-only` each, for the same diff). The steps now live once and
 * each table contributes only what genuinely differs.
 *
 * Two things are pinned here and they are different claims. That the LOOP does
 * the six steps in the right order and skips the right ones — tested against a
 * fabricated table, because a rule about ordering should not need a legal
 * document to state it. And that the REAL entries still say what they said
 * before the refactor, including the places they deliberately disagree.
 *
 * The registry cases below are written over `PROVENANCE_TABLES` rather than over
 * a list of names, so a table added later is covered by them on the commit that
 * adds it — which is what the loop was for.
 */

type Fake = { readonly value: string };

type FakeVerdict = ProvenanceVerdict & { readonly seen: string | null };

/** Records every call, so "was this step run at all" is answerable. */
function fakeTable(
  over: {
    readonly revision?: ProvenanceRevision<Fake>;
    readonly ok?: boolean;
    /**
     * Omit the hard-failure sentence, the way the two collapsed real entries do.
     * The field is optional so an entry that cannot reach one does not write
     * prose no run can print; passing `false` here is what a `classify` reaching
     * for a sentence its entry never wrote looks like from inside the loop.
     */
    readonly declaresUnparseable?: boolean;
  } = {},
) {
  const evaluated: {
    readonly previous: Fake | null;
    readonly baseRef: string | null;
    readonly changedFiles: readonly string[];
  }[] = [];
  const classified: (boolean | null)[] = [];
  const table = defineProvenanceTable<Fake, FakeVerdict>({
    id: "fake",
    module: "lib/fake-table.ts",
    current: { value: "current" },
    classify: (present) => {
      classified.push(present);
      return over.revision ?? { kind: "table", table: { value: "previous" } };
    },
    evaluate: (input) => {
      evaluated.push({
        previous: input.previous,
        baseRef: input.baseRef,
        changedFiles: input.changedFiles,
      });
      return {
        ok: over.ok ?? true,
        comparedAgainst: input.previous === null ? null : input.baseRef,
        seen: input.previous?.value ?? null,
      };
    },
    report: (checkName, verdict) =>
      `${checkName}: fake report, previous=${verdict.seen ?? "none"}`,
    ...(over.declaresUnparseable === false
      ? {}
      : {
          unparseable: (checkName: string, ref: string) =>
            `${checkName}: fake unparseable at ${ref}`,
        }),
    driftSkipped: (checkName, ref) => `${checkName}: fake drift skipped at ${ref}`,
  });
  return { table, evaluated, classified };
}

/**
 * A source that is PRESENT and yields no table — the one state every `classify`
 * has to name, and the only fixture in this file with a meaning rather than a
 * shape. Four cases had written it out by hand and one of the four had already
 * drifted to a different wording, which is harmless until somebody greps for the
 * others and finds three.
 *
 * It has to be text no parser in the registry can read a table out of, and a
 * comment is the honest version of that: the module is there, somebody's
 * reformat or rename took the table with it.
 */
const PRESENT_AND_UNREADABLE = "// the module was here and its table was not\n";

/**
 * The entries whose `classify` may stop the whole run, written by hand.
 *
 * A DECISION, and the reason it is not derived from `stopsTheRun`: one entry's
 * hard failure suppresses every other table's report, so which entries have
 * that power is a thing somebody chose and should have to re-choose in a diff.
 * `stopsTheRun` is what the code DOES; this is what was agreed. The case
 * holding the two against each other is below, and it is the one nobody had
 * written while both existed.
 */
const HARD_FAILERS = new Set(["body-baselines"]);

const base = (
  over: Partial<ProvenanceBaseRevision> = {},
): ProvenanceBaseRevision => ({
  ref: "abc123",
  present: true,
  source: "whatever the module said there",
  changedFiles: ["PRIVACY.md"],
  ...over,
});

describe("defineProvenanceTable — the six steps, once", () => {
  it("passes the parsed previous table and the diff to the evaluator", () => {
    const { table, evaluated } = fakeTable();
    const outcome = table.run("guard", base());

    assert.deepEqual(evaluated, [
      {
        previous: { value: "previous" },
        baseRef: "abc123",
        changedFiles: ["PRIVACY.md"],
      },
    ]);
    assert.equal(outcome.kind, "evaluated");
    assert.equal(
      outcome.kind === "evaluated" ? outcome.report : null,
      "guard: fake report, previous=previous",
    );
  });

  it("reports the table's own unparseable message and does not evaluate", () => {
    const { table, evaluated } = fakeTable({ revision: { kind: "unparseable" } });
    const outcome = table.run("guard", base());

    assert.equal(outcome.kind, "unparseable");
    assert.equal(
      outcome.kind === "unparseable" ? outcome.message : null,
      "guard: fake unparseable at abc123",
    );
    // The point of the hard failure: a report printed alongside it would be a
    // report from a guard whose drift half is off.
    assert.deepEqual(evaluated, []);
  });

  /**
   * The sentence is optional, and its presence is the whole of `stopsTheRun`.
   *
   * `spec.unparseable` is erased with the generic — no case can read the prose
   * from outside the closure — so an entry that writes one it can never reach
   * ships wording nobody proofreads: the wrong module, the wrong table name, a
   * copy of a neighbour's line, all green. Making the field optional is what
   * lets a collapsed entry decline to write one; `stopsTheRun` is what carries
   * that decision back out to where the registry's cases can hold it against
   * what `run` actually does.
   */
  it("derives stopsTheRun from whether the entry wrote a hard-failure sentence", () => {
    assert.equal(fakeTable().table.stopsTheRun, true);
    assert.equal(
      fakeTable({ declaresUnparseable: false }).table.stopsTheRun,
      false,
    );
  });

  it("refuses in words when a classify reaches for a sentence its entry never wrote", () => {
    // Not reachable from a well-formed entry, and reached with the drift half
    // already off — so falling through to the evaluation would print a pass over
    // a table nothing compared, which is the one ending this guard exists
    // against. It names the entry and the module instead.
    const { table, evaluated } = fakeTable({
      revision: { kind: "unparseable" },
      declaresUnparseable: false,
    });
    const outcome = table.run("guard", base());

    assert.equal(outcome.kind, "unparseable");
    const message = outcome.kind === "unparseable" ? outcome.message : "";
    assert.match(message, /^guard: ERROR — /);
    assert.ok(
      message.includes("fake") && message.includes("lib/fake-table.ts"),
      `the refusal names neither the entry nor its module: ${message}`,
    );
    assert.ok(
      message.includes("abc123"),
      `the refusal does not name the revision it read at: ${message}`,
    );
    assert.deepEqual(evaluated, []);
  });

  it("evaluates the shape half alone when the module was absent at the base", () => {
    const { table, evaluated } = fakeTable({ revision: { kind: "absent" } });
    const outcome = table.run("guard", base());

    assert.deepEqual(evaluated, [
      { previous: null, baseRef: "abc123", changedFiles: ["PRIVACY.md"] },
    ]);
    assert.equal(outcome.kind, "evaluated");
    assert.equal(
      outcome.kind === "evaluated" ? outcome.driftSkipped : null,
      "guard: fake drift skipped at abc123",
    );
  });

  it("says nothing about a skipped drift half when there was no base revision at all", () => {
    const { table, evaluated, classified } = fakeTable();
    const outcome = table.run("guard", base({ ref: null }));

    // Not classified: with no revision there is nothing to have read, and a
    // parser handed a stale `source` would be answering about the wrong commit.
    assert.deepEqual(classified, []);
    assert.deepEqual(evaluated, [
      { previous: null, baseRef: null, changedFiles: [] },
    ]);
    // The script prints ONE line for this case, naming the reason every table
    // sat out; a per-table line here would repeat it N times.
    assert.equal(
      outcome.kind === "evaluated" ? outcome.driftSkipped : "not evaluated",
      null,
    );
  });

  it("keeps the drift-skipped line off a run whose drift half did compare", () => {
    const { table } = fakeTable();
    const outcome = table.run("guard", base());

    assert.equal(
      outcome.kind === "evaluated" ? outcome.driftSkipped : "not evaluated",
      null,
    );
  });

  it("carries the evaluator's verdict out as the outcome's ok", () => {
    for (const ok of [true, false]) {
      const { table } = fakeTable({ ok });
      const outcome = table.run("guard", base());
      assert.equal(outcome.kind === "evaluated" ? outcome.ok : "not evaluated", ok);
    }
  });

  it("hands the presence bit to the table rather than deciding for it", () => {
    for (const present of [true, false]) {
      const { table, classified } = fakeTable();
      table.run("guard", base({ present }));
      assert.deepEqual(classified, [present]);
    }
  });
});

describe("PROVENANCE_TABLES — the registry the guard loops over", () => {
  it("holds every table under a distinct id and a distinct module", () => {
    assert.ok(PROVENANCE_TABLES.length >= 2);
    const ids = PROVENANCE_TABLES.map((table) => table.id);
    const modules = PROVENANCE_TABLES.map((table) => table.module);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(", ")}`);
    assert.equal(
      new Set(modules).size,
      modules.length,
      `two entries name ${modules.join(", ")}`,
    );
  });

  it("names module paths that exist, since the guard asks git for each by name", () => {
    for (const table of PROVENANCE_TABLES) {
      assert.doesNotThrow(
        () => readRepoFile(table.module),
        `${table.id} names ${table.module}, which the guard would ask git to show`,
      );
    }
  });

  it("round-trips each table's own module source back to the table it ships", () => {
    // The one property no fabricated table can stand in for: an entry whose
    // `classify` does not match its `current` compares this checkout against a
    // parse of itself that never equals it, and every run is red for a reason
    // nothing in the message would explain.
    for (const table of PROVENANCE_TABLES) {
      const outcome = table.run("guard", {
        ref: "self",
        present: true,
        source: readRepoFile(table.module),
        changedFiles: [],
      });
      assert.equal(outcome.kind, "evaluated", `${table.id} could not read itself`);
      assert.equal(
        outcome.kind === "evaluated" ? outcome.ok : false,
        true,
        `${table.id} is not clean against its own committed source: ${
          outcome.kind === "evaluated" ? outcome.report : ""
        }`,
      );
      assert.equal(
        outcome.kind === "evaluated" ? outcome.driftSkipped : "not evaluated",
        null,
        `${table.id} failed to parse its own module and skipped its drift half`,
      );
    }
  });

  it("gives each table a drift-skipped line no reader could confuse for another's", () => {
    // Two tables skip independently, and one sentence printed twice with
    // different modules behind it is how somebody concludes the whole guard sat
    // out.
    const lines = PROVENANCE_TABLES.map((table) => {
      const outcome = table.run("guard", {
        ref: "abc123",
        present: false,
        source: null,
        changedFiles: [],
      });
      assert.equal(outcome.kind, "evaluated");
      const line = outcome.kind === "evaluated" ? outcome.driftSkipped : null;
      assert.ok(
        line !== null,
        `${table.id} says nothing when its module is missing at the base`,
      );
      assert.ok(
        (line as string).includes(table.module),
        `${table.id}'s skip line does not name ${table.module}`,
      );
      assert.ok((line as string).includes("abc123"));
      return line as string;
    });
    assert.equal(new Set(lines).size, lines.length);
  });

  /**
   * Every entry declares an `unparseable` sentence and only ONE entry can reach
   * its own.
   *
   * `classify` is where a table decides what "the module was there and yielded
   * nothing" means. The baselines entry calls it `unparseable` — a hard failure
   * that stops the whole run before any report prints. The translation and
   * promise entries collapse it into `absent`, which is a SKIP, and each says
   * why in a comment: their parsers are new and this suite round-trips them on
   * every run, so the reformat-defeats-parser branch cannot fire yet.
   *
   * That collapse was a comment and nothing else. The two cases below make it a
   * fact the registry has to keep: which entries stop the run, and — for the one
   * that does — that its refusal is a sentence a reader can act on. Flipping
   * either direction is then a decision visible in a diff, which matters more
   * than usual here because ONE entry's hard failure suppresses every other
   * table's report.
   *
   * `spec.unparseable` is erased by `defineProvenanceTable` and reachable only
   * through `run`, so no case out here can read the WORDING of a sentence. What
   * it can read is whether one was written — `stopsTheRun` — and the second case
   * below holds that against what `run` actually does, in both directions. That
   * closes the gap this pair used to note as its limit: a sentence written for a
   * `classify` that can never produce one is now red rather than unreadable.
   */
  it("stops the run on an unreadable module for exactly the entries that say so", () => {
    // A source that is present and yields no table — the state each `classify`
    // has to name. Asserted per id rather than counted, because "one of the
    // three" is the fact and WHICH one is the decision.
    for (const table of PROVENANCE_TABLES) {
      const outcome = table.run("guard", {
        ref: "abc123",
        present: true,
        source: PRESENT_AND_UNREADABLE,
        changedFiles: [],
      });
      if (HARD_FAILERS.has(table.id)) {
        assert.equal(
          outcome.kind,
          "unparseable",
          `${table.id} stopped classifying an unreadable module as a hard failure — its unparseable sentence is now prose no run can reach`,
        );
        continue;
      }
      assert.equal(
        outcome.kind,
        "evaluated",
        `${table.id} now stops the whole run on an unreadable module, which suppresses every other table's report — deliberate? then add it to HARD_FAILERS and say why beside its classify`,
      );
      assert.notEqual(
        outcome.kind === "evaluated" ? outcome.driftSkipped : null,
        null,
        `${table.id} collapses unparseable into absent and then says nothing about having skipped, so a reader sees a pass over a table nothing compared`,
      );
    }
  });

  it("declares a hard-failure sentence exactly where one can be printed", () => {
    // The written-but-unreachable state, made visible. `stopsTheRun` is the
    // presence of the sentence and the outcome is what `classify` does with an
    // unreadable module; they are two readings of one decision, and the whole
    // point of the field is that they can be compared from out here.
    for (const table of PROVENANCE_TABLES) {
      const outcome = table.run("guard", {
        ref: "abc123",
        present: true,
        source: PRESENT_AND_UNREADABLE,
        changedFiles: [],
      });
      assert.equal(
        outcome.kind === "unparseable",
        table.stopsTheRun,
        table.stopsTheRun
          ? `${table.id} declares an unparseable sentence its classify can never reach — prose no run prints and no case proofreads; delete it or give the entry the three-way classification`
          : `${table.id} stops the run on an unreadable module without declaring the sentence that explains it, so the guard halts with a registry bug in place of a diagnosis`,
      );
    }
  });

  it("agrees with the recorded decision about which entries may stop the run", () => {
    // The two statements of one fact, held against each other — the case that
    // was missing while both existed. `stopsTheRun` is derived from whether the
    // entry wrote a sentence; `HARD_FAILERS` is the decision that it may. A
    // fourth table declaring an unparseable sentence is now a red case naming
    // the id rather than a quiet fourth entry with the power to suppress every
    // other table's report.
    assert.deepEqual(
      PROVENANCE_TABLES.filter((table) => table.stopsTheRun)
        .map((table) => table.id)
        .sort(),
      [...HARD_FAILERS].sort(),
      "the entries that declare a hard-failure sentence are no longer the entries agreed to have one — either the decision moved and HARD_FAILERS has not, or a spec grew an unparseable sentence nobody argued for",
    );
  });

  it("is swept with a fixture no parser can read, which is a claim about the PARSERS", () => {
    // `PRESENT_AND_UNREADABLE` stands in for three parsers' failure in four
    // cases, and it works because none of the three can read a table out of a
    // bare comment — a property of the parsers, not of the fixture. A parser
    // that one day accepted an empty table would read it as a legitimate empty
    // result, and those four cases would keep passing while testing nothing
    // they claim to.
    //
    // The control: each entry's OWN module, which its parser can read. An
    // evaluated outcome that did not skip the drift half is the parser saying
    // it found a table, and it is the outcome the fixture must not produce.
    for (const table of PROVENANCE_TABLES) {
      const read = table.run("guard", {
        ref: "abc123",
        present: true,
        source: readRepoFile(table.module),
        changedFiles: [],
      });
      assert.equal(
        read.kind,
        "evaluated",
        `${table.id}'s parser could not read ${table.module}, its own module — so the unreadable fixture proves nothing about it`,
      );
      assert.equal(
        read.kind === "evaluated" ? read.driftSkipped : "skipped",
        null,
        `${table.id} skipped the drift half against its own module, so "the parser read a table" and "the parser did not" are the same outcome and the fixture cannot tell them apart`,
      );
      const unread = table.run("guard", {
        ref: "abc123",
        present: true,
        source: PRESENT_AND_UNREADABLE,
        changedFiles: [],
      });
      assert.notEqual(
        unread.kind === "evaluated" && unread.driftSkipped === null,
        true,
        `${table.id} read a table out of ${JSON.stringify(PRESENT_AND_UNREADABLE)} — the fixture four cases lean on is no longer unreadable`,
      );
    }
  });

  it("refuses in words that name the module and the revision it could not read", () => {
    // The one reachable unparseable sentence, held to what the drift-skipped
    // lines are already held to. It is the message that stops a run, so a reader
    // meeting it has no other line to work out which module and which base
    // revision the guard was looking at.
    const outcome = PROVENANCE_TABLES.find(
      (table) => table.id === "body-baselines",
    )?.run("guard", {
      ref: "abc123",
      present: true,
      source: PRESENT_AND_UNREADABLE,
      changedFiles: [],
    });
    assert.equal(outcome?.kind, "unparseable");
    const message = outcome?.kind === "unparseable" ? outcome.message : "";
    assert.match(message, /^guard: ERROR — /);
    assert.ok(
      message.includes("lib/privacy-body-baselines.ts"),
      `the refusal does not name the module it could not read: ${message}`,
    );
    assert.ok(
      message.includes("abc123"),
      `the refusal does not name the revision it read at: ${message}`,
    );
  });

  it("is fit to run as it stands", () => {
    assert.equal(provenanceRegistryRefusal("guard", PROVENANCE_TABLES), null);
  });

  it("refuses an empty registry rather than passing over zero tables", () => {
    // The one failure mode the loop introduced: two hand-written passes could
    // not skip themselves, and `every` over nothing is true.
    const refusal = provenanceRegistryRefusal("guard", []);
    assert.ok(refusal !== null);
    assert.match(refusal, /^guard: ERROR — /);
    assert.match(refusal, /zero tables is not a pass/);
    assert.match(refusal, /lib\/provenance-tables\.ts/);
  });

  it("refuses two entries registered under one id", () => {
    const [first] = PROVENANCE_TABLES;
    const refusal = provenanceRegistryRefusal("guard", [
      first,
      { ...first, module: "lib/somewhere-else.ts" },
    ]);
    assert.ok(refusal !== null);
    assert.ok(
      refusal.includes(`"${first.id}"`),
      `the refusal does not name the duplicated id: ${refusal}`,
    );
  });

  it("accepts the shape a repo-root `git diff --name-only` emits", () => {
    assert.equal(
      changedFilesRefusal("guard", [
        "PRIVACY.md",
        "PRIVACY.md.de",
        "lib/privacy-body-baselines.ts",
        "__tests__/helpers/repo-file.ts",
      ]),
      null,
    );
    // Nothing touched is not this rule's business: each table already reads an
    // empty diff as "the file did not move".
    assert.equal(changedFilesRefusal("guard", []), null);
  });

  it("refuses a diff that cannot match a recorded path", () => {
    // Both shapes a real caller produces: absolute paths, and paths re-anchored
    // by a `git diff` run somewhere other than the repository root. Either one
    // makes every lookup miss, so every value that moved is reported as
    // describing an untouched file.
    for (const file of [
      "/home/runner/work/collectables/PRIVACY.md",
      "C:/repo/PRIVACY.md",
      "./PRIVACY.md",
      "../collectables/PRIVACY.md",
      "..",
      "",
    ]) {
      const refusal = changedFilesRefusal("guard", [file]);
      assert.ok(
        refusal !== null,
        `${JSON.stringify(file)} passed as a repo-relative path`,
      );
      assert.match(refusal, /^guard: ERROR — /);
    }
  });

  it("leaves a legal posix filename alone, backslashes and all", () => {
    // Git emits forward slashes on Windows too, so a backslash here is a legal
    // filename or one of git's quoted `"…\303\251…"` paths. A guard that
    // refused to run because somebody added a file with an accent in its name
    // is a guard that gets deleted.
    assert.equal(
      changedFilesRefusal("guard", [
        "docs/a\\b.md",
        '"PRIVACY.md.\\303\\251"',
        "lib/.hidden.ts",
        "a..b/PRIVACY.md",
      ]),
      null,
    );
  });

  it("says what the guard would have concluded, not just that a path is odd", () => {
    const refusal = changedFilesRefusal("guard", ["/abs/PRIVACY.md", "lib/x.ts"]);
    assert.ok(refusal !== null);
    // The count is of OFFENDERS against the whole list, because "1 of 2" and
    // "2 of 2" are different diagnoses.
    assert.match(refusal, /1 of 2 changed-file path\(s\)/);
    assert.match(refusal, /"\/abs\/PRIVACY\.md"/);
    assert.match(refusal, /untouched file/);
    assert.match(refusal, /repository root/);
  });

  it("quotes a few offenders rather than the whole diff", () => {
    // The failure is systematic — a diff resolved against the wrong root makes
    // every entry wrong — so the first few are the diagnosis and the rest is
    // scroll.
    const files = Array.from({ length: 40 }, (_, index) => `/abs/${index}.md`);
    const refusal = changedFilesRefusal("guard", files);
    assert.ok(refusal !== null);
    assert.match(refusal, /40 of 40 changed-file path\(s\)/);
    assert.match(refusal, /and 37 more/);
    assert.ok(
      !refusal.includes("/abs/39.md"),
      `the refusal quoted the whole diff: ${refusal}`,
    );
  });

  it("is checked by the script before any table reads the list", () => {
    // The rule is only worth having if it runs first: reached after the loop, it
    // would print its explanation under six failures it exists to prevent.
    const script = stripComments(
      readRepoFile("scripts/check-privacy-baseline-provenance.ts"),
    );
    const refusalAt = script.indexOf("changedFilesRefusal(CHECK_NAME");
    const loopAt = script.indexOf("PROVENANCE_TABLES.map");
    assert.ok(refusalAt !== -1, "the script does not call changedFilesRefusal");
    assert.ok(
      refusalAt < loopAt,
      "the script checks the diff shape after running the tables over it",
    );
  });

  it("keeps the shape half running when there is no base revision", () => {
    for (const table of PROVENANCE_TABLES) {
      const outcome = table.run("guard", {
        ref: null,
        present: false,
        source: null,
        changedFiles: [],
      });
      assert.equal(outcome.kind, "evaluated");
      assert.equal(
        outcome.kind === "evaluated" ? outcome.ok : false,
        true,
        `${table.id} is not well-formed as it stands`,
      );
    }
  });
});

describe("the real entries and the places they disagree", () => {
  const entry = (id: string): ProvenanceTable => {
    const table = PROVENANCE_TABLES.find((candidate) => candidate.id === id);
    assert.ok(table !== undefined, `no ${id} entry in PROVENANCE_TABLES`);
    return table;
  };

  const mangled = (table: ProvenanceTable) =>
    table.run("guard", {
      ref: "abc123",
      present: true,
      source: PRESENT_AND_UNREADABLE,
      changedFiles: [],
    });

  it("fails the baselines table when its module exists at the base and yields nothing", () => {
    const outcome = mangled(entry("body-baselines"));
    assert.equal(outcome.kind, "unparseable");
    assert.match(
      outcome.kind === "unparseable" ? outcome.message : "",
      /PRIVACY_BODY_BASELINES table could be read/,
    );
    assert.match(
      outcome.kind === "unparseable" ? outcome.message : "",
      /lib\/privacy-body-baselines\.ts/,
    );
  });

  it("skips the translation table in the same case, deliberately and not by omission", () => {
    // The divergence the module note argues for: this parser is young and the
    // suite round-trips it every run, so the reformat-defeats-parser branch
    // cannot fire yet. Pinned so that closing the gap later is a decision
    // somebody makes out loud rather than a diff nobody notices.
    const outcome = mangled(entry("translation-sources"));
    assert.equal(outcome.kind, "evaluated");
    assert.equal(
      outcome.kind === "evaluated" ? outcome.driftSkipped : null,
      "guard: translation-checksum drift skipped — no lib/privacy-translated-section.ts table was readable at abc123, so the guard predates it.",
    );
  });

  it("reports over the tables this checkout actually ships, in the order it declares", () => {
    // A registry entry pointed at an empty table would pass every ordering case
    // above and check nothing. An ORDERED list, because the declaration order is
    // the reporting order — `__tests__/privacy-baseline-provenance-script.test.ts`
    // pins that the script honours it — and an array literal is a much easier
    // thing to reorder by accident than two statements were. Held exhaustive in
    // both directions, so a fourth entry cannot arrive with no evidence line and
    // nothing saying so.
    const evidence: readonly { readonly id: string; readonly shows: string }[] = [
      {
        id: "body-baselines",
        shows: String(Object.keys(PRIVACY_BODY_BASELINES).length),
      },
      {
        id: "translation-sources",
        shows: String(Object.keys(PRIVACY_TRANSLATION_SOURCES).length),
      },
      { id: "scrub-promise", shows: "scrub-promise fingerprint" },
    ];
    assert.deepEqual(
      PROVENANCE_TABLES.map((table) => table.id),
      evidence.map(({ id }) => id),
      "the registry's contents or its order changed; both are load-bearing, so say so here too",
    );
    for (const { id, shows } of evidence) {
      const outcome = entry(id).run("guard", {
        ref: null,
        present: false,
        source: null,
        changedFiles: [],
      });
      assert.ok(
        outcome.kind === "evaluated" && outcome.report.includes(shows),
        `${id}'s report does not show "${shows}": ${
          outcome.kind === "evaluated" ? outcome.report : "not evaluated"
        }`,
      );
    }
  });
});

/**
 * One name for the English policy path.
 *
 * Every evaluator here compares a recorded value's provenance against
 * `git diff --name-only` output, which means every one of them has to spell the
 * path of the file its value was measured from. `privacyPolicySourcePath` is
 * that answer, and it was already being bypassed for the English page inside a
 * two-element array whose OTHER element called it — which is how one of two
 * adjacent lines stops being true.
 */
describe("the file a provenance value is measured from", () => {
  /** The evaluators that compare a path against a git diff. */
  const EVALUATORS = [
    "lib/privacy-baseline-provenance.ts",
    "lib/privacy-translation-provenance.ts",
    "lib/scrub-promise-provenance.ts",
  ];

  it("has one name, which the scrub-promise table uses", () => {
    assert.equal(
      SCRUB_PROMISE_SOURCE_FILE,
      privacyPolicySourcePath(PRIVACY_DEFAULT_LANGUAGE),
    );
    // Repo-relative and posix-separated, because that is what it is compared
    // against.
    assert.equal(SCRUB_PROMISE_SOURCE_FILE, "PRIVACY.md");
  });

  it("is spelled out in no evaluator, so a rename has one place to reach", () => {
    // Comments stripped: two of these files discuss the path in prose, and a
    // sweep that read prose would report the explanation rather than the copy.
    const offenders = EVALUATORS.filter((module) =>
      stripComments(readRepoFile(module)).includes('"PRIVACY.md"'),
    );
    assert.deepEqual(
      offenders,
      [],
      `these modules spell the English policy path instead of asking privacyPolicySourcePath for it: ${offenders.join(", ")}`,
    );
    // The sweep's own positive control: the helper that OWNS the literal still
    // has it, so a pattern that stopped matching anything cannot pass as clean.
    assert.ok(
      stripComments(readRepoFile("lib/privacy-body-baselines.ts")).includes(
        '"PRIVACY.md"',
      ),
      "the sweep above matches nothing at all, so it would report a clean tree whatever the evaluators say",
    );
  });
});
