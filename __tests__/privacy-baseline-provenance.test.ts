import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { LINT_GUARDS } from "../lib/lint-guards";
import {
  PRIVACY_BASELINE_NOTE_MIN_WORDS,
  classifyBaselineRevision,
  evaluatePrivacyBaselineDrift,
  evaluatePrivacyBaselineProvenance,
  evaluatePrivacyBaselineShape,
  formatBaselineProvenanceFailure,
  formatBaselineProvenanceReport,
  formatBaselineRevisionUnparseable,
  type BaselineProvenanceFailureCode,
} from "../lib/privacy-baseline-provenance";
import {
  PRIVACY_BODY_BASELINES,
  PRIVACY_BODY_BASELINE_WORDS,
  parsePrivacyBodyBaselines,
  privacyPolicySourcePath,
  type PrivacyBodyBaseline,
} from "../lib/privacy-body-baselines";
import { PRIVACY_PAGE_LANGUAGES } from "../lib/privacy-languages";

import { readRepoFile, repoPath } from "./helpers/repo-file";

/**
 * Pins the guard that stops a policy-size baseline changing quietly.
 *
 * The drift gate in `lib/bundle-smoke.ts` has one soft spot and it is not the
 * measurement — a number that does not match the tracked markdown already fails
 * `bundle-smoke.test.ts`. It is the number changed for the wrong reason: the
 * documented fix for a red drift gate is "paste the measured count in", so a
 * truncating merge resolved that way disables the gate in one commit. These
 * suites cover the two halves that make such a commit visible: the table's own
 * shape (a real date, a note that says something) and the comparison against
 * its previous revision.
 */


const baseline = (over: Partial<PrivacyBodyBaseline> = {}): PrivacyBodyBaseline => ({
  words: 200,
  recordedOn: "2026-08-11",
  note: "First recorded size of this policy file.",
  ...over,
});

const codesOf = (
  failures: readonly { readonly code: BaselineProvenanceFailureCode }[],
): readonly BaselineProvenanceFailureCode[] => failures.map((f) => f.code);

describe("PRIVACY_BODY_BASELINES — the shipped table", () => {
  it("carries an entry for every language the /privacy page is offered in", () => {
    assert.deepEqual(
      Object.keys(PRIVACY_BODY_BASELINES).sort(),
      PRIVACY_PAGE_LANGUAGES.map((language) => language.code).sort(),
    );
  });

  it("is well-formed by its own guard", () => {
    // The guard runs over this exact object in CI; asserting it here means a
    // bad entry fails in the second leg rather than the lint fan-out.
    assert.deepEqual(evaluatePrivacyBaselineShape(PRIVACY_BODY_BASELINES), []);
  });

  it("derives PRIVACY_BODY_BASELINE_WORDS from the same entries", () => {
    // Two hand-maintained tables of the same six numbers is the drift the
    // derivation exists to prevent; this pins that it stayed derived.
    for (const [code, entry] of Object.entries(PRIVACY_BODY_BASELINES)) {
      assert.equal(PRIVACY_BODY_BASELINE_WORDS[code], entry.words);
    }
    assert.deepEqual(
      Object.keys(PRIVACY_BODY_BASELINE_WORDS).sort(),
      Object.keys(PRIVACY_BODY_BASELINES).sort(),
    );
  });

  it("points every language at a policy file that exists", () => {
    for (const { code } of PRIVACY_PAGE_LANGUAGES) {
      const rel = privacyPolicySourcePath(code);
      assert.equal(rel, code === "en" ? "PRIVACY.md" : `PRIVACY.md.${code}`);
      assert.ok(
        fs.existsSync(repoPath(rel)),
        `${code}: baseline describes a missing file (${rel})`,
      );
    }
  });

  it("refuses to name a policy file for a language nothing publishes", () => {
    // The failure this closes is a SILENT one, which is why it is a throw. Every
    // caller hands the returned name to a set of files a diff touched; a path
    // that never existed is reported absent, the caller concludes "untouched",
    // and a guard whose whole job is to notice that a file did not move gives
    // its right answer for the wrong reason.
    for (const code of ["de-DE", "EN", "fr", ""]) {
      assert.throws(
        () => privacyPolicySourcePath(code),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /no privacy page is published/);
          // The known set, so the reader does not have to find the list.
          for (const { code: known } of PRIVACY_PAGE_LANGUAGES) {
            assert.ok(
              error.message.includes(known),
              `the refusal does not name the known code ${known}: ${error.message}`,
            );
          }
          return true;
        },
        `privacyPolicySourcePath("${code}") answered instead of refusing`,
      );
    }
  });
});

describe("parsePrivacyBodyBaselines", () => {
  it("round-trips the tracked module — the parser and the format cannot drift", () => {
    // The guard reads the PREVIOUS revision of this file as text, so a
    // reformat that defeats the regex would silently turn the drift half off.
    // Parsing the file on disk and comparing against the imported object makes
    // that reformat fail on the commit that does it.
    const source = readRepoFile("lib/privacy-body-baselines.ts");
    assert.deepEqual(parsePrivacyBodyBaselines(source), {
      ...PRIVACY_BODY_BASELINES,
    });
  });

  it("returns null when the declaration is absent", () => {
    // A revision predating the module: the caller skips the drift half rather
    // than reporting six changes against an empty table.
    assert.equal(parsePrivacyBodyBaselines("export const OTHER = {};\n"), null);
  });

  it("returns null when the declaration is there but holds no entries", () => {
    assert.equal(
      parsePrivacyBodyBaselines("export const PRIVACY_BODY_BASELINES = {\n};\n"),
      null,
    );
  });

  it("unescapes a quote inside a note", () => {
    const parsed = parsePrivacyBodyBaselines(
      'export const PRIVACY_BODY_BASELINES = {\n  en: { words: 12, recordedOn: "2026-01-02", note: "dropped the \\"analytics\\" section" },\n};\n',
    );
    assert.deepEqual(parsed, {
      en: {
        words: 12,
        recordedOn: "2026-01-02",
        note: 'dropped the "analytics" section',
      },
    });
  });

  it("stops at the declaration's closing brace", () => {
    // A later constant of the same shape must not be folded into the table.
    const parsed = parsePrivacyBodyBaselines(
      'export const PRIVACY_BODY_BASELINES = {\n  en: { words: 12, recordedOn: "2026-01-02", note: "a" },\n};\nexport const OTHER = {\n  de: { words: 9, recordedOn: "2026-01-02", note: "b" },\n};\n',
    );
    assert.deepEqual(Object.keys(parsed ?? {}), ["en"]);
  });
});

describe("classifyBaselineRevision", () => {
  const table =
    'export const PRIVACY_BODY_BASELINES = {\n  en: { words: 12, recordedOn: "2026-01-02", note: "a" },\n};\n';

  it("reads a table when the module was there and parses", () => {
    const revision = classifyBaselineRevision(true, table);
    assert.equal(revision.kind, "table");
    assert.deepEqual(Object.keys(revision.kind === "table" ? revision.table : {}), [
      "en",
    ]);
  });

  it("calls a path that did not exist ABSENT — the guard predates it", () => {
    // The only case a skip is correct for, including the commit that
    // introduced the module (which would otherwise fail its own guard).
    assert.deepEqual(classifyBaselineRevision(false, null), { kind: "absent" });
  });

  it("calls a path that existed and yielded nothing UNPARSEABLE, not absent", () => {
    // A removal, a rename, or a reformat that defeats the parser — the way the
    // drift half gets turned off for good, one skip line at a time.
    assert.deepEqual(classifyBaselineRevision(true, "export const OTHER = {};"), {
      kind: "unparseable",
    });
    assert.deepEqual(classifyBaselineRevision(true, null), {
      kind: "unparseable",
    });
  });

  it("explains an unparseable revision as a removal, not as history", () => {
    const message = formatBaselineRevisionUnparseable(
      "check",
      "lib/privacy-body-baselines.ts",
      "abc1234",
    );
    assert.match(message, /^check: ERROR — /);
    assert.match(message, /lib\/privacy-body-baselines\.ts exists at abc1234/);
    assert.match(message, /not the skip/);
  });
});

describe("evaluatePrivacyBaselineShape", () => {
  it("passes a well-formed table", () => {
    assert.deepEqual(evaluatePrivacyBaselineShape({ en: baseline() }), []);
  });

  it("reports a language no /privacy page is published for, instead of throwing later", () => {
    // The drift half asks `privacyPolicySourcePath` for this key's file, and
    // that helper refuses an unknown code — as an exception, on the one run
    // where the entry's number happened to move. As a shape rule it is a report,
    // every run, before anything reads history.
    const failures = evaluatePrivacyBaselineShape({ "de-DE": baseline() });
    assert.deepEqual(codesOf(failures), ["unknown_language"]);
    const message = formatBaselineProvenanceFailure("guard", failures[0]);
    assert.match(message, /no \/privacy page is published for/);
    for (const { code } of PRIVACY_PAGE_LANGUAGES) {
      assert.ok(
        message.includes(code),
        `the refusal does not name the known code ${code}: ${message}`,
      );
    }
  });

  it("does not throw on the table it refuses, so the whole report still prints", () => {
    // A shape half that threw would take the other five entries' findings with
    // it, which is the failure mode this rule was moved here to avoid.
    assert.doesNotThrow(() =>
      evaluatePrivacyBaselineShape({ fr: baseline(), en: baseline() }),
    );
    assert.deepEqual(
      codesOf(evaluatePrivacyBaselineShape({ fr: baseline(), en: baseline() })),
      ["unknown_language"],
    );
  });

  it("fails a recordedOn that is not a YYYY-MM-DD date", () => {
    const failures = evaluatePrivacyBaselineShape({
      en: baseline({ recordedOn: "August 2026" }),
    });
    assert.deepEqual(codesOf(failures), ["malformed_date"]);
    assert.equal(failures[0].language, "en");
  });

  it("fails a note under the word floor — 'updated' is the case it exists for", () => {
    const failures = evaluatePrivacyBaselineShape({
      en: baseline({ note: "updated" }),
    });
    assert.deepEqual(codesOf(failures), ["note_too_short"]);
    assert.match(failures[0].detail ?? "", /1 word/);
  });

  it("counts words, so one long token cannot buy its way past the floor", () => {
    const failures = evaluatePrivacyBaselineShape({
      en: baseline({ note: "x".repeat(200) }),
    });
    assert.deepEqual(codesOf(failures), ["note_too_short"]);
  });

  it("accepts a note exactly at the floor", () => {
    const note = Array.from(
      { length: PRIVACY_BASELINE_NOTE_MIN_WORDS },
      (_, index) => `word${index}`,
    ).join(" ");
    assert.deepEqual(evaluatePrivacyBaselineShape({ en: baseline({ note }) }), []);
  });

  it("fails a zero, negative or fractional word count", () => {
    for (const words of [0, -5, 12.5]) {
      const failures = evaluatePrivacyBaselineShape({ en: baseline({ words }) });
      assert.deepEqual(codesOf(failures), ["non_positive_words"], `words=${words}`);
    }
  });

  it("reports every fault on one entry rather than the first", () => {
    const failures = evaluatePrivacyBaselineShape({
      en: baseline({ words: 0, recordedOn: "nope", note: "x" }),
    });
    assert.deepEqual(codesOf(failures), [
      "non_positive_words",
      "malformed_date",
      "note_too_short",
    ]);
  });
});

describe("evaluatePrivacyBaselineDrift", () => {
  const previous = { de: baseline({ words: 169 }) };

  it("says nothing when the word count did not move", () => {
    // Clarifying a note is a good thing to do and needs no permission.
    assert.deepEqual(
      evaluatePrivacyBaselineDrift(
        previous,
        { de: baseline({ words: 169, note: "clearer wording about the same file." }) },
        [],
      ),
      [],
    );
  });

  it("passes a change that updated the note, the date and the policy file", () => {
    assert.deepEqual(
      evaluatePrivacyBaselineDrift(
        previous,
        {
          de: baseline({
            words: 140,
            recordedOn: "2026-09-01",
            note: "169 → 140 after dropping the analytics paragraph.",
          }),
        },
        ["PRIVACY.md.de"],
      ),
      [],
    );
  });

  it("fails a word count that moved without its policy file being touched", () => {
    const failures = evaluatePrivacyBaselineDrift(
      previous,
      {
        de: baseline({
          words: 140,
          recordedOn: "2026-09-01",
          note: "169 → 140 after dropping the analytics paragraph.",
        }),
      },
      ["README-DEPLOY.md"],
    );
    assert.deepEqual(codesOf(failures), ["policy_unchanged"]);
    assert.match(failures[0].detail ?? "", /PRIVACY\.md\.de is untouched/);
  });

  it("checks the ENGLISH baseline against PRIVACY.md, not PRIVACY.md.en", () => {
    const failures = evaluatePrivacyBaselineDrift(
      { en: baseline({ words: 1171 }) },
      {
        en: baseline({
          words: 980,
          recordedOn: "2026-09-01",
          note: "1171 → 980 after dropping the analytics section.",
        }),
      },
      ["PRIVACY.md"],
    );
    assert.deepEqual(failures, []);
  });

  it("fails the 'paste the measured count in and move on' resolution", () => {
    // The exact shape the note field exists to prevent: number moved, nothing
    // else did.
    const failures = evaluatePrivacyBaselineDrift(
      previous,
      { de: baseline({ words: 140 }) },
      ["PRIVACY.md.de"],
    );
    assert.deepEqual(codesOf(failures), ["provenance_unchanged"]);
  });

  it("reports provenance_unchanged ALONE — one cause is not three problems", () => {
    // With neither the date nor the note touched, the two later checks read
    // stale provenance and would repeat the same finding.
    const failures = evaluatePrivacyBaselineDrift(
      previous,
      { de: baseline({ words: 140 }) },
      [],
    );
    assert.deepEqual(codesOf(failures), ["policy_unchanged", "provenance_unchanged"]);
  });

  it("fails a recordedOn that went backwards", () => {
    const failures = evaluatePrivacyBaselineDrift(
      { de: baseline({ words: 169, recordedOn: "2026-08-11" }) },
      {
        de: baseline({
          words: 140,
          recordedOn: "2026-07-01",
          note: "169 → 140 after dropping the analytics paragraph.",
        }),
      },
      ["PRIVACY.md.de"],
    );
    assert.deepEqual(codesOf(failures), ["provenance_date_regressed"]);
  });

  it("fails a note that does not name the count it replaced", () => {
    const failures = evaluatePrivacyBaselineDrift(
      previous,
      {
        de: baseline({
          words: 140,
          recordedOn: "2026-09-01",
          note: "shortened the disclosure a little.",
        }),
      },
      ["PRIVACY.md.de"],
    );
    assert.deepEqual(codesOf(failures), ["note_omits_previous_words"]);
    assert.match(failures[0].detail ?? "", /169/);
  });

  it("does not accept the old count as a substring of a bigger number", () => {
    // `1690` contains `169` and says nothing about the change.
    const failures = evaluatePrivacyBaselineDrift(
      previous,
      {
        de: baseline({
          words: 140,
          recordedOn: "2026-09-01",
          note: "trimmed from about 1690 characters of boilerplate.",
        }),
      },
      ["PRIVACY.md.de"],
    );
    assert.deepEqual(codesOf(failures), ["note_omits_previous_words"]);
  });

  it("says nothing about a language that is new in this revision", () => {
    // A seventh language has no prior number to have moved away from; its note
    // and date are the shape half's business.
    assert.deepEqual(
      evaluatePrivacyBaselineDrift(previous, { ...previous, it: baseline() }, []),
      [],
    );
  });

  it("says nothing about a language that was removed", () => {
    // `missing_baseline` and the table ↔ PRIVACY_PAGE_LANGUAGES parity test
    // both already speak to that.
    assert.deepEqual(evaluatePrivacyBaselineDrift(previous, {}, []), []);
  });
});

describe("evaluatePrivacyBaselineProvenance", () => {
  it("runs both halves and names the revision it compared against", () => {
    const result = evaluatePrivacyBaselineProvenance({
      current: { de: baseline({ words: 140 }) },
      previous: { de: baseline({ words: 169 }) },
      baseRef: "abc1234",
      changedFiles: ["PRIVACY.md.de"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.comparedAgainst, "abc1234");
    assert.deepEqual(codesOf(result.failures), ["provenance_unchanged"]);
  });

  it("skips the drift half when no previous table is readable, and says so", () => {
    const result = evaluatePrivacyBaselineProvenance({
      current: { de: baseline() },
      previous: null,
      baseRef: "abc1234",
      changedFiles: [],
    });
    assert.equal(result.ok, true);
    assert.equal(result.comparedAgainst, null);
    assert.match(
      formatBaselineProvenanceReport("check", result),
      /only the shape half ran/,
    );
  });

  it("still runs the shape half with no history at all", () => {
    const result = evaluatePrivacyBaselineProvenance({
      current: { de: baseline({ note: "no" }) },
      previous: null,
      baseRef: null,
      changedFiles: [],
    });
    assert.equal(result.ok, false);
    assert.deepEqual(codesOf(result.failures), ["note_too_short"]);
  });

  it("an empty table is NOT ok — a pass over zero baselines is not a pass", () => {
    const result = evaluatePrivacyBaselineProvenance({
      current: {},
      previous: null,
      baseRef: null,
      changedFiles: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.checked, 0);
    assert.match(
      formatBaselineProvenanceReport("check", result),
      /a pass over zero baselines is not a pass/,
    );
  });

  it("passes the shipped table against itself", () => {
    const result = evaluatePrivacyBaselineProvenance({
      current: PRIVACY_BODY_BASELINES,
      previous: PRIVACY_BODY_BASELINES,
      baseRef: "HEAD~1",
      changedFiles: [],
    });
    assert.equal(result.ok, true);
    assert.equal(result.checked, PRIVACY_PAGE_LANGUAGES.length);
  });
});

describe("baseline provenance messages", () => {
  const ALL_CODES: readonly BaselineProvenanceFailureCode[] = [
    "malformed_date",
    "note_too_short",
    "non_positive_words",
    "policy_unchanged",
    "provenance_unchanged",
    "provenance_date_regressed",
    "note_omits_previous_words",
  ];

  it("every code renders a message naming the language and the constant", () => {
    for (const code of ALL_CODES) {
      const message = formatBaselineProvenanceFailure("check", {
        language: "de",
        code,
        detail: "169 → 140",
      });
      assert.match(message, /^check: ERROR — /, code);
      assert.match(message, /PRIVACY_BODY_BASELINES\["de"\]/, code);
    }
  });

  it("renders without a detail rather than printing 'undefined'", () => {
    for (const code of ALL_CODES) {
      const message = formatBaselineProvenanceFailure("check", {
        language: "de",
        code,
      });
      assert.doesNotMatch(message, /undefined/, code);
    }
  });

  it("reports every failure, not just the first", () => {
    const report = formatBaselineProvenanceReport("check", {
      ok: false,
      checked: 2,
      comparedAgainst: "abc1234",
      failures: [
        { language: "de", code: "policy_unchanged", detail: "169 → 140" },
        { language: "es", code: "note_too_short", detail: "1 word(s)" },
      ],
    });
    assert.equal(report.split("\n").length, 2);
    assert.match(report, /PRIVACY_BODY_BASELINES\["de"\]/);
    assert.match(report, /PRIVACY_BODY_BASELINES\["es"\]/);
  });

  it("a passing report states what it compared against", () => {
    assert.match(
      formatBaselineProvenanceReport("check", {
        ok: true,
        checked: 6,
        comparedAgainst: "abc1234",
        failures: [],
      }),
      /6 baseline\(s\) well-formed \(compared against abc1234\)\./,
    );
  });
});

describe("the guard is wired into lint:all", () => {
  it("is a registry entry pointing at the script on disk", () => {
    const guard = LINT_GUARDS.find(
      (entry) => entry.npmScript === "lint:baseline-provenance",
    );
    assert.ok(guard, "lint:baseline-provenance is not in LINT_GUARDS");
    assert.equal(
      guard.scriptPath,
      "scripts/check-privacy-baseline-provenance.ts",
    );
  });

  it("treats a shallow clone as a failure, not a skip", () => {
    // The script's own vacuous-green defence: actions/checkout defaults to
    // fetch-depth 1, and a guard that passes because it could not see the
    // previous revision is worse than no guard.
    const source = readRepoFile("scripts/check-privacy-baseline-provenance.ts");
    assert.match(source, /is-shallow-repository/);
    assert.match(source, /fetch-depth: 0/);
  });

  it("gets the full history it needs from ci.yml's test job", () => {
    // The guard is in the lint:all fan-out, which only the `test` job runs;
    // at the default depth-1 it would fail on every CI run.
    const ci = readRepoFile(".github/workflows/ci.yml");
    const testJob = ci.slice(ci.indexOf("\n  test:"));
    assert.match(
      testJob.slice(0, testJob.indexOf("Setup Node.js")),
      /fetch-depth: 0/,
    );
  });

  it("resolves its base from all four documented sources", () => {
    const source = readRepoFile("scripts/check-privacy-baseline-provenance.ts");
    for (const token of [
      "--base",
      "PRIVACY_BASELINE_BASE_REF",
      "GITHUB_BASE_REF",
      "HEAD~1",
      "merge-base",
    ]) {
      assert.ok(source.includes(token), `base resolution dropped ${token}`);
    }
    // A NAMED base that does not resolve stops the run; a GUESSED one (the PR
    // target branch, which may not be fetched) falls through to HEAD~1.
    assert.match(source, /strict: true/);
    assert.match(source, /strict: false/);
  });
});
