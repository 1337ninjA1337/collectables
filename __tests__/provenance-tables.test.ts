import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PRIVACY_BODY_BASELINES } from "../lib/privacy-body-baselines";
import { PRIVACY_TRANSLATION_SOURCES } from "../lib/privacy-translated-section";
import {
  PROVENANCE_TABLES,
  defineProvenanceTable,
  provenanceRegistryRefusal,
  type ProvenanceBaseRevision,
  type ProvenanceRevision,
  type ProvenanceTable,
  type ProvenanceVerdict,
} from "../lib/provenance-tables";

import { PRIVACY_DEFAULT_LANGUAGE } from "../lib/privacy-page";
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
    unparseable: (checkName, ref) => `${checkName}: fake unparseable at ${ref}`,
    driftSkipped: (checkName, ref) => `${checkName}: fake drift skipped at ${ref}`,
  });
  return { table, evaluated, classified };
}

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
      source: "// the module was here and the table was not\n",
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
