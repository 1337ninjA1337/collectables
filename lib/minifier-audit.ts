/**
 * Metro's terser preset, opened and measured — once, rather than never.
 *
 * ## Why this file exists
 *
 * `output.ascii_only` was one option in a config nobody had opened, and it was
 * costing 3% of the bundle: 115 KiB of `\uXXXX` escapes for an app translated
 * into Russian and Belarusian. `metro.config.js` turns it off, and the
 * suggestion list then asked the obvious follow-up three days running — the
 * preset sets four other things, chosen by somebody else for some other app,
 * and nobody had priced any of them.
 *
 * Each was one build to measure. The answer, on 2026-09-19, is that all three
 * of the flippable ones are RIGHT as Metro has them, which is exactly the kind
 * of result that gets re-derived every few months unless it is written down.
 * So it is written down here, with the numbers, and with a check that keeps it
 * honest.
 *
 * ## The two toplevel options are inert here, by construction
 *
 * `toplevel` and `mangle.toplevel` moved the bundle by ZERO bytes — not
 * "nearly nothing", zero, byte for byte across all seven chunks. That is not a
 * coincidence and it is not terser being conservative: Metro wraps every module
 * in a `__d(function (global, require, …) { … })` factory, so a Metro bundle
 * has no meaningful top level to mangle or shake. Every name is already
 * function-scoped and already mangled. Whatever these options are for, this
 * bundle shape cannot reach it.
 *
 * ## reduce_funcs buys 33 bytes and costs something nobody has measured
 *
 * 33 bytes out of 3,718,641 — 0.0009% — and the entry chunk actually moved
 * further than the total (-55 bytes there, with 22 coming back elsewhere),
 * which is what inlining single-use functions does to chunk boundaries. React
 * Native disables it deliberately: inlining a function into its call site
 * changes what the engine can lazily compile, and the cost lands on startup
 * rather than on the wire. Trading an unmeasured startup regression for 33
 * bytes is not a trade; the interesting part is that the number is small enough
 * that nobody needs to think about the risk at all.
 *
 * ## What the check is for
 *
 * A measurement is only as good as the thing it was measured against. These
 * numbers were taken against one version of Metro's preset, and a dependency
 * bump can change a default silently: the bundle would still be correct, still
 * pass every other guard, and the paragraphs above would quietly become fiction
 * — the same failure mode that made `evaluateBundleCharset` join the smoke
 * check rather than live as a comment. {@link auditMinifierPreset} compares the
 * preset the toolchain actually hands over against what was audited, so a
 * changed default is a red run that says "re-measure this one", by name.
 *
 * Node-pure: it takes the config object, so the suite does the requiring and
 * this stays a function.
 */

/**
 * What proves an override reached the shipped bundle, for the rows that
 * override.
 *
 * `overridden: true` is a claim about `metro.config.js`, and a config file is
 * not a bundle. The thing that actually proves `ascii_only: false` took is
 * `evaluateBundleCharset` counting escapes in `dist/` — which lived one module
 * over with nothing connecting the two, so the pattern existed exactly once
 * and only as a coincidence of who happened to write both. A second overridden
 * row would have arrived with no answer to "and what would go red if it
 * silently stopped applying?".
 *
 * Named parts rather than a sentence, because each is checkable:
 * `__tests__/minifier-audit.test.ts` reads the guard's script and asserts it
 * actually calls the evaluator, so a rename or a deleted call site is a red
 * run rather than a paragraph that has quietly become false.
 */
export interface ShippedEvidence {
  /** The guard that goes red, by check name — `scripts/<check>.ts`. */
  readonly check: string;
  /** The exported function in `lib/` that decides it. */
  readonly evaluator: string;
  /** What the bundle looks like when the override has stopped applying. */
  readonly failure: string;
}

/** One option in the preset, as it was found and as it was priced. */
export interface AuditedMinifierOption {
  /** Property path inside `transformer.minifierConfig`. */
  readonly path: readonly string[];
  /** The value Metro's preset carried when this was measured. */
  readonly metroDefault: unknown;
  /**
   * What flipping it did to the total bundle, in bytes — negative is smaller.
   * `null` for an option that was not flippable as a size question.
   */
  readonly measuredDeltaBytes: number | null;
  /** Whether `metro.config.js` overrides it. */
  readonly overridden: boolean;
  /**
   * Required of every overridden row: how the SHIPPED bundle proves the
   * override took. Absent on the rows that leave Metro's value alone, which
   * have nothing to have stopped applying.
   */
  readonly shippedEvidence?: ShippedEvidence;
  /** Why the current value is the right one. */
  readonly note: string;
}

/** The date the numbers below were taken, for the report to quote. */
export const MINIFIER_AUDIT_DATE = "2026-09-19";

/** The total the deltas are against, so a reader can turn them into percentages. */
export const MINIFIER_AUDIT_TOTAL_BYTES = 3_718_641;

export const AUDITED_MINIFIER_OPTIONS: readonly AuditedMinifierOption[] = [
  {
    path: ["output", "ascii_only"],
    metroDefault: true,
    measuredDeltaBytes: -117_760,
    overridden: true,
    shippedEvidence: {
      check: "check-bundle-smoke",
      evaluator: "evaluateBundleCharset",
      failure:
        "the bundle's non-ASCII copy comes back as tens of thousands of \\uXXXX escapes against near-zero literal characters, which is the reverse of the comparison the check asserts and cannot happen by accident",
    },
    note:
      "the one that was wrong for this app: it rewrites every non-ASCII character as a six-byte escape, and a Cyrillic letter costs two bytes in UTF-8. Turned off in metro.config.js on 2026-09-17; every consumer declares UTF-8. Its delta is the ONLY one here not from the 2026-09-19 run — it was measured two days earlier against a smaller tree, and is carried at the 115 KiB that commit reported rather than re-derived, since flipping it back for a fresh number would be a build spent confirming a decision already made.",
  },
  {
    path: ["compress", "reduce_funcs"],
    metroDefault: false,
    measuredDeltaBytes: -33,
    overridden: false,
    note:
      "true saves 33 bytes of 3.5 MiB. React Native disables it deliberately — inlining single-use functions moves work from the wire to startup — and 0.0009% does not buy an unmeasured startup regression.",
  },
  {
    path: ["mangle", "toplevel"],
    metroDefault: false,
    measuredDeltaBytes: 0,
    overridden: false,
    note:
      "true changes nothing at all: Metro wraps every module in a __d(function …) factory, so there is no top level to mangle. Zero bytes, byte for byte, across all seven chunks.",
  },
  {
    path: ["toplevel"],
    metroDefault: false,
    measuredDeltaBytes: 0,
    overridden: false,
    note:
      "the same answer for the same structural reason as mangle.toplevel, and measured separately because the two are different terser options that happen to share a name.",
  },
  {
    path: ["output", "quote_style"],
    metroDefault: 3,
    measuredDeltaBytes: null,
    overridden: false,
    note:
      "not a size question: 3 means 'leave quotes as written'. It is spread through rather than replaced in metro.config.js, which is the way that edit goes wrong.",
  },
  {
    path: ["output", "wrap_iife"],
    metroDefault: true,
    measuredDeltaBytes: null,
    overridden: false,
    note: "metro's own, expected by the rest of the toolchain; spread through for the same reason.",
  },
  {
    path: ["sourceMap", "includeSources"],
    metroDefault: false,
    measuredDeltaBytes: null,
    overridden: false,
    note:
      "affects only a build that emits sourcemaps, and the deploy strips them — npm run build:sourcemaps is a report, not a shipped artifact.",
  },
];

/**
 * Overridden rows that name nothing in the shipped bundle to prove it.
 *
 * The gap this table had while it held exactly one override: `overridden:
 * true` says what `metro.config.js` asks for, and nothing here said what would
 * notice if the ask stopped being honoured — a Metro upgrade that reorders the
 * spread, an edit that replaces `output` instead of spreading it, a preset that
 * starts ignoring the key. The answer existed for `ascii_only` and existed
 * nowhere else, so a second override would have been written without one.
 *
 * A function over the table rather than a required field, because the
 * requirement is not "every row" — it is every row that claims to have changed
 * something, which is a property of the data and belongs where the data can be
 * asked about it.
 */
export function unverifiedOverrides(
  options: readonly AuditedMinifierOption[] = AUDITED_MINIFIER_OPTIONS,
): AuditedMinifierOption[] {
  return options.filter((option) => option.overridden && !option.shippedEvidence);
}

/**
 * One audited option's measured delta in KiB, for a message that would
 * otherwise repeat the number.
 *
 * `null` for an option that has no size answer, and for a path the table does
 * not hold — a caller quoting a cost for an option nobody measured is the
 * thing worth NOT printing, so the absence is a value rather than a throw.
 */
export function auditedDeltaKiB(path: string): number | null {
  const option = AUDITED_MINIFIER_OPTIONS.find((entry) => entry.path.join(".") === path);
  if (!option || option.measuredDeltaBytes === null) return null;
  return Math.round(Math.abs(option.measuredDeltaBytes) / 1024);
}

/** Read a nested property by path, or `undefined` if any step is missing. */
function valueAt(config: unknown, path: readonly string[]): unknown {
  let current: unknown = config;
  for (const step of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

/** An audited option whose preset value is no longer what was measured. */
export interface MinifierDrift {
  readonly path: string;
  readonly audited: unknown;
  readonly found: unknown;
}

/**
 * Which audited options the preset no longer agrees with.
 *
 * The PRESET, before `metro.config.js` has had its say — the question is
 * whether the thing that was measured is still the thing being shipped, and an
 * override we applied ourselves is not drift. `ascii_only` is in the table with
 * `metroDefault: true` for exactly that reason: it records what Metro sends, so
 * the day Metro stops sending it the note saying we turn it off becomes a note
 * about nothing, and this says so.
 */
export function auditMinifierPreset(preset: unknown): MinifierDrift[] {
  const drift: MinifierDrift[] = [];
  for (const option of AUDITED_MINIFIER_OPTIONS) {
    const found = valueAt(preset, option.path);
    if (found !== option.metroDefault) {
      drift.push({ path: option.path.join("."), audited: option.metroDefault, found });
    }
  }
  return drift;
}

/** The drift as one sentence per option, naming what has to be re-measured. */
export function formatMinifierDrift(drift: readonly MinifierDrift[]): string {
  if (drift.length === 0) return "";
  const lines = [
    `Metro's minifier preset has moved since the audit of ${MINIFIER_AUDIT_DATE}, which means ${drift.length} of the measurements in lib/minifier-audit.ts were taken against a config the toolchain no longer sends.`,
  ];
  for (const item of drift) {
    lines.push(
      `  ${item.path}: audited as ${JSON.stringify(item.audited)}, preset now sends ${JSON.stringify(item.found)}`,
    );
  }
  lines.push(
    "Re-measure the affected option (flip it in metro.config.js, npm run build, compare the total) and update the table with the new number and a dated sentence.",
  );
  return lines.join("\n");
}

/**
 * The marker an evaluator writes in its own doc to name the audited option it
 * proves — `@shippedEvidence output.ascii_only`.
 *
 * {@link unverifiedOverrides} asks one direction: a row claiming to override
 * something has to name what would go red. Nothing asked the other, and the
 * other is where the silent failure lives — an evaluator is evidence for a row
 * it cannot see. Delete the row, or flip its `overridden` to false, and
 * `evaluateBundleCharset` keeps running inside a gate leg as a check with no
 * stated subject: green forever, about nothing anybody decided to assert.
 *
 * So the link is written at BOTH ends and neither end is a list. The table
 * names the evaluator; the evaluator's doc names the option. A claim with no
 * matching overridden row is the same finding {@link
 * import("./floor-walks").unusedUncountedExcuses} reports for an excuse
 * nothing matches — a rule kept for a subject that left.
 *
 * Deliberately not a second table of "evaluators that are evidence": that list
 * would have to be remembered, which is the failure this is closing.
 */
export const SHIPPED_EVIDENCE_MARKER = "@shippedEvidence";

/** A `lib/` module as the suite read it, for the marker parse. */
export interface EvidenceModule {
  /** Repo-relative path, for a finding a reader can open. */
  readonly path: string;
  readonly text: string;
}

/** One `@shippedEvidence` marker, with the export it sits above. */
export interface EvidenceClaim {
  readonly module: string;
  /** The audited option path the marker names. */
  readonly option: string;
  /**
   * The exported function the marker documents — the first `export function`
   * after it, so renaming the function moves the claim with it. `null` when the
   * marker documents nothing exported, which is a finding rather than a skip:
   * a claim nobody can call is not evidence.
   */
  readonly evaluator: string | null;
}

/**
 * Every `@shippedEvidence` marker in the given modules.
 *
 * Takes the sources rather than walking `lib/` itself, the same way
 * {@link auditMinifierPreset} takes the config: this module stays Node-pure and
 * the suite does the reading.
 */
export function evidenceClaims(modules: readonly EvidenceModule[]): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  // A doc TAG, which is a line of its own beginning with the comment star —
  // not any mention of the word. The distinction is what lets this module's own
  // header spell the marker inline while explaining it, and it is the shape a
  // real marker has anyway.
  const marker = new RegExp(`^\\s*\\*\\s*${SHIPPED_EVIDENCE_MARKER}\\s+([\\w.$]+)`, "gm");
  for (const module of modules) {
    for (const match of module.text.matchAll(marker)) {
      const after = module.text.slice(match.index + match[0].length);
      const exported = /export function ([\w$]+)/.exec(after);
      claims.push({ module: module.path, option: match[1], evaluator: exported ? exported[1] : null });
    }
  }
  return claims;
}

/** A link between the audit table and a shipped-bundle evaluator that is broken. */
export type EvidenceLinkProblem =
  | { readonly code: "evidence_without_subject"; readonly option: string; readonly evaluator: string }
  | { readonly code: "unclaimed_evaluator"; readonly option: string; readonly evaluator: string }
  | {
      readonly code: "orphan_claim";
      readonly option: string;
      readonly module: string;
      readonly evaluator: string | null;
    };

/**
 * The two-way link, checked in both directions.
 *
 * `evidence_without_subject` is the cheap half and it is data-only: a row that
 * no longer overrides anything has nothing left to prove, so the evidence it
 * carries is about a config line that was deleted.
 *
 * The other two need the evaluator's own source, because the failure they catch
 * cannot be seen from the table at all. `unclaimed_evaluator` is a row naming
 * a function that never says what it is for — the state every override was in
 * before this existed. `orphan_claim` is the reverse and the one the suggestion
 * was about: a marker naming an option no overridden row matches, which is what
 * a deleted row, an un-overridden row, a renamed evaluator or a typo in either
 * end all come out as.
 */
export function evidenceLinkProblems(
  claims: readonly EvidenceClaim[],
  options: readonly AuditedMinifierOption[] = AUDITED_MINIFIER_OPTIONS,
): EvidenceLinkProblem[] {
  const problems: EvidenceLinkProblem[] = [];
  const claimed = new Set(claims.map((claim) => `${claim.option}\u0000${claim.evaluator ?? ""}`));
  const proven = new Set<string>();
  for (const option of options) {
    const evidence = option.shippedEvidence;
    if (!evidence) continue;
    const path = option.path.join(".");
    if (!option.overridden) {
      problems.push({ code: "evidence_without_subject", option: path, evaluator: evidence.evaluator });
      continue;
    }
    proven.add(`${path}\u0000${evidence.evaluator}`);
    if (!claimed.has(`${path}\u0000${evidence.evaluator}`)) {
      problems.push({ code: "unclaimed_evaluator", option: path, evaluator: evidence.evaluator });
    }
  }
  for (const claim of claims) {
    if (proven.has(`${claim.option}\u0000${claim.evaluator ?? ""}`)) continue;
    problems.push({
      code: "orphan_claim",
      option: claim.option,
      module: claim.module,
      evaluator: claim.evaluator,
    });
  }
  return problems;
}

/** The broken links as one sentence each, naming both ends and the edit. */
export function formatEvidenceLinkProblems(problems: readonly EvidenceLinkProblem[]): string {
  if (problems.length === 0) return "";
  const lines: string[] = [];
  for (const problem of problems) {
    if (problem.code === "evidence_without_subject") {
      lines.push(
        `  ${problem.option}: no longer overridden, and still names ${problem.evaluator} as proof the override took — there is no override left to prove. Drop the shippedEvidence with the metro.config.js line, or say why the row is still an override.`,
      );
    } else if (problem.code === "unclaimed_evaluator") {
      lines.push(
        `  ${problem.option}: names ${problem.evaluator} as its shipped evidence, and that function's doc never says so. Add "${SHIPPED_EVIDENCE_MARKER} ${problem.option}" above it, so deleting this row turns the evaluator into a reported orphan rather than a green check about nothing.`,
      );
    } else {
      lines.push(
        `  ${problem.module}: ${problem.evaluator === null ? "a marker above nothing exported" : problem.evaluator} claims to be the shipped evidence for ${problem.option}, and no overridden row in AUDITED_MINIFIER_OPTIONS names it. Either the row left (delete the marker with it) or the two ends disagree about a name.`,
      );
    }
  }
  return [
    `${problems.length} shipped-evidence link(s) are broken: an override and the guard that proves it have to name each other, and one end of each of these names nothing.`,
    ...lines,
  ].join("\n");
}
