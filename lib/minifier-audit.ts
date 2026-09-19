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
