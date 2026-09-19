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
  auditMinifierPreset,
  formatMinifierDrift,
} from "@/lib/minifier-audit";

import { readRepoFile, repoPath } from "./helpers/repo-file";

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

  it("records the two structural zeroes as zero, not as absent measurements", () => {
    // "Not measured" and "measured, and it changed nothing" are different
    // answers, and the second is the interesting one here.
    for (const name of ["toplevel", "mangle.toplevel"]) {
      const row = AUDITED_MINIFIER_OPTIONS.find((o) => o.path.join(".") === name);
      assert.equal(row?.measuredDeltaBytes, 0, `${name} was built and measured`);
    }
  });
});
