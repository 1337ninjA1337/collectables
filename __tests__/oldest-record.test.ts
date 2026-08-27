import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { oldestRecord, unknownKeysRefusal } from "../lib/oldest-record";
import {
  PRIVACY_BODY_BASELINES,
  privacyPolicySourcePath,
} from "../lib/privacy-body-baselines";
import {
  evaluatePrivacyBaselineProvenance,
  formatBaselineProvenanceReport,
} from "../lib/privacy-baseline-provenance";
import { PRIVACY_PAGE_LANGUAGES } from "../lib/privacy-languages";
import { PRIVACY_TRANSLATION_SOURCES } from "../lib/privacy-translated-section";
import {
  evaluateTranslationProvenance,
  formatTranslationProvenanceReport,
} from "../lib/privacy-translation-provenance";
import { PROVENANCE_TABLES } from "../lib/provenance-tables";
import { formatScrubPromiseProvenanceReport } from "../lib/scrub-promise-provenance";
import { SCRUB_PROMISE_BASELINE } from "../lib/sentry-scrub-promises";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The walk three provenance guards share, and the parity it was extracted for.
 *
 * Each table records a date per entry and each guard exists to catch a value
 * that moved without saying why — a FAILURE question, which leaves a green run
 * unable to tell a page confirmed this morning from one confirmed a year ago
 * against a section nothing has touched since. Publishing the oldest date on the
 * pass line is the answer, and it is one walk that differs only in what the date
 * field is called.
 *
 * Two claims are pinned below and they are different. That the walk picks the
 * right entry and reads its order from the caller's list rather than the object
 * literal — over fabricated tables, because a tie-break should not need a legal
 * document to state it. And that all three shipped pass lines actually carry an
 * age, which is the parity the extraction was for: one line that is different is
 * read as the only one with an age at all.
 */

type Dated = { readonly on: string; readonly extra?: number };

const on = (date: string): Dated => ({ on: date });
const dateOf = (entry: Dated) => entry.on;

describe("oldestRecord", () => {
  it("picks the earliest date in the table", () => {
    assert.deepEqual(
      oldestRecord(
        { a: on("2026-08-11"), b: on("2025-03-04"), c: on("2026-01-02") },
        dateOf,
        ["a", "b", "c"],
      ),
      { recordedOn: "2025-03-04", keys: ["b"], unknownKeys: [] },
    );
  });

  it("names every key sharing the oldest date, not one of them", () => {
    // A table recorded in one sitting has every entry on the same day, and a
    // line naming one of six would read as a fact about that one entry.
    assert.deepEqual(
      oldestRecord({ a: on("2026-01-02"), b: on("2026-01-02") }, dateOf, [
        "a",
        "b",
      ]),
      { recordedOn: "2026-01-02", keys: ["a", "b"], unknownKeys: [] },
    );
  });

  it("reads its order from the caller's list, not from the object literal", () => {
    // The order a reader sees must not depend on how somebody happened to type
    // the table, or the line changes for no reason visible in the diff.
    const oldest = oldestRecord(
      { c: on("2026-01-02"), a: on("2026-01-02"), b: on("2026-01-02") },
      dateOf,
      ["a", "b", "c"],
    );
    assert.deepEqual(oldest?.keys, ["a", "b", "c"]);
  });

  it("keeps an unknown key out of the date as well as out of the keys, and names it", () => {
    // This case used to assert `{ recordedOn: "2020-01-01", keys: [] }` and
    // call it safe: the date was the minimum over EVERY entry while the keys
    // were filtered by `order`, so a table whose oldest entry sat under a key
    // the order did not know rendered an age attributed to nothing. The two
    // halves agree now, and the key that was silently setting the date is
    // reported instead of dropped.
    assert.deepEqual(
      oldestRecord({ a: on("2026-01-02"), zz: on("2020-01-01") }, dateOf, ["a"]),
      { recordedOn: "2026-01-02", keys: ["a"], unknownKeys: ["zz"] },
    );
  });

  it("answers null when the order knows no entry, not only when the table is empty", () => {
    assert.equal(oldestRecord({}, dateOf, ["a"]), null);
    // The other way to have nothing to say: entries exist and none of them is
    // a key this order can speak about. Both are failures for every caller —
    // an empty table fails its own count, an unknown key fails the shape half.
    assert.equal(oldestRecord({ zz: on("2020-01-01") }, dateOf, ["a"]), null);
  });

  it("ignores an order entry the table does not carry", () => {
    // The mirror of the unknown key, and it is not a failure: an order is a
    // constant listing every language, and a table missing one is the shape
    // half's business rather than this walk's.
    assert.deepEqual(
      oldestRecord({ a: on("2026-01-02") }, dateOf, ["a", "b"]),
      { recordedOn: "2026-01-02", keys: ["a"], unknownKeys: [] },
    );
  });

  it("compares the dates as strings, which is what YYYY-MM-DD is for", () => {
    // Deliberately no Date parsing: these guards take no clock, and string order
    // is the total order the format already has.
    assert.deepEqual(
      oldestRecord({ a: on("2026-09-01"), b: on("2026-10-01") }, dateOf, [
        "a",
        "b",
      ])?.recordedOn,
      "2026-09-01",
    );
  });
});

describe("unknownKeysRefusal — the field's first reader", () => {
  it("says nothing when the walk spoke for every key", () => {
    // The usual answer, and the reason the callers can put it in front of the
    // pass line without the pass line becoming conditional prose.
    assert.equal(unknownKeysRefusal("TABLE", "ORDER", []), null);
  });

  it("names the table, the order and every key that was left out", () => {
    const refusal = unknownKeysRefusal("TABLE", "ORDER", ["zz", "qq"]);
    assert.ok(refusal !== null);
    assert.ok(
      refusal.includes("TABLE") && refusal.includes("ORDER"),
      `the refusal does not say which table and which order disagreed: ${refusal}`,
    );
    assert.ok(
      refusal.includes('"zz"') && refusal.includes('"qq"'),
      `the refusal does not name the keys nobody walked: ${refusal}`,
    );
  });

  it("carries no check-name prefix, because the module is a leaf", () => {
    // `lib/oldest-record.ts` imports nothing so that any evaluator may use it
    // and it can never close a cycle — `checkError` belongs to the callers, and
    // a refusal that prefixed itself would be prefixed twice.
    const refusal = unknownKeysRefusal("TABLE", "ORDER", ["zz"]);
    assert.ok(refusal !== null);
    assert.doesNotMatch(refusal, /ERROR — /);
    assert.doesNotMatch(
      readRepoFile("lib/oldest-record.ts"),
      /^import /m,
      "lib/oldest-record.ts grew an import, so it is no longer the leaf every evaluator can reach for",
    );
  });

  it("tells the reader the half that should have caught this first", () => {
    // The refusal is unreachable through any caller in this repository and that
    // is the claim, not a caveat: somebody who sees it is looking at a guard
    // whose shape half stopped checking its keys, and the message has to say so
    // or it reads as a bug in the age.
    const refusal = unknownKeysRefusal("TABLE", "ORDER", ["zz"]);
    assert.match(refusal ?? "", /shape half/);
  });
});

describe("a pass line refuses to publish an age it measured over a subset", () => {
  /**
   * `unknownLanguages` was carried through two result types and read by
   * nothing — the safety was a property of the CALLERS, asserted in two suites
   * and enforced nowhere. It is enforced by the formatters now, so the cases
   * below build the state the shape half makes unreachable and check the words
   * a reader would actually meet.
   */
  it("refuses the baselines pass line and names the unwalked language", () => {
    const report = formatBaselineProvenanceReport("guard", {
      ok: true,
      failures: [],
      checked: 6,
      comparedAgainst: "abc123",
      oldest: {
        recordedOn: "2026-01-02",
        languages: ["en"],
        unknownLanguages: ["zz"],
      },
    });
    assert.match(report, /^guard: ERROR — /);
    assert.ok(
      report.includes("PRIVACY_BODY_BASELINES") && report.includes('"zz"'),
      `the refusal does not name the table and the key: ${report}`,
    );
    assert.doesNotMatch(
      report,
      /well-formed/,
      `the pass line printed anyway, so the age was published over a subset: ${report}`,
    );
  });

  it("refuses the translation pass line and names the unwalked language", () => {
    const report = formatTranslationProvenanceReport("guard", {
      ok: true,
      failures: [],
      checked: 5,
      comparedAgainst: "abc123",
      oldest: {
        checkedOn: "2026-01-02",
        languages: ["ru"],
        unknownLanguages: ["zz"],
      },
    });
    assert.match(report, /^guard: ERROR — /);
    assert.ok(
      report.includes("PRIVACY_TRANSLATION_SOURCES") && report.includes('"zz"'),
      `the refusal does not name the table and the key: ${report}`,
    );
    assert.doesNotMatch(
      report,
      /well-formed/,
      `the pass line printed anyway, so the age was published over a subset: ${report}`,
    );
  });

  it("leaves the pass line alone when every key was walked", () => {
    // The negative control the two refusals need: a formatter that refused
    // unconditionally would pass both cases above and turn every real run red.
    const report = formatBaselineProvenanceReport("guard", {
      ok: true,
      failures: [],
      checked: 6,
      comparedAgainst: "abc123",
      oldest: {
        recordedOn: "2026-01-02",
        languages: ["en"],
        unknownLanguages: [],
      },
    });
    assert.match(report, /well-formed/);
    assert.match(report, /Oldest record 2026-01-02 \(en\)/);
  });

  it("is not reachable through either evaluator, which is the point", () => {
    // The shape half fails an unknown language first, so the refusal above is
    // the second line of defence rather than a live branch. Asserting it here
    // keeps "unreachable" a checked fact: an evaluator that stopped checking
    // its keys would turn this red beside the refusal it made reachable.
    for (const [table, evaluate] of [
      [
        "PRIVACY_BODY_BASELINES",
        () =>
          evaluatePrivacyBaselineProvenance({
            current: { ...PRIVACY_BODY_BASELINES, zz: PRIVACY_BODY_BASELINES.en },
            previous: null,
            baseRef: null,
            changedFiles: [],
          }),
      ],
      [
        "PRIVACY_TRANSLATION_SOURCES",
        () =>
          evaluateTranslationProvenance({
            current: {
              ...PRIVACY_TRANSLATION_SOURCES,
              zz: PRIVACY_TRANSLATION_SOURCES.ru,
            },
            previous: null,
            baseRef: null,
            changedFiles: [],
          }),
      ],
    ] as const) {
      const result = evaluate();
      assert.equal(
        result.ok,
        false,
        `${table} accepted a key its order does not know, so the pass-line refusal is now the only thing standing between an unknown key and an age measured over a subset`,
      );
      assert.deepEqual(
        result.oldest?.unknownLanguages,
        ["zz"],
        `${table}'s walk did not report the unknown key it was handed`,
      );
    }
  });
});

describe("every provenance pass line publishes an age", () => {
  /**
   * Three tables, three pass lines, and the reason this case is written over all
   * three at once: the translations table published its age first and alone, and
   * a reader scanning three green lines reads the one that is different as the
   * only one with an age to give.
   *
   * The lines are rendered from the SHIPPED tables rather than from fixtures, so
   * this also fails if a real table's date stops being renderable.
   */
  const PASS_LINES: readonly { readonly id: string; readonly line: string }[] = [
    {
      id: "body-baselines",
      line: formatBaselineProvenanceReport("guard", {
        ok: true,
        failures: [],
        checked: Object.keys(PRIVACY_BODY_BASELINES).length,
        comparedAgainst: "abc123",
        oldest: {
          recordedOn: "2026-08-11",
          languages: PRIVACY_PAGE_LANGUAGES.map((language) => language.code),
          unknownLanguages: [],
        },
      }),
    },
    {
      id: "translation-sources",
      line: formatTranslationProvenanceReport("guard", {
        ok: true,
        failures: [],
        checked: Object.keys(PRIVACY_TRANSLATION_SOURCES).length,
        comparedAgainst: "abc123",
        oldest: { checkedOn: "2026-08-22", languages: ["ru"], unknownLanguages: [] },
      }),
    },
    {
      id: "scrub-promise",
      line: formatScrubPromiseProvenanceReport("guard", {
        ok: true,
        failures: [],
        comparedAgainst: "abc123",
        recordedOn: SCRUB_PROMISE_BASELINE.recordedOn,
      }),
    },
  ];

  it("renders a YYYY-MM-DD on each of the three", () => {
    for (const { id, line } of PASS_LINES) {
      assert.match(
        line,
        /\b\d{4}-\d{2}-\d{2}\b/,
        `${id}'s pass line prints a count and no age: ${line}`,
      );
    }
  });

  it("covers every registered table, so a fourth is not quietly exempt", () => {
    assert.deepEqual(
      PASS_LINES.map(({ id }) => id).sort(),
      PROVENANCE_TABLES.map((table) => table.id).sort(),
    );
  });

  it("says it in words a reader meets once, not three different ones", () => {
    // Not required to be IDENTICAL — one record has an age and two tables have an
    // oldest, which is a real difference — but each has to be a sentence rather
    // than a bare date appended to a parenthesis.
    for (const { id, line } of PASS_LINES) {
      assert.match(
        line,
        /\.\s(Oldest (record|confirmation)|Recorded)\s/,
        `${id}'s age is not a sentence of its own: ${line}`,
      );
    }
  });

  it("is measured from files that exist, for the two tables keyed by language", () => {
    // Cheap parity with the rest of the suite: a language whose page is gone
    // would still contribute a date to a pass line nobody could act on.
    for (const code of Object.keys(PRIVACY_BODY_BASELINES)) {
      assert.doesNotThrow(() => privacyPolicySourcePath(code), code);
    }
  });
});
