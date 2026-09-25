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

/**
 * The total the deltas are against, so a reader can turn them into percentages.
 *
 * The suggestion list carried "3,718,641 here and 3,631.8 KiB in
 * `check-bundle-size` — both right, and a reader turning a delta into a
 * percentage cannot tell which denominator they hold" for three runs. Checked
 * on 2026-09-23, it is one number: 3,718,641 bytes IS 3,631.5 KiB, the same
 * seven chunks the size gate adds up, in bytes because the deltas are in bytes.
 * There was never a choice to get wrong — there were two units and no sentence
 * saying so.
 *
 * What CAN go wrong is staleness, and that is not a units question: this is a
 * measurement dated {@link MINIFIER_AUDIT_DATE}, and `BUDGET_SNAPSHOT` holds
 * the same quantity taken when the budget last moved (1,350 bytes away, 0.04%).
 * Two dated readings of one artifact agree until one of them stops being
 * re-taken, so `minifier-audit.test.ts` holds them against each other rather
 * than trusting this paragraph.
 *
 * {@link auditedDelta} is there so a percentage never needs the denominator
 * typed at a call site at all.
 */
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
 * One audited option's measurement, in every unit anybody states it in.
 *
 * It was two functions, `auditedDeltaKiB` and `auditedDeltaShare`, and they
 * were the same six lines twice: the same lookup by joined path, the same
 * `null` for a row with no size answer and for a row that is not there, and
 * one arithmetic line each. Both existed for one reason — a call site should
 * not divide by hand — and the shape that reason leads to is not one function
 * per unit. A third unit would have been a third copy of the lookup.
 *
 * So the lookup happens once and the units are fields on what it finds. The
 * denominator is applied here rather than at a call site because the two
 * places this repository states it are the same quantity in different units
 * ({@link MINIFIER_AUDIT_TOTAL_BYTES} is 3,718,641 bytes and
 * `check-bundle-size` reports 3,631.5 KiB), which is exactly the confusion a
 * reader should not have to resolve on their own.
 *
 * `null` for an option that has no size answer, and for a path the table does
 * not hold — a caller quoting a cost for an option nobody measured is the
 * thing worth NOT printing, so the absence is a value rather than a throw. A
 * row measured at exactly zero is NOT absent: `toplevel` moved the bundle by
 * zero bytes and that is a result, so it comes back with zeroes in it and the
 * caller that cares (a prose quote cannot be about a zero) says so itself.
 */
export interface AuditedDelta {
  /** The magnitude of the measured move, in bytes, sign dropped. */
  readonly bytes: number;
  /** The same rounded to whole KiB, the unit every message states it in. */
  readonly kib: number;
  /** The same as a percentage of {@link MINIFIER_AUDIT_TOTAL_BYTES}. */
  readonly share: number;
}

/** One audited row's measurement, or `null` if it has none. */
export function auditedDelta(
  path: string,
  options: readonly AuditedMinifierOption[] = AUDITED_MINIFIER_OPTIONS,
): AuditedDelta | null {
  const option = options.find((entry) => entry.path.join(".") === path);
  if (!option || option.measuredDeltaBytes === null) return null;
  const bytes = Math.abs(option.measuredDeltaBytes);
  return {
    bytes,
    kib: Math.round(bytes / 1024),
    share: (bytes / MINIFIER_AUDIT_TOTAL_BYTES) * 100,
  };
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

/**
 * How far a number written in prose may sit from the one the row derives.
 *
 * Relative, and generous, because prose ROUNDS on purpose: 3.1667% reads as
 * "3% of the bundle" and 115.0 KiB is written as "115.4 KiB" by the commit
 * that measured it against a slightly different tree. Both are the number a
 * reader wants. What the bound refuses is a sentence about a DIFFERENT
 * measurement — the state every copy falls into the day its row is re-measured
 * and the sentence is not.
 *
 * One constant rather than a `0.2` typed at each call site: the note rule in
 * `minifier-audit.test.ts` was here first and the prose rule below is the same
 * judgement about the same kind of number, so the day one of them is argued
 * looser the other should move with it or be argued separately, out loud.
 */
export const PROSE_QUANTITY_TOLERANCE = 0.2;

/**
 * A measured number this repository states in prose, away from the row that
 * derives it.
 *
 * `auditedDelta` closed the half of this that lives in the table: every
 * percentage inside a `note` is held against the row it describes. The half it
 * could not see is the half that started the audit — `ascii_only` cost "3% of
 * the bundle", "115 KiB", and those sentences are in five module headers and
 * one budget entry, none of which is a `note` and none of which any case read.
 * Three copies of one quotient, one of them checked, was the finding.
 *
 * The entry is a VERBATIM fragment rather than a number plus a file, and that
 * is the whole design: a fragment that is still in the file proves the sentence
 * was not rewritten around the number, the number is parsed back out of the
 * fragment ({@link quotedQuantity}) so the registry never holds a second copy
 * of it, and a re-measured row turns every stale site red by name instead of
 * leaving a reader to grep. Keep each quote on ONE source line — these are
 * wrapped comments, and a fragment that spans a wrap can never match.
 */
export interface ProseQuote {
  /** Repo-relative path of the module whose prose says it. */
  readonly file: string;
  /** The audited option path the sentence is about. */
  readonly path: string;
  /** The fragment, exactly as the file spells it, carrying the number. */
  readonly quote: string;
}

/**
 * Every prose statement of an audited measurement outside the table.
 *
 * `lib/`, `scripts/` and the suites — every place in this tree that states one
 * of these numbers in words. It began as `lib/` only, on the argument that a
 * module header is what a reader reaches for and a suite header is scaffolding
 * beside the case that proves it; the argument did not survive counting them.
 * Five of the nine copies were outside `lib/`, one of them was an
 * `assert.match(line, /115 KiB/)` sitting one screen above a case that derives
 * the same number out of this table, and a sentence that goes stale goes stale
 * wherever it is written. {@link proseQuoteProblems} reports an unregistered
 * copy in any module it is HANDED, so the scope is the call site's — and the
 * call site now hands it the whole tree.
 */
export const AUDITED_PROSE_QUOTES: readonly ProseQuote[] = [
  {
    file: "lib/minifier-audit.ts",
    path: "output.ascii_only",
    quote: "costing 3% of the bundle",
  },
  {
    file: "lib/minifier-audit.ts",
    path: "output.ascii_only",
    quote: "bundle: 115 KiB of",
  },
  {
    file: "lib/minifier-audit.ts",
    path: "output.ascii_only",
    quote: "carried at the 115 KiB that commit reported",
  },
  {
    file: "lib/minifier-audit.ts",
    path: "compress.reduce_funcs",
    quote: "3,718,641 — 0.0009%",
  },
  {
    file: "lib/bundle-smoke.ts",
    path: "output.ascii_only",
    quote: "was carrying 115 KiB of",
  },
  {
    file: "lib/bundle-smoke.ts",
    path: "output.ascii_only",
    quote: "be 115 KiB heavier",
  },
  {
    file: "lib/native-bundle-report.ts",
    path: "output.ascii_only",
    quote: "the 115 KiB that",
  },
  {
    file: "lib/bundle-size.ts",
    path: "output.ascii_only",
    quote: "Turning it off took 115.4 KiB out",
  },
  {
    file: "lib/budget-snapshot.ts",
    path: "output.ascii_only",
    quote: "115.4 KiB of encoding",
  },
  {
    file: "scripts/check-bundle-smoke.ts",
    path: "output.ascii_only",
    quote: "answer is 115 KiB that",
  },
  {
    file: "__tests__/bundle-size.test.ts",
    path: "output.ascii_only",
    quote: "took 115.4 KiB out of an app",
  },
  {
    file: "__tests__/minifier-audit.test.ts",
    path: "output.ascii_only",
    quote: "cost this app 115 KiB for two years",
  },
  {
    file: "__tests__/native-bundle-report.test.ts",
    path: "output.ascii_only",
    quote: "the 115 KiB `ascii_only: false` bought",
  },
];

/** The unit a prose quantity is written in — the two this table measures in. */
export type ProseQuantityUnit = "KiB" | "%";

/**
 * The first quantity a fragment states, with its unit.
 *
 * Thousands separators are allowed in the digits because the prose writes them
 * ("33 bytes out of 3,718,641"), and the unit has to follow the number across
 * whitespace only — which is what makes "3,718,641 — 0.0009%" parse as the
 * percentage it ends with rather than as the total it opens with.
 */
export function quotedQuantity(quote: string): { value: number; unit: ProseQuantityUnit } | null {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*(KiB|%)/.exec(quote);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value === 0) return null;
  return { value, unit: match[2] as ProseQuantityUnit };
}

/** A prose statement of a measurement that no longer matches its row. */
export type ProseQuoteProblem =
  | { readonly code: "file_unread"; readonly file: string; readonly path: string; readonly quote: string }
  | { readonly code: "quote_gone"; readonly file: string; readonly path: string; readonly quote: string }
  | { readonly code: "no_quantity"; readonly file: string; readonly path: string; readonly quote: string }
  | { readonly code: "no_measurement"; readonly file: string; readonly path: string; readonly quote: string }
  | {
      readonly code: "stale";
      readonly file: string;
      readonly path: string;
      readonly quote: string;
      readonly noted: number;
      readonly derived: number;
      readonly unit: ProseQuantityUnit;
    }
  | { readonly code: "unregistered"; readonly file: string; readonly path: string; readonly quote: string };

/** `115` and `115.4` both, and `1154` and `94` neither. */
function kibMentions(text: string, kib: number): string[] {
  const pattern = new RegExp(`(?<![\\d.])${String(kib)}(\\.\\d+)?\\s*KiB`, "g");
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

/**
 * The registry held against the tree, in both directions.
 *
 * Forward: every registered fragment is still in its file and still states the
 * number its row derives. That is the direction a re-measurement breaks, and it
 * breaks loudly, once per stale site.
 *
 * Backward, and this is the direction a registry usually lacks: any module that
 * spells an audited row's KiB figure and has no entry for it is reported as
 * `unregistered`. A new header quoting "115 KiB" joins the check by existing
 * rather than by somebody remembering this list — the same argument
 * {@link evidenceClaims} makes for not keeping a second table of evaluators.
 *
 * KiB only for the backward half, and the asymmetry is on purpose: an integer
 * KiB figure is a string a scan can look for, while a percentage is rounded to
 * whatever reads well ("3%" for 3.1667%) and cannot be searched for without
 * guessing how the writer rounded. Rows measured at under half a KiB have no
 * such string at all — `reduce_funcs` rounds to 0 — so they are checked in the
 * forward direction only, which is where their percentages are anyway.
 */
export function proseQuoteProblems(
  modules: readonly EvidenceModule[],
  quotes: readonly ProseQuote[] = AUDITED_PROSE_QUOTES,
  options: readonly AuditedMinifierOption[] = AUDITED_MINIFIER_OPTIONS,
): ProseQuoteProblem[] {
  const problems: ProseQuoteProblem[] = [];
  const byPath = new Map(modules.map((module) => [module.path, module.text]));
  for (const entry of quotes) {
    const text = byPath.get(entry.file);
    if (text === undefined) {
      problems.push({ code: "file_unread", ...entry });
      continue;
    }
    if (!text.includes(entry.quote)) {
      problems.push({ code: "quote_gone", ...entry });
      continue;
    }
    const quantity = quotedQuantity(entry.quote);
    if (!quantity) {
      problems.push({ code: "no_quantity", ...entry });
      continue;
    }
    const measured = auditedDelta(entry.path, options);
    if (!measured || measured.bytes === 0) {
      problems.push({ code: "no_measurement", ...entry });
      continue;
    }
    // The unrounded KiB, deliberately: `measured.kib` is what a MESSAGE prints
    // and 115.4 in a sentence is not a stale copy of 115. The tolerance is
    // what decides that, and it should not be spent on a rounding this
    // function already applied.
    const derived = quantity.unit === "KiB" ? measured.bytes / 1024 : measured.share;
    if (Math.abs(quantity.value - derived) / derived >= PROSE_QUANTITY_TOLERANCE) {
      problems.push({
        code: "stale",
        ...entry,
        noted: quantity.value,
        derived,
        unit: quantity.unit,
      });
    }
  }
  const registered = new Set(quotes.map((entry) => `${entry.file}\u0000${entry.path}`));
  for (const option of options) {
    if (option.measuredDeltaBytes === null || option.measuredDeltaBytes === 0) continue;
    const kib = Math.round(Math.abs(option.measuredDeltaBytes) / 1024);
    if (kib === 0) continue;
    const path = option.path.join(".");
    for (const module of modules) {
      if (registered.has(`${module.path}\u0000${path}`)) continue;
      for (const mention of kibMentions(module.text, kib)) {
        problems.push({ code: "unregistered", file: module.path, path, quote: mention });
      }
    }
  }
  return problems;
}

/** The stale prose as one sentence each, naming the file, the row and the edit. */
export function formatProseQuoteProblems(problems: readonly ProseQuoteProblem[]): string {
  if (problems.length === 0) return "";
  const lines: string[] = [];
  for (const problem of problems) {
    if (problem.code === "file_unread") {
      lines.push(
        `  ${problem.file}: AUDITED_PROSE_QUOTES says this module quotes ${problem.path}, and it was not among the modules scanned — the file moved or was deleted, and its entry went with it.`,
      );
    } else if (problem.code === "quote_gone") {
      lines.push(
        `  ${problem.file}: no longer contains "${problem.quote}" (${problem.path}). The sentence was rewritten; re-take the fragment from the file, on one line, so the number stays checked.`,
      );
    } else if (problem.code === "no_quantity") {
      lines.push(
        `  ${problem.file}: "${problem.quote}" (${problem.path}) states no KiB or % figure, so it pins nothing. Widen the fragment to include the number it was registered for.`,
      );
    } else if (problem.code === "no_measurement") {
      lines.push(
        `  ${problem.file}: "${problem.quote}" quotes a cost for ${problem.path}, and that row has no non-zero measurement to quote. Either the row lost its delta or the prose is about a different option.`,
      );
    } else if (problem.code === "stale") {
      lines.push(
        `  ${problem.file}: says ${String(problem.noted)}${problem.unit === "%" ? "%" : " KiB"} for ${problem.path}, and the row derives ${problem.unit === "%" ? `${problem.derived.toFixed(5)}%` : `${problem.derived.toFixed(1)} KiB`} — the row was re-measured and this sentence was not. Update the prose and the fragment in AUDITED_PROSE_QUOTES together.`,
      );
    } else {
      lines.push(
        `  ${problem.file}: says "${problem.quote}", which is ${problem.path}'s measured cost, and no AUDITED_PROSE_QUOTES entry covers this module for that row. Register it — an unregistered copy is a number that stays behind when the row moves.`,
      );
    }
  }
  return [
    `${problems.length} prose statement(s) of an audited measurement disagree with the table: a number written into a sentence is a copy, and the copy is the one that stays behind.`,
    ...lines,
  ].join("\n");
}
