/**
 * The four settings nobody had opened, opened.
 *
 * `output.ascii_only` cost this app 115 KiB for two years because it sat in a
 * preset with no reader. The suggestion list then asked the same follow-up
 * three days running — the preset sets four more things, and nobody had priced
 * any of them. Each was one build; the answer is that Metro is right about all
 * three of the flippable ones, and `lib/minifier-audit.ts` is where that answer
 * lives so it does not have to be found again.
 *
 * WHAT THIS SUITE ACTUALLY GUARDS is not the answer — it is the premise. The
 * numbers were taken against one version of Metro's preset, and a dependency
 * bump can move a default silently: the bundle stays correct, every other guard
 * stays green, and the written-down measurements quietly become fiction. So the
 * preset is LOADED here, from the same entry point `metro.config.js` uses, and
 * compared against what was audited.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  AUDITED_MINIFIER_OPTIONS,
  MINIFIER_AUDIT_DATE,
  MINIFIER_AUDIT_TOTAL_BYTES,
  PROSE_QUANTITY_TOLERANCE,
  auditMinifierPreset,
  auditedDeltaKiB,
  auditedDeltaShare,
  AUDITED_PROSE_QUOTES,
  evidenceClaims,
  evidenceLinkProblems,
  formatEvidenceLinkProblems,
  formatMinifierDrift,
  formatProseQuoteProblems,
  proseQuoteProblems,
  quotedQuantity,
  unverifiedOverrides,
} from "@/lib/minifier-audit";

import { LAST_MEASURED_BUNDLE_BYTES } from "@/lib/bundle-size";

import { readRepoFile, repoPath } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/**
 * Metro's preset as the build sees it.
 *
 * `createRequire` anchored at `metro.config.js` rather than at this file, so
 * the resolution is the build's and not the suite's — a hoisting difference
 * that made the two disagree would be the exact thing worth catching.
 */
function metroPreset(): unknown {
  const require = createRequire(repoPath("metro.config.js"));
  const { getSentryExpoConfig } = require("@sentry/react-native/metro");
  return getSentryExpoConfig(repoPath(".")).transformer.minifierConfig;
}

describe("the preset the audit was taken against", () => {
  it("still sends every value the table recorded", () => {
    const drift = auditMinifierPreset(metroPreset());
    assert.deepEqual(drift, [], formatMinifierDrift(drift));
  });

  it("covers every option the preset actually sets", () => {
    // The other direction, and the one a table of known options cannot see: a
    // toolchain upgrade that ADDS a setting leaves it unpriced and unmentioned,
    // which is precisely how ascii_only survived unexamined.
    const preset = metroPreset() as Record<string, unknown>;
    const audited = new Set(AUDITED_MINIFIER_OPTIONS.map((o) => o.path.join(".")));
    const present: string[] = [];
    for (const [key, value] of Object.entries(preset)) {
      if (typeof value === "object" && value !== null) {
        for (const nested of Object.keys(value as Record<string, unknown>)) {
          present.push(`${key}.${nested}`);
        }
      } else {
        present.push(key);
      }
    }
    const unaudited = present.filter((name) => !audited.has(name));
    assert.deepEqual(
      unaudited,
      [],
      `Metro's preset sets ${unaudited.join(", ")}, which nothing here has priced — one build each, then a row in AUDITED_MINIFIER_OPTIONS`,
    );
  });
});

describe("the drift report", () => {
  it("is empty when nothing moved", () => {
    assert.deepEqual(auditMinifierPreset(metroPreset()), []);
    assert.equal(formatMinifierDrift([]), "");
  });

  it("names the option, both values and the date the number is stale against", () => {
    const drift = auditMinifierPreset({
      ...(metroPreset() as object),
      toplevel: true,
    });
    assert.deepEqual(drift, [{ path: "toplevel", audited: false, found: true }]);
    const report = formatMinifierDrift(drift);
    assert.match(report, /toplevel: audited as false, preset now sends true/);
    assert.ok(report.includes(MINIFIER_AUDIT_DATE));
    assert.match(report, /Re-measure/);
  });

  it("reports a whole section going missing, rather than reading it as agreement", () => {
    // `compress: undefined` and `compress.reduce_funcs: false` are different
    // facts, and a path walk that returned the last object it reached would
    // conflate them.
    const drift = auditMinifierPreset({ output: {}, toplevel: false });
    assert.ok(drift.some((d) => d.path === "compress.reduce_funcs" && d.found === undefined));
    assert.ok(drift.some((d) => d.path === "output.ascii_only" && d.found === undefined));
  });

  it("survives a preset that is not an object at all", () => {
    assert.equal(auditMinifierPreset(undefined).length, AUDITED_MINIFIER_OPTIONS.length);
    assert.equal(auditMinifierPreset("nonsense").length, AUDITED_MINIFIER_OPTIONS.length);
  });
});

describe("the table itself", () => {
  it("prices every option with a number or says why there is none", () => {
    for (const option of AUDITED_MINIFIER_OPTIONS) {
      assert.ok(option.path.length > 0, "every row names a path");
      assert.ok(option.note.length > 40, `${option.path.join(".")} needs a reason, not a label`);
      if (option.measuredDeltaBytes === null) {
        assert.match(
          option.note,
          /not a size question|affects only|toolchain/,
          `${option.path.join(".")} has no number and must say why`,
        );
      }
    }
  });

  it("overrides exactly one option, and metro.config.js is where it happens", () => {
    const overridden = AUDITED_MINIFIER_OPTIONS.filter((o) => o.overridden);
    assert.deepEqual(overridden.map((o) => o.path.join(".")), ["output.ascii_only"]);
    assert.match(readRepoFile("metro.config.js"), /ascii_only: false/);
  });

  /**
   * `overridden: true` is a claim about a config file, and a config file is
   * not a bundle. What proves `ascii_only: false` reached `dist/` is a guard
   * counting escapes in it — which sat one module over with nothing connecting
   * the two, so the pattern existed once, by coincidence of who wrote both. A
   * second override would have arrived with no answer to "and what goes red if
   * it silently stops applying?".
   */
  it("makes every override name what would go red in the shipped bundle", () => {
    assert.deepEqual(
      unverifiedOverrides().map((o) => o.path.join(".")),
      [],
      "an overridden option with no shippedEvidence: metro.config.js asks for something and nothing checks the ask was honoured",
    );
    // Non-vacuous: the rule has to be able to find a row that breaks it, or it
    // is a filter over a table that happens to be clean.
    assert.deepEqual(
      unverifiedOverrides([
        { path: ["compress", "invented"], metroDefault: true, measuredDeltaBytes: null, overridden: true, note: "x" },
      ]).length,
      1,
    );
  });

  it("names evidence that is a real guard calling a real evaluator", () => {
    // The half a sentence in a comment could not carry: the guard is read and
    // the call site is looked for, so a rename or a deleted call is a red run
    // rather than a paragraph that quietly became false.
    const libSources = sourceFiles("lib").map((file) => readRepoFile(file));
    for (const option of AUDITED_MINIFIER_OPTIONS) {
      const evidence = option.shippedEvidence;
      if (!evidence) continue;
      const name = option.path.join(".");
      const guard = readRepoFile("scripts", `${evidence.check}.ts`);
      assert.ok(
        guard.includes(evidence.evaluator),
        `${name} says ${evidence.check} proves the override took, and that guard never calls ${evidence.evaluator}`,
      );
      assert.ok(
        libSources.some((source) => source.includes(`export function ${evidence.evaluator}`)),
        `${name} names ${evidence.evaluator} and no module in lib/ exports it`,
      );
      assert.ok(
        evidence.failure.length > 40,
        `${name} must say what the bundle LOOKS like when the override stops applying, not just who checks`,
      );
    }
  });

  it("gives the measured cost in KiB, and nothing for an option that has no size answer", () => {
    // The number the charset failure message quotes. It used to be spelled
    // there as well as here, which is one copy that stays at 115 after the
    // other is re-measured.
    assert.equal(auditedDeltaKiB("output.ascii_only"), 115);
    assert.equal(auditedDeltaKiB("output.quote_style"), null, "not a size question");
    assert.equal(auditedDeltaKiB("compress.not_an_option"), null, "and no cost for a row that does not exist");
  });

  it("keeps the two toplevel options as separate rows", () => {
    // They are different terser options that share a name, and each was built
    // and measured on its own — a single row would be a claim about one of
    // them wearing the other's number.
    const names = AUDITED_MINIFIER_OPTIONS.map((o) => o.path.join("."));
    assert.ok(names.includes("toplevel"));
    assert.ok(names.includes("mangle.toplevel"));
  });

  it("states a total the deltas are readable against", () => {
    // A delta with no denominator is a number, not a finding: -33 is either
    // trivial or enormous depending on what it is 33 out of.
    assert.ok(MINIFIER_AUDIT_TOTAL_BYTES > 1_000_000);
    const reduceFuncs = AUDITED_MINIFIER_OPTIONS.find((o) => o.path.join(".") === "compress.reduce_funcs");
    assert.equal(reduceFuncs?.measuredDeltaBytes, -33);
    assert.ok(
      Math.abs(reduceFuncs!.measuredDeltaBytes!) / MINIFIER_AUDIT_TOTAL_BYTES < 0.0001,
      "the finding is that this is negligible; if it stops being negligible the note is wrong",
    );
  });

  it("states its total in the same unit-free terms the size gate measures", () => {
    // The carried suggestion said two denominators; there is one quantity and
    // two units. 3,718,641 bytes is 3,631.5 KiB, which is the total
    // check-bundle-size adds up over the same seven chunks.
    assert.equal(Math.round(MINIFIER_AUDIT_TOTAL_BYTES / 1024), 3631);
  });

  it("agrees with the budget snapshot, which measures the same artifact on a different day", () => {
    // Two dated readings of one bundle, and the failure this can catch is not a
    // units mix-up: it is one of them going stale while a reader keeps dividing
    // by it. 0.04% apart on 2026-09-23, and the budget's own headroom (23.8 KiB,
    // 0.6%) bounds how far one build can move them — so a gap this wide means
    // several budget raises have happened since the audit was taken.
    const drift = Math.abs(MINIFIER_AUDIT_TOTAL_BYTES - LAST_MEASURED_BUNDLE_BYTES) / MINIFIER_AUDIT_TOTAL_BYTES;
    assert.ok(
      drift < 0.05,
      `the audit's denominator (${String(MINIFIER_AUDIT_TOTAL_BYTES)} B, ${MINIFIER_AUDIT_DATE}) and the budget snapshot (${String(LAST_MEASURED_BUNDLE_BYTES)} B) are ${(drift * 100).toFixed(1)}% apart — re-take MINIFIER_AUDIT_TOTAL_BYTES from a fresh build, or the percentages in the table's notes are against a bundle that no longer exists`,
    );
  });

  it("turns a delta into a percentage so no call site picks a denominator", () => {
    const share = auditedDeltaShare("compress.reduce_funcs");
    assert.ok(share !== null && share < 0.001, "the note says 0.0009%, and that is where it comes from");
    assert.equal(auditedDeltaShare("output.quote_style"), null, "not a size question");
    assert.equal(auditedDeltaShare("compress.not_an_option"), null, "and nothing for a row that does not exist");
    const ascii = auditedDeltaShare("output.ascii_only");
    assert.ok(ascii !== null && ascii > 3 && ascii < 3.5, "the 3% the whole audit started from");
  });

  it("keeps a percentage written in a note in step with the one derived from the row", () => {
    // `compress.reduce_funcs` argues from "0.0009%" in its own prose, beside a
    // delta and a total that produce 0.00089%. Two copies of one quotient, and
    // the note is the one that stays behind when the row is re-measured. The
    // tolerance is relative and generous because a note ROUNDS on purpose —
    // what it cannot do is be about a different measurement.
    let checked = 0;
    for (const option of AUDITED_MINIFIER_OPTIONS) {
      const share = auditedDeltaShare(option.path.join("."));
      if (share === null) continue;
      for (const match of option.note.matchAll(/([\d.]+)%/g)) {
        const noted = Number.parseFloat(match[1]);
        if (!Number.isFinite(noted) || noted === 0) continue;
        checked += 1;
        assert.ok(
          Math.abs(noted - share) / share < PROSE_QUANTITY_TOLERANCE,
          `${option.path.join(".")}'s note says ${match[1]}% and its delta over MINIFIER_AUDIT_TOTAL_BYTES is ${share.toFixed(5)}% — one of the two was re-measured and the other was not`,
        );
      }
    }
    assert.ok(checked > 0, "no note quotes a percentage, so this case is checking nothing");
  });

  it("records the two structural zeroes as zero, not as absent measurements", () => {
    // "Not measured" and "measured, and it changed nothing" are different
    // answers, and the second is the interesting one here.
    for (const name of ["toplevel", "mangle.toplevel"]) {
      const row = AUDITED_MINIFIER_OPTIONS.find((o) => o.path.join(".") === name);
      assert.equal(row?.measuredDeltaBytes, 0, `${name} was built and measured`);
    }
  });
});

/**
 * The direction the table could not see.
 *
 * `unverifiedOverrides` asks every override to name what would go red. The
 * reverse was unasked: an evaluator is cited by a row it cannot read, so
 * deleting the row — or flipping its `overridden` to false — leaves
 * `evaluateBundleCharset` running inside a gate leg as a check with no stated
 * subject. Green forever, about a config line nobody asserts any more. The
 * marker in the evaluator's own doc is the other end of the link, and this is
 * where the two ends are made to agree.
 */
describe("the shipped-evidence link, both ends", () => {
  const libModules = sourceFiles("lib").map((file) => ({ path: file, text: readRepoFile(file) }));

  it("has every override and every evaluator naming each other", () => {
    const problems = evidenceLinkProblems(evidenceClaims(libModules));
    assert.deepEqual(problems, [], formatEvidenceLinkProblems(problems));
  });

  it("actually found the one marker in the tree, rather than scanning nothing", () => {
    // The assertion above is a negative over a parse, and a parse that reads no
    // markers satisfies it. This is the positive that makes it mean something.
    const claims = evidenceClaims(libModules);
    assert.deepEqual(claims, [
      { module: "lib/bundle-smoke.ts", option: "output.ascii_only", evaluator: "evaluateBundleCharset" },
    ]);
  });

  it("reads a doc TAG and not a mention of one", () => {
    // Why the rule is about a tag line: `lib/minifier-audit.ts` spells the
    // marker inside its own prose to explain it, and a looser match would read
    // that sentence as a claim about whatever function came next.
    const claims = evidenceClaims([
      { path: "lib/prose.ts", text: "// see @shippedEvidence output.ascii_only for the shape\nexport function f() {}" },
      { path: "lib/tag.ts", text: "/**\n * @shippedEvidence output.ascii_only\n */\nexport function g() {}" },
    ]);
    assert.deepEqual(claims, [{ module: "lib/tag.ts", option: "output.ascii_only", evaluator: "g" }]);
  });

  it("reports a marker whose row has gone, which is what a deleted row leaves behind", () => {
    const problems = evidenceLinkProblems(evidenceClaims(libModules), [
      { path: ["compress", "reduce_funcs"], metroDefault: false, measuredDeltaBytes: -33, overridden: false, note: "x" },
    ]);
    assert.deepEqual(problems, [
      {
        code: "orphan_claim",
        option: "output.ascii_only",
        module: "lib/bundle-smoke.ts",
        evaluator: "evaluateBundleCharset",
      },
    ]);
    assert.match(formatEvidenceLinkProblems(problems), /no overridden row in AUDITED_MINIFIER_OPTIONS names it/);
  });

  it("reports a row whose evaluator never says what it is for", () => {
    const problems = evidenceLinkProblems([], [
      {
        path: ["output", "ascii_only"],
        metroDefault: true,
        measuredDeltaBytes: -117_760,
        overridden: true,
        shippedEvidence: { check: "check-bundle-smoke", evaluator: "evaluateBundleCharset", failure: "x" },
        note: "x",
      },
    ]);
    assert.deepEqual(problems, [
      { code: "unclaimed_evaluator", option: "output.ascii_only", evaluator: "evaluateBundleCharset" },
    ]);
    assert.match(formatEvidenceLinkProblems(problems), /@shippedEvidence output\.ascii_only/);
  });

  it("reports evidence left behind by an override that stopped being one, once", () => {
    // The row keeping its proof after the metro.config.js line goes is the
    // cheap half — visible from the table alone — and it must not also be
    // reported as an evaluator that failed to claim it: one broken link, one
    // finding, or the count in the summary is a lie.
    const problems = evidenceLinkProblems(evidenceClaims(libModules), [
      {
        path: ["output", "ascii_only"],
        metroDefault: true,
        measuredDeltaBytes: -117_760,
        overridden: false,
        shippedEvidence: { check: "check-bundle-smoke", evaluator: "evaluateBundleCharset", failure: "x" },
        note: "x",
      },
    ]);
    assert.deepEqual(problems.map((p) => p.code), ["evidence_without_subject", "orphan_claim"]);
    assert.match(formatEvidenceLinkProblems(problems), /there is no override left to prove/);
  });

  it("treats a marker documenting nothing exported as a claim, not as absent", () => {
    // A tag at the bottom of a file, or above a function somebody stopped
    // exporting: the option is named and there is no callable evidence. The
    // quiet reading would be "no claim here", which is the same green the whole
    // rule exists to remove.
    const problems = evidenceLinkProblems(
      evidenceClaims([{ path: "lib/loose.ts", text: "/**\n * @shippedEvidence output.ascii_only\n */\nconst h = 1;\n" }]),
    );
    assert.deepEqual(problems.map((p) => p.code), ["unclaimed_evaluator", "orphan_claim"]);
    assert.match(formatEvidenceLinkProblems(problems), /a marker above nothing exported/);
  });

  it("says nothing when both ends agree", () => {
    assert.equal(formatEvidenceLinkProblems([]), "");
  });
});

/**
 * The other half of the percentage rule, where the prose lives.
 *
 * The note rule holds every percentage inside a `note` against the row it
 * describes, which is the half of the duplication that sits in the table. The
 * half that started the whole audit sits in module HEADERS: `ascii_only` cost
 * "3% of the bundle" and "115 KiB", and those sentences are in five `lib/`
 * modules, none of them a note, none of them read by any case. Three copies of
 * one quotient, one of them checked.
 *
 * Both directions matter and they fail differently. A registered fragment that
 * stops matching its row is a re-measurement that only reached the data; a
 * module that spells the figure and is in no entry is the next copy, written
 * today, checked by nothing.
 */
describe("the measurements quoted in prose", () => {
  const libModules = sourceFiles("lib").map((file) => ({ path: file, text: readRepoFile(file) }));

  it("has every quoted number still in its file and still matching its row", () => {
    const problems = proseQuoteProblems(libModules);
    assert.deepEqual(problems, [], formatProseQuoteProblems(problems));
  });

  it("covers the prose it was written for, rather than an empty registry", () => {
    // The assertion above is a negative over a list, and an empty list passes
    // it. These are the copies the finding named: two units, five modules.
    const files = new Set(AUDITED_PROSE_QUOTES.map((entry) => entry.file));
    assert.ok(files.size >= 5, `only ${String(files.size)} module(s) registered — the finding named five`);
    const units = new Set(
      AUDITED_PROSE_QUOTES.map((entry) => quotedQuantity(entry.quote)?.unit ?? null),
    );
    assert.deepEqual([...units].sort(), ["%", "KiB"], "every entry parses, and both units are covered");
  });

  it("parses the quantity a fragment ends with, not the total it opens with", () => {
    assert.deepEqual(quotedQuantity("3,718,641 — 0.0009%"), { value: 0.0009, unit: "%" });
    assert.deepEqual(quotedQuantity("took 115.4 KiB out"), { value: 115.4, unit: "KiB" });
    assert.equal(quotedQuantity("33 bytes, and no unit this rule knows"), null);
  });

  it("reports a sentence the row has moved away from", () => {
    const problems = proseQuoteProblems(
      [{ path: "lib/made-up.ts", text: "it cost 40 KiB, once" }],
      [{ file: "lib/made-up.ts", path: "output.ascii_only", quote: "cost 40 KiB" }],
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0].code, "stale");
    assert.match(formatProseQuoteProblems(problems), /says 40 KiB for output\.ascii_only/);
  });

  it("reports a fragment the file no longer spells, which is a rewritten sentence", () => {
    const problems = proseQuoteProblems(
      [{ path: "lib/made-up.ts", text: "it cost about 115 KiB" }],
      [{ file: "lib/made-up.ts", path: "output.ascii_only", quote: "cost 115 KiB" }],
    );
    assert.deepEqual(problems.map((problem) => problem.code), ["quote_gone"]);
  });

  it("reports a module that quotes the figure and is in no entry", () => {
    // The direction a registry usually lacks: the next header to say "115 KiB"
    // joins the check by existing, not by somebody remembering this list.
    const problems = proseQuoteProblems(
      [{ path: "lib/newcomer.ts", text: " * the 115 KiB that ascii_only bought" }],
      [],
    );
    assert.deepEqual(problems.map((problem) => problem.code), ["unregistered"]);
    assert.match(formatProseQuoteProblems(problems), /lib\/newcomer\.ts/);
  });

  it("does not read 94 KiB or 1154 KiB as a mention of 115", () => {
    // The scan is for the row's figure with its optional decimals, and a
    // neighbouring number is not it — `lib/bundle-size.ts` states locale sizes
    // in KiB two lines from the one that IS registered.
    const problems = proseQuoteProblems(
      [{ path: "lib/neighbours.ts", text: "94 KiB and 1154 KiB and 3115 KiB" }],
      [],
    );
    assert.deepEqual(problems, []);
  });

  it("leaves a sub-KiB row to the forward direction alone", () => {
    // `reduce_funcs` rounds to 0 KiB, so there is no string to scan for; its
    // percentage is registered and checked, and nothing pretends otherwise.
    const registered = AUDITED_PROSE_QUOTES.filter((entry) => entry.path === "compress.reduce_funcs");
    assert.ok(registered.length > 0, "the sub-KiB row is still covered in prose");
    assert.equal(auditedDeltaKiB("compress.reduce_funcs"), 0, "and rounds to nothing in KiB");
  });
});
