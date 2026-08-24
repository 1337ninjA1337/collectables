/**
 * The two provenance tables this repository guards, as DATA the guard loops
 * over rather than as two hand-written passes in one script.
 *
 * `scripts/check-privacy-baseline-provenance.ts` asks the same question of
 * `PRIVACY_BODY_BASELINES` (a word count per page) and of
 * `PRIVACY_TRANSLATION_SOURCES` (a checksum of the English disclosure and of
 * each translation): a recorded measurement moved, did the diff say why. It
 * asked it twice, in two copies of the same six steps — read the module at the
 * base revision, classify what came back, evaluate, print the report to the
 * stream its verdict earns, print a skip line when the drift half could not
 * run, honour the exit code last.
 *
 * Two copies is a shape, not a duplication problem; the third is where it
 * becomes one, and the third is the copy nobody reviews. So the six steps live
 * here once, in {@link defineProvenanceTable}, and each table contributes only the
 * things that genuinely differ: its module path, its current value, how to
 * parse a previous revision, how to judge one, and the sentences it says about
 * itself — one of which, the hard failure, is written only by an entry that can
 * reach it. Adding a table is an entry in {@link PROVENANCE_TABLES}; the script
 * does not change.
 *
 * WHAT STAYED IN THE SCRIPT, and why this module is not "the guard": every
 * question that needs git. Which revision to compare against (`--base`, the env
 * var, the PR target, `HEAD~1`, all through `merge-base`), whether the root is a
 * work tree, whether the clone is shallow — that is the CI-specific reasoning,
 * it is shared by every table by construction, and it is the half that cannot be
 * unit-tested without a repository. Everything here is pure: text in, verdict
 * and sentences out.
 *
 * The generic parameter is erased at the boundary on purpose. {@link ProvenanceTable}
 * is a closure over a table's own type, so `PROVENANCE_TABLES` can hold two
 * entries whose tables share no field name without widening either one to
 * `unknown` — and so the script cannot reach a parsed table at all, which is the
 * point: it has nothing left to get wrong about one.
 */

import { checkError } from "./check-error";
import {
  classifyBaselineRevision,
  evaluatePrivacyBaselineProvenance,
  formatBaselineProvenanceReport,
  formatBaselineRevisionUnparseable,
} from "./privacy-baseline-provenance";
import { PRIVACY_BODY_BASELINES } from "./privacy-body-baselines";
import {
  PRIVACY_TRANSLATION_SOURCES,
  parsePrivacyTranslationSources,
} from "./privacy-translated-section";
import {
  evaluateTranslationProvenance,
  formatTranslationProvenanceReport,
} from "./privacy-translation-provenance";
import {
  evaluateScrubPromiseProvenance,
  formatScrubPromiseProvenanceReport,
} from "./scrub-promise-provenance";
import {
  SCRUB_PROMISE_BASELINE,
  parseScrubPromiseBaseline,
} from "./sentry-scrub-promises";

/**
 * A table as it stood at some previous revision — and, when there is none,
 * WHICH kind of none.
 *
 * `absent` is a skip (the module predates the guard, so no baseline can have
 * moved); `unparseable` is a failure (the module was there and yielded nothing,
 * which is how a rename or a reformat silently turns the drift half off). Only
 * git can tell those apart, so the presence bit is an input rather than
 * something inferred from the text.
 *
 * Which of the two a table calls it is that table's decision, made in its own
 * `classify` — and an entry that can return `unparseable` owes the reader a
 * sentence, so it must declare {@link ProvenanceTableSpec.unparseable}. An entry
 * that collapses this case into `absent` must not: see that field.
 */
export type ProvenanceRevision<T> =
  | { readonly kind: "table"; readonly table: T }
  | { readonly kind: "absent" }
  | { readonly kind: "unparseable" };

/**
 * The part of a table's verdict this module needs. Both evaluators return more
 * than this (their own failure lists, with their own codes); the loop reads only
 * the two fields it has to branch on, and hands the whole verdict back to that
 * table's own formatter for the words.
 */
export type ProvenanceVerdict = {
  readonly ok: boolean;
  /** Base revision the drift half ran against, or null when it did not run. */
  readonly comparedAgainst: string | null;
};

/** What the loop knows about a base revision, before any table has read it. */
export type ProvenanceBaseRevision = {
  /**
   * The revision to compare against, or null when there is none at all (an
   * unborn HEAD, a root commit). Null means every table's drift half sits out
   * for the same reason, which the script says once rather than per table.
   */
  readonly ref: string | null;
  /** Whether the table's module path existed at `ref`. */
  readonly present: boolean;
  /** The module's source at `ref`, or null when git could not show it. */
  readonly source: string | null;
  /**
   * Repo-relative posix paths the same diff touched, as `git diff --name-only`
   * emits.
   *
   * Deliberately UNFILTERED, and deliberately shared. Before the loop each table
   * asked for its own diff and could in principle have asked a narrower
   * question; none did. "Which files the diff touched" is now a guard-level fact
   * rather than a per-table one, so a table wanting a path-filtered view of it
   * has to change the loop rather than its own entry — which is the right place
   * for that argument to happen.
   *
   * Shape-checked once, by {@link changedFilesRefusal}, for the same reason: a
   * list that is not repo-relative makes every table's answer wrong in the same
   * way.
   */
  readonly changedFiles: readonly string[];
};

export type ProvenanceOutcome =
  /**
   * The module existed at the base revision and no table came out of it. A
   * failure rather than a skip, and a HARD one: the script stops here, because
   * every report printed after it would be a report from a guard whose drift
   * half is off.
   */
  | { readonly kind: "unparseable"; readonly message: string }
  | {
      readonly kind: "evaluated";
      readonly ok: boolean;
      /** The table's own report, for the stream `ok` earns it. */
      readonly report: string;
      /**
       * Non-null when there WAS a base revision and this table could not be read
       * there — the one case a shared "drift halves skipped" line would get
       * wrong, since the other table may have compared fine.
       */
      readonly driftSkipped: string | null;
    };

/**
 * One table's contribution to the loop: what it is, how to read it, how to judge
 * it, and what it says about itself.
 *
 * `run` is the erased form — see the module note. Build entries with
 * {@link defineProvenanceTable} rather than by hand, so the type stays tied to
 * the parser and the evaluator that share it.
 */
export type ProvenanceTable = {
  /** Short name, for tests and for the registry's own parity cases. */
  readonly id: string;
  /** Repo-relative path of the module holding the table. */
  readonly module: string;
  /**
   * Whether an unreadable module at the base revision stops the whole run for
   * this entry — DERIVED, not declared: it is true exactly when the entry wrote
   * an {@link ProvenanceTableSpec.unparseable} sentence, so it restates nothing.
   * The presence of the sentence is the single statement of the fact; this is
   * that one fact, readable from outside the closure.
   *
   * It exists because the sentence itself is not readable from out here — the
   * generic is erased and `run` is the only way in — so a sentence written for a
   * `classify` that can never produce one is prose no run can print and no case
   * can proofread. That state is now visible: the registry's suite runs each
   * entry against a present-but-unreadable source and requires the OUTCOME to
   * agree with this flag, in both directions. A declared-but-unreachable
   * sentence turns it red; so does a `classify` that reaches for a sentence its
   * entry never wrote.
   */
  readonly stopsTheRun: boolean;
  readonly run: (
    checkName: string,
    base: ProvenanceBaseRevision,
  ) => ProvenanceOutcome;
};

/**
 * What one table brings to the loop. `T` is its table type and `V` its
 * evaluator's verdict; both are erased by {@link defineProvenanceTable}, so no
 * two entries have to agree on either.
 */
export type ProvenanceTableSpec<T, V extends ProvenanceVerdict> = {
  /** Short name, for tests and for the registry's own parity cases. */
  readonly id: string;
  /** Repo-relative path of the module holding the table. */
  readonly module: string;
  /** The table as it stands in THIS checkout — never read from history. */
  readonly current: T;
  readonly classify: (
    present: boolean,
    source: string | null,
  ) => ProvenanceRevision<T>;
  readonly evaluate: (input: {
    readonly current: T;
    readonly previous: T | null;
    readonly baseRef: string | null;
    readonly changedFiles: readonly string[];
  }) => V;
  readonly report: (checkName: string, verdict: V) => string;
  /**
   * The hard failure above, in this table's own words — and OPTIONAL, because
   * only an entry whose `classify` can return `unparseable` can ever print one.
   *
   * Writing one anyway is the failure this field is optional to prevent: the
   * generic parameter is erased at the boundary, so a sentence here is reachable
   * only through a `run` its own `classify` decides, and an entry that collapses
   * `unparseable` into `absent` produces prose no run can print and no case can
   * proofread. It can name the wrong module, or the wrong table, or be a copy of
   * a neighbour's wording, and every build stays green.
   *
   * So the two entries that collapse do not write one, and
   * {@link ProvenanceTable.stopsTheRun} carries the presence of this field out
   * to where the registry's suite can hold it against what `run` actually does.
   *
   * Note what declaring one COSTS before adding it: the first `unparseable`
   * stops the run, so every table after this one in {@link PROVENANCE_TABLES}
   * loses its report — a mangled module here suppresses a neighbour's failure
   * that would have been perfectly readable. That blast radius is the reason
   * this is a per-entry decision and not the default.
   */
  readonly unparseable?: (checkName: string, ref: string) => string;
  /** The line printed when this table alone could not be read at the base. */
  readonly driftSkipped: (checkName: string, ref: string) => string;
};

/**
 * The six steps, once. Every table runs exactly this; the differences are the
 * callbacks it brought.
 */
export function defineProvenanceTable<T, V extends ProvenanceVerdict>(
  spec: ProvenanceTableSpec<T, V>,
): ProvenanceTable {
  const unparseable = spec.unparseable;
  return {
    id: spec.id,
    module: spec.module,
    stopsTheRun: unparseable !== undefined,
    run(checkName, base) {
      const revision =
        base.ref === null
          ? ({ kind: "absent" } as const)
          : spec.classify(base.present, base.source);
      if (revision.kind === "unparseable" && base.ref !== null) {
        return {
          kind: "unparseable",
          // A `classify` that reaches for a sentence its entry never wrote is a
          // registry bug, not a table's verdict — but it is reached with the
          // drift half already off, so it refuses in words rather than falling
          // through to an evaluation that would print a pass.
          message:
            unparseable === undefined
              ? checkError(
                  checkName,
                  `the "${spec.id}" provenance entry classified ${spec.module} at ${base.ref} as unparseable but declares no unparseable sentence, so the guard has stopped with nothing to tell you about it. Either give the entry in lib/provenance-tables.ts a sentence naming the module and the revision, or collapse the classification into "absent" and let its driftSkipped line say the drift half sat out.`,
                )
              : unparseable(checkName, base.ref),
        };
      }
      const previous = revision.kind === "table" ? revision.table : null;
      const verdict = spec.evaluate({
        current: spec.current,
        previous,
        baseRef: base.ref,
        changedFiles: base.ref === null ? [] : base.changedFiles,
      });
      return {
        kind: "evaluated",
        ok: verdict.ok,
        report: spec.report(checkName, verdict),
        driftSkipped:
          base.ref !== null && verdict.comparedAgainst === null
            ? spec.driftSkipped(checkName, base.ref)
            : null,
      };
    },
  };
}

/**
 * The word count per shipped policy page. The older of the two, and the one
 * whose `unparseable` branch was written after a reformat nearly turned its
 * drift half off unnoticed.
 */
const BASELINE_MODULE = "lib/privacy-body-baselines.ts";

const BASELINES_TABLE = defineProvenanceTable({
  id: "body-baselines",
  module: BASELINE_MODULE,
  current: PRIVACY_BODY_BASELINES,
  classify: classifyBaselineRevision,
  evaluate: evaluatePrivacyBaselineProvenance,
  report: formatBaselineProvenanceReport,
  unparseable: (checkName, ref) =>
    formatBaselineRevisionUnparseable(checkName, BASELINE_MODULE, ref),
  driftSkipped: (checkName, ref) =>
    `${checkName}: drift half skipped — ${BASELINE_MODULE} did not exist at ${ref}, so the guard predates it.`,
});

/**
 * The per-language checksums of the English disclosure and of each shipped
 * translation.
 *
 * `classify` collapses `unparseable` into `absent`, which is the one place this
 * entry deliberately differs from its neighbour: `parsePrivacyTranslationSources`
 * is days old and this suite round-trips it on every run, so the
 * reformat-defeats-parser branch cannot fire yet. Revisit it the first time THAT
 * parser changes — the trigger is per-parser, so this entry and the scrub-promise
 * one below stop being ready at different moments and neither reading is evidence
 * about the other.
 *
 * Being collapsed is why it declares no `unparseable` sentence: it could not
 * reach one, and an unreachable sentence is prose no run prints and no case
 * proofreads. Adding the classification back means writing the sentence in the
 * same edit.
 */
const TRANSLATION_MODULE = "lib/privacy-translated-section.ts";

const TRANSLATION_TABLE = defineProvenanceTable({
  id: "translation-sources",
  module: TRANSLATION_MODULE,
  current: PRIVACY_TRANSLATION_SOURCES,
  classify: (_present, source) => {
    const table =
      source === null ? null : parsePrivacyTranslationSources(source);
    return table === null ? { kind: "absent" } : { kind: "table", table };
  },
  evaluate: evaluateTranslationProvenance,
  report: formatTranslationProvenanceReport,
  // Worded so it cannot be mistaken for the baselines line, by a reader or by a
  // suite: the tables skip independently, and "drift half skipped" printed twice
  // with different modules behind it is how somebody concludes the whole guard
  // sat out.
  driftSkipped: (checkName, ref) =>
    `${checkName}: translation-checksum drift skipped — no ${TRANSLATION_MODULE} table was readable at ${ref}, so the guard predates it.`,
});

const PROMISE_MODULE = "lib/sentry-scrub-promises.ts";

/**
 * The fingerprint of the sentence promising what `scrubPII` strips from a crash
 * report.
 *
 * The third table, and the one the loop was written for: it is an entry here and
 * a parser and an evaluator of its own, and `scripts/check-privacy-baseline-provenance.ts`
 * did not change to accept it. That was the argument for building the registry
 * before a third table existed rather than after.
 *
 * One record rather than a map, which is why nothing here is per-key. Its
 * `absent`-only classification is the same SHAPE as the translation entry's and
 * a separate reading: `parseScrubPromiseBaseline` is new and round-tripped by
 * this suite on every run. When one of the two parsers hardens the other has not,
 * so these two entries flip independently — and, like its neighbour, this one
 * declares no `unparseable` sentence because it cannot reach one.
 */
const PROMISE_TABLE = defineProvenanceTable({
  id: "scrub-promise",
  module: PROMISE_MODULE,
  current: SCRUB_PROMISE_BASELINE,
  classify: (_present, source) => {
    const record = source === null ? null : parseScrubPromiseBaseline(source);
    return record === null ? { kind: "absent" } : { kind: "table", table: record };
  },
  evaluate: evaluateScrubPromiseProvenance,
  report: formatScrubPromiseProvenanceReport,
  driftSkipped: (checkName, ref) =>
    `${checkName}: scrub-promise drift skipped — no ${PROMISE_MODULE} record was readable at ${ref}, so the guard predates it.`,
});

/**
 * Order matters and is the reporting order: reports print in this sequence, and
 * the first `unparseable` is the one that stops the run.
 */
export const PROVENANCE_TABLES: readonly ProvenanceTable[] = [
  BASELINES_TABLE,
  TRANSLATION_TABLE,
  PROMISE_TABLE,
];

/**
 * Why the registry is worth checking BEFORE looping over it, and the one new
 * failure mode the loop introduced.
 *
 * Two hand-written passes could not skip themselves: deleting one was a diff
 * with a report line missing from it. A loop can — `every` over nothing is
 * true, so a registry that lost its entries (a bad merge, an entry commented
 * out during a debugging session and never restored) exits 0 with every report
 * line gone and nothing saying why. That is precisely the vacuous green each
 * table's own formatter already refuses one level down ("a pass over zero
 * baselines is not a pass"); this is the same sentence about the tables
 * themselves.
 *
 * Two entries with one id would be worse than a missing one, because the
 * reports would still print: `PROVENANCE_TABLES` is addressed by id in the
 * suites, so the second entry is the one nobody's case ever reaches.
 *
 * Returns the refusal, or null when the registry is fit to run.
 */
/**
 * How many offenders the refusal quotes before it stops. The failure this
 * catches is systematic — a diff resolved against the wrong root makes EVERY
 * entry wrong — so the first few are the whole diagnosis and the remaining
 * hundred are scroll.
 */
const CHANGED_FILES_QUOTED = 3;

/**
 * Why the guard checks the one input nothing else validates.
 *
 * Every evaluator validates its own table — dates, checksums, note lengths, keys
 * against a closed set — and then compares a recorded path against this list,
 * which arrives from `git diff --name-only` and is trusted on sight. Trusted for
 * good reason today: one caller builds it, one call, in the repository root. The
 * failure is what happens when that stops being true.
 *
 * A `git diff` run from a subdirectory, or a caller that resolved the entries
 * against the repo root before passing them, produces absolute or dot-prefixed
 * paths. Every table looks up `PRIVACY.md` in that set, finds nothing, and
 * reports the value as unbacked — so the guard prints six failures saying files
 * were untouched, naming files the reader can see in their own diff, and the
 * reader spends the morning looking for a bug in the recorded values. A stopped
 * run with a reason is worth more than six right-shaped failures with the wrong
 * cause.
 *
 * Two shapes are refused and a third deliberately is not. Absolute paths (posix
 * `/…` or a `C:` drive prefix) and paths re-anchored with `./` or `../` cannot
 * come out of a repo-root `--name-only` and cannot match a recorded path.
 * BACKSLASHES are left alone: git emits forward slashes on Windows too, so a
 * backslash here is either a legal posix filename or one of git's quoted
 * `"…\303\251…"` paths, and a guard that refused to run because somebody added a
 * file with an accent in its name would be deleted within the week.
 *
 * An EMPTY list is fine and is not this function's business: it means the diff
 * touched nothing, which each table already reads as "the file did not move".
 *
 * Returns the refusal, or null when the list is usable.
 */
export function changedFilesRefusal(
  checkName: string,
  changedFiles: readonly string[],
): string | null {
  const offenders = changedFiles.filter(
    (file) =>
      file === "" ||
      file.startsWith("/") ||
      /^[A-Za-z]:/.test(file) ||
      file === ".." ||
      file.startsWith("./") ||
      file.startsWith("../"),
  );
  if (offenders.length === 0) return null;
  const quoted = offenders
    .slice(0, CHANGED_FILES_QUOTED)
    .map((file) => JSON.stringify(file))
    .join(", ");
  const rest =
    offenders.length > CHANGED_FILES_QUOTED
      ? ` and ${offenders.length - CHANGED_FILES_QUOTED} more`
      : "";
  return checkError(
    checkName,
    `${offenders.length} of ${changedFiles.length} changed-file path(s) are not repo-relative: ${quoted}${rest}. Every table compares a recorded path (PRIVACY.md, PRIVACY.md.de, …) against this list, so none of them would match and every value that moved would be reported as describing an untouched file — six failures naming files you can see in your own diff. That is worse than stopping. The usual cause is a \`git diff --name-only\` run somewhere other than the repository root, or a caller that resolved the paths before passing them.`,
  );
}

export function provenanceRegistryRefusal(
  checkName: string,
  tables: readonly ProvenanceTable[],
): string | null {
  if (tables.length === 0) {
    return checkError(
      checkName,
      "no provenance tables are registered, and a pass over zero tables is not a pass. Every report this guard prints comes from an entry in lib/provenance-tables.ts; with none, it exits 0 having read nothing. provenanceOutput refuses the same emptiness one level down, over the outcomes rather than the registry — this one is the earlier and more specific of the two, not a duplicate of it.",
    );
  }
  const ids = tables.map((table) => table.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) {
    return checkError(
      checkName,
      `two provenance tables are registered as "${duplicate}" in lib/provenance-tables.ts. Both would run, and every case that addresses a table by id would reach only the first, so the second is guarded by nothing.`,
    );
  }
  return null;
}
