/**
 * The high/critical `npm audit` advisories this repo has triaged and accepted,
 * and the comparison that notices a NEW one.
 *
 * ## Why a baseline rather than a threshold
 *
 * `npm audit --audit-level=high` was already a CI step, and it was
 * `continue-on-error: true` — necessarily, because the accepted advisories
 * make it red on every run and a permanently-red step wedges nothing but
 * attention. The consequence is that it reported the same red for an advisory
 * somebody had read and for one nobody had ever seen: SECURITY.md recorded
 * "0 high/critical" on 2026-06-28 and the tree carried THIRTEEN by 2026-08-31,
 * with the step dutifully failing and being ignored the whole time.
 *
 * A baseline turns "always red" into "red when it changed", which is the only
 * form of this signal anybody acts on. The list below is the exemption list;
 * `evaluateAudit` is the thing that keeps it honest in BOTH directions — an
 * advisory that is not on it fails, and an entry that no longer appears in the
 * audit is reported as stale rather than left to accumulate.
 *
 * ## What "accepted" is allowed to mean
 *
 * Only ever "read, understood, and not exploitable HERE" — never "old", and
 * never "some other advisory in the same package was fine". Each entry lists
 * the GHSA ids it has read and says whether the package reaches the production
 * web bundle, because that is the question the severity number cannot answer:
 * every package left on this list is build-time tooling, so the vulnerable
 * code never runs where a user's input can reach it.
 *
 * `nanoid` was the one entry that shipped, accepted on the argument that no
 * bundled call site passes the shape its two advisories need. A THIRD nanoid
 * advisory arrived on 2026-09-02 — GHSA-xwg4-73v4-xw9w, an integer wraparound
 * in versions below 3.3.12 — and the entry was removed rather than extended.
 * `package.json` also carries an `overrides` pin to `^3.3.18`, so the fix
 * survives a lockfile regeneration rather than depending on one. An acceptance
 * whose argument has to be rewritten each time the package is re-audited is a
 * fix deferred, and this one shipped to every user.
 *
 * The KEY took three versions, and each wrong one failed differently. The
 * package name accepted every future CVE in an accepted package. npm's
 * per-path `source` id made the list churn with the lockfile, which turns a
 * blocking gate into noise. The GHSA is the advisory's own name and neither.
 *
 * ## And an advisory npm can already fix is not a triage decision
 *
 * The gate above answers one question — "is this advisory new?" — and for two
 * months nothing asked the other one: "is it still unfixable?". On 2026-09-01
 * `npm audit` said a fix was available WITHIN THE INSTALLED RANGE for four of
 * the six accepted roots (`nanoid`, `brace-expansion`, `js-yaml`, `tar`,
 * seven GHSAs between them), and one `npm update` cleared every one. They had
 * been sitting on the exemption list being read as triage.
 *
 * SECURITY.md had already said to "prefer `npm audit fix` (no breaking
 * changes)". That was guidance, and guidance is what this repository keeps
 * discovering is not enforcement. {@link fixKind} reads npm's own
 * `fixAvailable` and {@link evaluateAudit} FAILS on an advisory it can fix
 * without a major: an exemption whose fix is one command away is not a
 * decision somebody made, it is a notification nobody opened.
 *
 * A major-only fix stays acceptable and is reported rather than failed —
 * `expo@57` is a migration, not a gate's call to make — but it is now stated
 * by npm on every run instead of by a `why` sentence written once.
 *
 * ## The fixability question is not a high/critical question
 *
 * That rule shipped reading high and critical only, because it was written
 * inside the baseline and the baseline is a high/critical triage list. The two
 * are different questions and only one of them needs a severity: "has somebody
 * read this?" is worth a human's attention at high, and "can npm already fix
 * it?" costs one `npm update` at any severity at all.
 *
 * Measured on 2026-09-02, the day after that rule landed: THREE roots had an
 * in-range fix waiting and none of them was high — `dompurify` (low +
 * moderate), `undici` (three moderates) and `esbuild` (low, reachable by
 * moving `tsx` inside its own declared range). Ten of the tree's fourteen
 * distinct advisories were moderate or low, and nothing was asking about any
 * of them.
 *
 * The event that makes this worth blocking on is not any of those three. It is
 * `postcss`: moderate when it was first triaged in June, high by August, on a
 * lockfile nobody had touched. A moderate with a published fix is a high with
 * a published fix that has not been re-scored yet, and the run that would have
 * noticed is the one where it was still cheap.
 *
 * So {@link observedAdvisoryDetails} walks every severity and
 * {@link evaluateAudit} builds `fixableInRange` and `majorOnly` from ALL of
 * them, while `unexpected`, `stillPresent` and `stale` stay high/critical:
 * widening those would demand a triage sentence for ten advisories nobody has
 * argued about, which is the exemption-list-as-paperwork failure this file
 * already carries the scar of. Widening the fix rule demands a lockfile bump
 * and nothing else.
 *
 * ## And the command it prints has to name the package npm would move
 *
 * The rule shipped printing `npm update <vulnerable package>`, and on the
 * first run that demanded three fixes, one of the three was wrong: `esbuild`'s
 * in-range fix was `npm update tsx`, because `tsx` declares `esbuild: ~0.27.0`
 * and the fixed release was outside it. The vulnerable package could not move
 * on its own, so the printed command exited 0 having changed nothing — the
 * worst failure a fix instruction has, because it looks like it worked.
 *
 * The report said so twice over and neither was read. `fixAvailable`'s object
 * shape carries the `name` of the install npm would perform — `expo` for
 * `postcss`, `expo-router` for `decode-uri-component` — and the field was read
 * for {@link fixKind} with its name thrown away. And where npm names nobody, as
 * it did for `esbuild`, `effects` lists the dependents the advisory reaches and
 * `isDirect` says which of them the manifest declares: `tsx`, from the same
 * report the wrong command was printed from.
 *
 * {@link fixPackage} reads both, {@link fixCommandPackages} builds the command
 * out of them, and a finding whose fix lives in another package says so on its
 * own line — a contributor who runs the command should not have to work out
 * why it was the right one.
 */

import { plural } from "./plural";

/** One triaged advisory root. Transitive dependents are not listed. */
export interface AcceptedAdvisory {
  /** The package `npm audit` names as the advisory's root. */
  readonly package: string;
  /**
   * The GHSA identifiers this entry has actually read.
   *
   * Identity is the point, and it took two goes to get right. The first
   * version keyed on the package NAME, and `nanoid` was already carrying two
   * high advisories — so the `why` reasoned about one and silently accepted
   * the other, which is the failure a baseline exists to prevent, reproduced
   * inside the baseline. The second keyed on npm's `via[].source`, which is
   * reported ONCE PER DEPENDENCY PATH: `brace-expansion`'s three advisories
   * arrived as nine ids, so a lockfile reshuffle that added or dropped a path
   * would have turned a BLOCKING gate red for a tree-shape change with no
   * security content — and a gate that cries wolf on churn is a gate somebody
   * switches off.
   *
   * The GHSA is the advisory's own name: stable across paths, across
   * lockfiles, and the thing a person actually reads at
   * `https://github.com/advisories/<id>`.
   */
  readonly advisories: readonly string[];
  /**
   * Whether the package's code reaches the production web bundle.
   *
   * Not the same as "vulnerable": a package can ship and still be safe when
   * the vulnerable entry point is unreachable from this app's call sites.
   */
  readonly shipsToClient: boolean;
  /**
   * The call sites the reachability argument was made about — required of
   * every `shipsToClient: true` entry, meaningless on the others.
   *
   * This is the other half of the column, and it is the half that shipped.
   * `nanoid` is the only entry that ever reached a browser, accepted on the
   * argument that no bundled call site passes the shape its advisories need.
   * That argument was true, was written once, and was re-derived by nobody —
   * and being wrong about it means shipping a vulnerability rather than
   * mislabelling a build tool, which is the opposite way round from the risk
   * `absentFingerprint` covers.
   *
   * Repo-relative paths, because the argument is only checkable if it says
   * WHERE it was made: `ships-to-client.test.ts` asserts each file is still in
   * the tree and still names the package. Neither settles reachability — no
   * grep can — but "the files this was argued from still exist and still use
   * it" is the difference between a claim somebody can re-read and a sentence
   * nobody can locate.
   */
  readonly reachedFrom?: readonly string[];
  /**
   * A string from the package's own code that would appear in `dist/` if it
   * shipped — required of every `shipsToClient: false` entry, meaningless on
   * the others.
   *
   * `shipsToClient` was the load-bearing half of every exemption here and the
   * half nothing checked: "build-time only" was a sentence somebody wrote once,
   * and the one entry that ever DID ship (`nanoid`) was found by reading rather
   * than by measuring. `check-ships-to-client` greps the built bundle for this
   * string, so the column is an assertion the build can refute.
   *
   * A STRING LITERAL, never an identifier: minification renames every symbol
   * and rewrites no string, so `'CssSyntaxError'` survives into the bundle and
   * `class CssSyntaxError` does not. Distinctive enough that a hit means this
   * package — `image-size` cannot be its own fingerprint, because the bundle
   * carries the icon name `image-size-select-actual` and always has.
   *
   * Optional in the type and required by a case, deliberately: the six
   * `AcceptedAdvisory` fixtures in the suite exist to exercise `evaluateAudit`
   * and never build a bundle, and a compile-time demand would put a
   * fingerprint in all of them to satisfy the compiler rather than the reader.
   */
  readonly absentFingerprint?: string;
  /** Why these are accepted rather than fixed. One sentence. */
  readonly why: string;
}

/**
 * Re-triaged 2026-09-01 against `npm audit` on the committed lockfile.
 *
 * TWO roots carrying 4 distinct advisories, down from six roots and 11. The
 * seven that left were not re-argued, they were FIXED: npm reported an
 * in-range fix for `nanoid`, `brace-expansion`, `js-yaml` and `tar`, and
 * `npm update` on those four took every one of their advisories out of the
 * report. What remains is what a `npm update` cannot reach.
 *
 * `npm audit` reports 9 high ENTRIES and more `via` objects than that for
 * these 4: the extra entries are Expo/metro packages that merely depend on
 * these two and carry no advisory of their own, and the extra objects are one
 * advisory seen down several dependency paths.
 *
 * Both remaining entries are fixed only by `expo@57`, a major, which is why
 * they are still here — and {@link evaluateAudit} now re-checks that claim
 * against npm on every run rather than trusting the sentence.
 */
export const ACCEPTED_HIGH_ADVISORIES: readonly AcceptedAdvisory[] = [
  {
    package: "image-size",
    advisories: ["GHSA-5p2g-fcmc-qvqq", "GHSA-w3rx-r6r6-pgpr"],
    shipsToClient: false,
    absentFingerprint: "invalid invocation. input should be a Uint8Array",
    why: "JXL/HEIF and ICNS parser DoS in metro's asset pipeline, build-time only (the string in the bundle is the icon name image-size-select-actual, not this package); fix is expo@57, a breaking major",
  },
  {
    package: "postcss",
    advisories: ["GHSA-6g55-p6wh-862q", "GHSA-r28c-9q8g-f849"],
    shipsToClient: false,
    absentFingerprint: "CssSyntaxError",
    why: "arbitrary file read and source-map path traversal in @expo/metro-config's build-time CSS transform; fix is expo@57, a breaking major",
  },
];

/**
 * Whether a parsed payload is an audit REPORT, rather than npm's account of
 * why it could not produce one.
 *
 * The gate is documented as soft-skipping a run that cannot reach the registry,
 * and the reader that implements it treats an unparseable payload as the
 * signal. npm's registry failures are not unparseable: `npm audit --json`
 * emits `{"error":{"code":…,"summary":…}}`, which parses perfectly, carries no
 * `vulnerabilities`, and is therefore indistinguishable from a tree with no
 * advisories in it. {@link evaluateAudit} then reports every entry in
 * {@link ACCEPTED_HIGH_ADVISORIES} as stale, and the gate fails telling a
 * contributor to delete the whole baseline — which is the one edit that would
 * let a real advisory through in silence. It has happened: CI run 1573 spent
 * five and a half minutes in `npm audit` and failed with all four entries
 * "no longer reported", on a commit whose diff was four test files.
 *
 * A CLEAN tree is a different thing and must still get through: npm answers it
 * with `"vulnerabilities": {}`, the key present and empty. The key's presence
 * is exactly the line between "npm answered" and "npm failed", which is why it
 * is what this asks about.
 */
export function isAuditReport(parsed: unknown): parsed is AuditReport {
  if (typeof parsed !== "object" || parsed === null) return false;
  const payload = parsed as { error?: unknown; vulnerabilities?: unknown };
  // npm's own failure shape, and the reason this predicate exists.
  if (payload.error !== undefined) return false;
  return typeof payload.vulnerabilities === "object" && payload.vulnerabilities !== null;
}

/**
 * What `npm audit --json` produced: a report, or the reason there is not one.
 *
 * The skip used to print one sentence — "no parseable audit report (registry
 * unreachable?)" — for every way of failing, and a skip nobody can tell from a
 * pass is how two red runs were read as the registry moving rather than as the
 * registry being down. npm's error object carries a `code` and a `summary`
 * that name the actual failure; a truncated read and a renamed field are
 * different problems with different fixes, and all three said the same thing.
 *
 * Pure, and it owns the parse: the decision and the sentence explaining it come
 * out of one place, so a caller cannot skip for one reason and report another.
 */
export type AuditRead =
  | { readonly report: AuditReport; readonly skip?: undefined; readonly cause?: undefined }
  | { readonly report?: undefined; readonly skip: string; readonly cause: AuditSkipCause };

/**
 * WHO gave up, which is the half the sentence alone does not carry.
 *
 * Three skips in a row read identically today, and they call for opposite
 * responses: if this gate abandoned the call, the bound may be too tight and
 * the registry may be fine; if npm reported a failure, the registry answered
 * and the bound is irrelevant; if the output was unreadable, neither of them
 * said anything and something has changed about npm itself.
 */
export const AUDIT_SKIP_CAUSES = [
  /** The gate stopped waiting. Nobody said the registry was down. */
  "abandoned",
  /** npm named a failure — the registry was reached and refused. */
  "refused",
  /** npm produced something that is not a report, and did not say why. */
  "unreadable",
] as const;

export type AuditSkipCause = (typeof AUDIT_SKIP_CAUSES)[number];

/**
 * A few words naming who gave up, for the front of a log line.
 *
 * A record rather than a `switch`, and the causes are a `const` array rather
 * than a bare union, because there was no way to ASK what the causes are. The
 * suite wrote the same three literals a second time to loop over them, so a
 * fourth cause would have been a compile error here and an untested headline
 * there — the two-lists arrangement half this week's entries are about, in the
 * one place a type could supply the list instead.
 *
 * The record's key type is the union, so a cause added to the array without a
 * headline does not compile; and the suite derives its population from the same
 * array, so it does not silently keep testing three of four.
 */
const SKIP_HEADLINES: Record<AuditSkipCause, string> = {
  abandoned: "we stopped waiting",
  refused: "npm reported a failure",
  unreadable: "npm's output was not a report",
};

export function auditSkipHeadline(cause: AuditSkipCause): string {
  return SKIP_HEADLINES[cause];
}

/** As much of npm's own account of a failure as it gave. */
function npmErrorSentence(error: unknown): string {
  if (typeof error !== "object" || error === null) return `npm reported an error (${typeof error})`;
  const { code, summary } = error as { code?: unknown; summary?: unknown };
  const named = typeof code === "string" && code !== "" ? code : "no code";
  const said = typeof summary === "string" && summary !== "" ? ` — ${summary}` : "";
  return `npm reported an error: ${named}${said}`;
}

/**
 * How long `npm audit` gets to answer before the gate stops waiting.
 *
 * The gate had no bound at all, and what that costs is measured rather than
 * imagined: a healthy run answers in 49 seconds, and on 2026-09-04 three runs
 * on `main` sat in it for 5m35s, 7m and past 13m while the registry was
 * degraded — the first two then produced a WRONG answer (every baseline entry
 * read as withdrawn), and the third was still running when this was written.
 *
 * Three minutes is a little under four times the healthy run. A bound that is
 * hit is cheap on purpose: it produces a skip, which is a run that did not
 * check advisories and says so on the summary, not a red one and not a wrong
 * one. Being slightly too tight costs one annotated skip; having no bound at
 * all costs the run and, twice today, the answer.
 */
export const AUDIT_TIMEOUT_MS = 180_000;

/**
 * Why a failed `npm audit` INVOCATION produced no answer worth reading, or
 * `undefined` if what it did print should be parsed after all.
 *
 * `npm audit` exits non-zero whenever it finds anything, and that exit still
 * carries the whole report on stdout — so a failed invocation is normally a
 * successful read. What is different about a killed one is that its output is
 * whatever had been flushed when the signal arrived: not an answer, and not
 * npm's account of why there is none either.
 */
export function auditInvocationSkip(failure: unknown, timeoutMs: number): AuditRead | undefined {
  if (typeof failure !== "object" || failure === null) return undefined;
  const { signal, code } = failure as { signal?: unknown; code?: unknown };
  const waited = `${String(Math.round(timeoutMs / 1000))}s`;
  // "abandoned" in both branches, and it is the whole point of the label: the
  // registry never said anything here. THIS gate stopped waiting, so a run of
  // these means the bound may be too tight, where a run of "refused" means the
  // registry answered and the bound is irrelevant.
  //
  // A timeout kills the child, so the signal is the reliable half; `ETIMEDOUT`
  // is node's own name for it and is checked because a future node could set
  // one without the other.
  if (typeof signal === "string" && signal !== "") {
    return {
      cause: "abandoned",
      skip: `npm audit was killed with ${signal} after ${waited} — the registry was not answering, and a partial read is not an answer`,
    };
  }
  if (code === "ETIMEDOUT") {
    return {
      cause: "abandoned",
      skip: `npm audit did not answer within ${waited} — the registry was not answering, and a partial read is not an answer`,
    };
  }
  return undefined;
}

export function readAuditPayload(raw: string): AuditRead {
  if (raw.trim() === "") {
    return {
      cause: "unreadable",
      skip: "npm printed nothing, so it did not get as far as an answer",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Bounded on purpose: this goes to a CI log, and npm's non-JSON output on a
    // bad day is a stack trace.
    return {
      cause: "unreadable",
      skip: `npm's output is not JSON: ${JSON.stringify(raw.trim().slice(0, 120))}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {
      cause: "unreadable",
      skip: `npm's output is a ${parsed === null ? "null" : typeof parsed}, not a report`,
    };
  }
  const payload = parsed as { error?: unknown };
  if (payload.error !== undefined) {
    return { cause: "refused", skip: npmErrorSentence(payload.error) };
  }
  if (!isAuditReport(parsed)) {
    return {
      cause: "unreadable",
      skip: "npm's output carries no `vulnerabilities`, so it does not say which advisories are open",
    };
  }
  return { report: parsed };
}

/** Shape of the slice of `npm audit --json` this reads. */
export interface AuditReport {
  readonly vulnerabilities?: Readonly<
    Record<
      string,
      {
        readonly severity?: string;
        readonly via?: readonly unknown[];
        /**
         * npm's own answer to "can I fix this?", in three shapes: `false`,
         * `true` (an in-range update), or the upgrade it would perform.
         */
        readonly fixAvailable?: unknown;
        /** Whether `package.json` declares this package itself. */
        readonly isDirect?: boolean;
        /** The vulnerable dependents this advisory reaches. See {@link fixPackage}. */
        readonly effects?: readonly string[];
      }
    >
  >;
}

/** What `npm audit` says it would take to make an advisory go away. */
export type FixKind =
  /** npm offers nothing — the advisory has no published fix yet. */
  | "none"
  /** `npm update <package>` clears it: no manifest edit, no breaking change. */
  | "in-range"
  /** Only a semver-major upgrade clears it — a migration, not a gate's call. */
  | "major";

/**
 * Reads npm's `fixAvailable` field.
 *
 * Three shapes and they are not interchangeable. A bare `true` means npm can
 * resolve the fix inside the ranges the manifest already declares — the case
 * that cost this repo seven exemptions, because it looks exactly like `false`
 * from anywhere except this field. An object is the upgrade npm would perform,
 * and only `isSemVerMajor` distinguishes `npm update` from a migration; an
 * object with `isSemVerMajor: false` is still an in-range fix.
 *
 * Anything else — absent, `false`, a shape npm has not used yet — is "none".
 * The gate fails on "in-range" only, so an unrecognised shape reads as "npm
 * offered nothing", which is the direction that cannot invent a failure out of
 * a field npm changes.
 */
export function fixKind(fixAvailable: unknown): FixKind {
  if (fixAvailable === true) return "in-range";
  if (typeof fixAvailable !== "object" || fixAvailable === null) return "none";
  return (fixAvailable as { isSemVerMajor?: unknown }).isSemVerMajor === true
    ? "major"
    : "in-range";
}

/**
 * The package `npm update` has to name, which is not always the vulnerable one.
 *
 * Three sources, in the order of how much npm committed to them.
 *
 * **npm's own name.** The object shape of `fixAvailable` carries one, and it is
 * npm's answer to "what would I install?" — `expo` for `postcss`,
 * `expo-router` for `decode-uri-component`. Nothing here can beat that.
 *
 * **The dependent, when npm named nobody.** A bare `true` says only that a fix
 * exists inside the declared ranges, and that is where the wrong command came
 * from: `esbuild`'s fix was `npm update tsx`, because `tsx` pinned
 * `esbuild@~0.27.0` while the fix was `>=0.28.1` — the vulnerable package
 * could not move at all, and `npm update esbuild` exited 0 having changed
 * nothing, which is the worst thing a fix instruction can do. `effects` is
 * npm's list of the dependents an advisory reaches, so walking it to a package
 * the manifest declares (`isDirect`) finds the one that CAN move. That walk
 * answers `tsx` for `esbuild`, from the same report the old command was
 * printed from.
 *
 * **The vulnerable package**, when neither of those says otherwise — a direct
 * dependency is already the thing to move, and a chain that reaches no direct
 * package leaves nothing better to say. Same direction as {@link fixKind} on an
 * unrecognised shape: fall back to what was true before the field was
 * consulted, never to a guess.
 *
 * Breadth-first and sorted at each step, so a package reachable two ways gets
 * the same answer on every run; `effects` is cyclic in this tree (`metro` and
 * `metro-config` list each other), so the visited set is load-bearing rather
 * than defensive.
 */
export function fixPackage(report: AuditReport, vulnerablePackage: string): string {
  const entries = report.vulnerabilities ?? {};
  const named = namedFix(entries[vulnerablePackage]?.fixAvailable);
  if (named !== null) return named;
  if (entries[vulnerablePackage]?.isDirect === true) return vulnerablePackage;
  const seen = new Set([vulnerablePackage]);
  let frontier = [vulnerablePackage];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const name of frontier) {
      for (const effect of [...(entries[name]?.effects ?? [])].sort()) {
        if (seen.has(effect)) continue;
        seen.add(effect);
        if (entries[effect]?.isDirect === true) return effect;
        next.push(effect);
      }
    }
    frontier = next;
  }
  return vulnerablePackage;
}

/** npm's `fixAvailable.name`, or `null` when it did not name a package. */
function namedFix(fixAvailable: unknown): string | null {
  if (typeof fixAvailable !== "object" || fixAvailable === null) return null;
  const named = (fixAvailable as { name?: unknown }).name;
  return typeof named === "string" && named !== "" ? named : null;
}

/**
 * The severities a baseline entry is required for.
 *
 * npm reports five (`info`, `low`, `moderate`, `high`, `critical`) and this
 * gate demands a read-and-argued exemption for two of them. That is a
 * deliberate ceiling on how much prose a dependency tree can require: ten of
 * this tree's fourteen advisories are moderate or low, and a rule that made
 * each one need a `why` sentence would produce fourteen sentences nobody reads
 * rather than two somebody does.
 */
const TRIAGED_SEVERITIES: ReadonlySet<string> = new Set(["high", "critical"]);

/**
 * Most severe first, and everything npm has not used yet last.
 *
 * Only affects the order findings print in. An unknown severity sorting to the
 * bottom is the same choice {@link fixKind} makes about an unknown fix shape:
 * a field npm changes must not decide anything.
 */
const SEVERITY_ORDER: readonly string[] = ["critical", "high", "moderate", "low", "info"];

/** One advisory npm has an opinion about how to fix. */
export interface FixableAdvisory {
  /** `package#id`, the same key the baseline lists use. */
  readonly key: string;
  /** npm's severity for the ADVISORY, which is not the package's severity. */
  readonly severity: string;
  /**
   * The package `npm update` must name — npm's `fixAvailable.name` when it has
   * one, the vulnerable package otherwise. See {@link fixPackage}.
   */
  readonly updatePackage: string;
}

export interface AuditVerdict {
  /** High/critical advisories with no entry in the baseline — the failure. */
  readonly unexpected: readonly string[];
  /** Baseline advisories that still appear, i.e. the exemption still earns it. */
  readonly stillPresent: readonly string[];
  /** Baseline advisories the audit no longer reports — stale, remove them. */
  readonly stale: readonly string[];
  /**
   * Advisories npm can fix without a major, at EVERY severity — the other
   * failure.
   *
   * Accepted or not, high or low: "npm update clears this today" is the same
   * finding every way, and none of them is a triage decision. Carries the
   * package name to update, because a key alone leaves the reader to work out
   * the command, and the severity, because a reader who sees four of these
   * wants to know which one to read first.
   */
  readonly fixableInRange: readonly FixableAdvisory[];
  /**
   * Advisories at every severity whose only fix is a semver-major. Reported,
   * never failed: this is the claim each `why` sentence makes, restated by npm
   * on the run rather than by an author months ago.
   *
   * Same population as {@link fixableInRange} on purpose. Two lists answering
   * "what did npm say about this advisory?" over two different sets of
   * advisories would mean an advisory could leave the first list by changing
   * severity rather than by being fixed.
   */
  readonly majorOnly: readonly FixableAdvisory[];
}

/** `package#id`, the form every list in {@link AuditVerdict} carries. */
export function advisoryKey(pkg: string, id: number | string): string {
  return `${pkg}#${String(id)}`;
}

/**
 * The advisory's own name, from its `url`, falling back to npm's numeric id.
 *
 * `https://github.com/advisories/GHSA-xxxx-xxxx-xxxx` → `GHSA-xxxx-xxxx-xxxx`.
 * The fallback matters more than it looks: an advisory with no GHSA url is
 * still an advisory, and dropping it would be a silent hole in a gate whose
 * whole job is to have none. It keys by `source` instead and is therefore
 * path-sensitive, which is a worse key and still better than no key.
 */
export function advisoryIdentity(advisory: {
  source?: unknown;
  url?: unknown;
}): string | null {
  const url = typeof advisory.url === "string" ? advisory.url : "";
  const slug = url.split("/").pop() ?? "";
  if (/^GHSA-[\w-]+$/.test(slug)) return slug;
  if (advisory.source === undefined || advisory.source === null) return null;
  return String(advisory.source);
}

/**
 * The high/critical advisories `npm audit` attributes to each root package —
 * the population the baseline demands an entry for.
 *
 * {@link observedAdvisoryDetails} filtered to {@link TRIAGED_SEVERITIES} and
 * stripped of the fix verdict. The severity filter belongs HERE rather than in
 * the walk, because it is a fact about the exemption list ("what needs a `why`
 * sentence") and not about the audit: the fix rule reads the same walk and
 * wants every severity in it.
 */
export function observedAdvisories(report: AuditReport): readonly string[] {
  return [...observedAdvisoryFixes(report).keys()];
}

/**
 * The same population as {@link observedAdvisories}, keeping npm's fix verdict.
 *
 * `fixAvailable` is reported per VULNERABLE PACKAGE, not per advisory, so
 * every advisory on a root inherits the root's verdict. That is npm's
 * granularity and not a simplification here: the fix is an upgrade of the
 * package, and it moves all of its advisories or none of them.
 */
export function observedAdvisoryFixes(report: AuditReport): ReadonlyMap<string, FixKind> {
  return new Map(
    [...observedAdvisoryDetails(report)]
      .filter(([, detail]) => TRIAGED_SEVERITIES.has(detail.severity))
      .map(([key, detail]) => [key, detail.fix]),
  );
}

/** What one walk of the report knows about an advisory. */
export interface ObservedAdvisory {
  /** npm's severity for this advisory object. */
  readonly severity: string;
  /** npm's verdict on the ROOT PACKAGE, inherited by each of its advisories. */
  readonly fix: FixKind;
  /**
   * The package that carries the fix, read off the same `fixAvailable` the
   * verdict came from and inherited the same way. See {@link fixPackage}.
   */
  readonly updatePackage: string;
}

/**
 * Every advisory in the report, at every severity, with its fix verdict.
 *
 * The one walk. {@link observedAdvisoryFixes} is this filtered to the
 * severities the baseline triages and {@link evaluateAudit}'s fix lists are
 * this unfiltered — so the two questions the gate asks read the same
 * traversal, and "which advisories is the gate looking at?" has one answer per
 * question rather than two implementations that can drift.
 *
 * The four conditions that make an entry observable live here and nowhere
 * else: it must be an advisory OBJECT (a bare string `via` is a package that
 * merely depends on a vulnerable one, which changes with every tree reshape
 * and says nothing new about exposure), it must have an identity, it is keyed
 * per package, and the result is a SET — `brace-expansion`'s three advisories
 * arrive as nine `via` objects down nine paths and collapse to three here.
 *
 * Severity is read from the ADVISORY, never from the package: npm reports a
 * package at the highest severity among its advisories, so `postcss` is "high"
 * while two of its four are moderate, and a severity read off the package
 * would file those two under a number nobody assigned them.
 */
export function observedAdvisoryDetails(
  report: AuditReport,
): ReadonlyMap<string, ObservedAdvisory> {
  const found = new Map<string, ObservedAdvisory>();
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    const fix = fixKind(entry.fixAvailable);
    const updatePackage = fixPackage(report, name);
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const advisory = via as { source?: unknown; url?: unknown; severity?: unknown };
      const identity = advisoryIdentity(advisory);
      if (identity === null) continue;
      found.set(advisoryKey(name, identity), {
        severity: String(advisory.severity ?? ""),
        fix,
        updatePackage,
      });
    }
  }
  return found;
}


/**
 * Compares an `npm audit --json` report against {@link ACCEPTED_HIGH_ADVISORIES}.
 *
 * Reports staleness as well as surprises, for the reason every exemption list
 * in this repo does: a list nobody prunes stops describing the tree, and the
 * day it stops describing the tree is the day an entry on it starts covering
 * an advisory somebody would have wanted to see.
 */
export function evaluateAudit(
  report: AuditReport,
  accepted: readonly AcceptedAdvisory[] = ACCEPTED_HIGH_ADVISORIES,
): AuditVerdict {
  const acceptedKeys = new Set(
    accepted.flatMap((entry) => entry.advisories.map((id) => advisoryKey(entry.package, id))),
  );
  const observed = new Set(observedAdvisories(report));
  // Severity-blind on purpose: see "The fixability question is not a
  // high/critical question" above. `observed` stays high/critical because it
  // is what the baseline is a list OF.
  const everything = observedAdvisoryDetails(report);
  const withFix = (kind: FixKind): FixableAdvisory[] =>
    [...everything]
      .filter(([, detail]) => detail.fix === kind)
      .map(([key, detail]) => ({
        key,
        severity: detail.severity,
        updatePackage: detail.updatePackage,
      }))
      .sort(bySeverityThenKey);
  return {
    unexpected: [...observed].filter((key) => !acceptedKeys.has(key)).sort(),
    stillPresent: [...acceptedKeys].filter((key) => observed.has(key)).sort(),
    stale: [...acceptedKeys].filter((key) => !observed.has(key)).sort(),
    fixableInRange: withFix("in-range"),
    majorOnly: withFix("major"),
  };
}

/**
 * Most severe first, then by key so the order is total.
 *
 * Without the tiebreak two advisories of the same severity would print in
 * whatever order `Object.entries` walked the report, which is lockfile order —
 * and a findings list that reshuffles between runs is one nobody can diff.
 */
function bySeverityThenKey(a: FixableAdvisory, b: FixableAdvisory): number {
  return severityRank(a.severity) - severityRank(b.severity) || a.key.localeCompare(b.key);
}

/**
 * How severe, as a sortable number — lower is worse.
 *
 * A severity npm has not used yet sorts to the bottom rather than throwing:
 * the same choice {@link fixKind} makes about an unknown fix shape, for the
 * same reason. A field npm changes must not decide anything here, and least of
 * all whether this gate can produce a report at all.
 */
function severityRank(severity: string): number {
  const at = SEVERITY_ORDER.indexOf(severity);
  return at < 0 ? SEVERITY_ORDER.length : at;
}

/**
 * The sentence every failure of this gate ends with.
 *
 * This is the one `verify` leg whose verdict can change while the repository
 * does not. The other eight read the tree: the same commit gives the same
 * answer next year. This one asks the npm registry what the world knows about
 * these packages TODAY, so an advisory published overnight, or a fix published
 * overnight, turns a green tree red with no commit in between.
 *
 * That is the point of it and it is also a failure shape contributors have not
 * met before: the run that fails is not the run that caused it, and the first
 * reading of a red gate on your own PR is that your diff did it. Every other
 * red in this repo means exactly that. One sentence is the whole difference
 * between "what did I break?" and "something was published; here is the fix".
 *
 * Printed on every failing path rather than only on `unexpected`, because all
 * three can arrive this way: an advisory published (unexpected), a fix
 * published (fixableInRange), an advisory withdrawn (stale).
 *
 * "The one check here" is a claim about the other legs, and it is measured
 * rather than remembered: `verify-gate-script.test.ts` scans every script the
 * gate runs for a read outside the tree and fails if a second one appears. A
 * tenth leg that shelled out to a registry would otherwise make this sentence
 * false silently, in the one message written to be trusted.
 *
 * "The other eight" is the same kind of claim one level down, and it said
 * SEVEN for a day after `lint:ships-to-client` joined. `gate-legs-restated.test.ts`
 * counts the legs out of the script chain and reads this comment.
 */
export const PUBLISHED_ELSEWHERE_NOTE =
  "This gate reads the npm registry, so it is the one check here whose answer can change while the repository does not — a finding above may have been published since the last green run rather than caused by this branch. The fix is the same either way, and it belongs on this branch: the tree is only green when it is green today.";

/** `1 advisory` / `18 advisories` — the report is read by people, not matched. */
/**
 * A count and a noun that agrees with it.
 *
 * The rule itself is `lib/plural.ts` — the same one the app's six locales use,
 * because "exactly one takes the singular" is not a different fact in a CI
 * message than it is in the UI. This wrapper is only the shape: these messages
 * put the number in front of the word, and the app's keys often do not.
 */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${plural(count, one, many)}`;
}

/**
 * What a PASSING run is allowed to say about the advisories it let through.
 *
 * Upgrades, never advisories. The first version listed every major-only
 * finding by `package#GHSA` and severity, which was four names when the fix
 * rule read high/critical and became EIGHT the day it widened to every
 * severity — a green line long enough to wrap, half of it a list of moderates
 * the baseline deliberately does not triage. Noise on the green path is how
 * the previous version of this gate stopped being read, and nothing decided
 * how much a passing run was allowed to say.
 *
 * Grouping by {@link FixableAdvisory.updatePackage} answers both halves at
 * once. It bounds the line by the number of UPGRADES rather than the number of
 * advisories — eight advisories across five vulnerable packages are two
 * upgrades, `expo` and `expo-router` — and it puts the green path in the same
 * vocabulary as the red one, which names roots since the day it started
 * reading npm's own fix target.
 *
 * The count and the worst severity ride each group because they are what a
 * reader does something with ("is any of this high?", "how much does that one
 * upgrade buy?"). The advisory ids do not: they are what a FAILING run prints,
 * and a reader who wants them on a green run wants `npm audit`.
 */
function majorOnlySummary(majorOnly: readonly FixableAdvisory[]): string {
  if (majorOnly.length === 0) return "";
  const groups = [...groupByPackage(majorOnly, (found) => found.updatePackage)]
    // Most severe group first, then the one that buys the most, then by name:
    // an OK line that reshuffles between runs is one nobody can diff, same
    // reason `bySeverityThenKey` exists for the findings.
    // The worst severity is derived, not read off position 0: it happens to be
    // first because `majorOnly` arrives sorted, and a summary that depended on
    // that would be wrong the day the list's order is decided elsewhere.
    .map(([name, found]) => ({
      name,
      found,
      worst: found.reduce((a, b) => (severityRank(b.severity) < severityRank(a.severity) ? b : a))
        .severity,
    }))
    .sort(
      (a, b) =>
        severityRank(a.worst) - severityRank(b.worst) ||
        b.found.length - a.found.length ||
        a.name.localeCompare(b.name),
    )
    .map((group) => `${group.name} (${String(group.found.length)}, up to ${group.worst})`);
  return `; and npm offers no fix short of a semver-major for ${counted(majorOnly.length, "advisory", "advisories")}, cleared by ${counted(groups.length, "upgrade", "upgrades")}: ${groups.join(", ")}`;
}

/**
 * Which packages the run is still relying on an exemption for.
 *
 * `stillPresent` was a bare count — "4 accepted high/critical advisories" —
 * while the major-only half beside it had been given a vocabulary the day
 * before. The half nobody argued about got the redesign, and this is the half
 * that records a HUMAN decision: every key here is an advisory somebody read,
 * wrote a `why` for, and accepted. "Four of them" says nothing a reader can
 * act on; `image-size (2), postcss (2)` names what to look up in SECURITY.md.
 *
 * The VULNERABLE package, not the update target, and the difference is the
 * point: `majorOnlySummary` groups by what `npm update` would move, because
 * its reader is about to run a command, and this groups by what the baseline
 * is a list of, because its reader is about to re-read an argument. The same
 * advisory appears under `postcss` here and under `expo` there, correctly.
 *
 * Bounded by the baseline, which is the one list in this report a person
 * curates: `majorOnly`'s length is whatever npm reports today, and this is as
 * long as somebody has been willing to write `why` sentences for.
 */
function acceptedSummary(stillPresent: readonly string[]): string {
  if (stillPresent.length === 0) return "none accepted";
  const groups = [...groupByPackage(stillPresent, advisoryPackage)]
    // Widest first, then by name — the same total order the other summary
    // has, minus the severity it has no opinion about: every key here is
    // high or critical, because that is what the baseline is a list of.
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, keys]) => `${name} (${String(keys.length)})`);
  return `${String(stillPresent.length)} still accepted, in ${groups.join(", ")}`;
}

/**
 * `[package, members]`, for the two summaries that both group by one.
 *
 * Written twice would be the smaller problem; the real one is that the two
 * lines are the halves of one sentence a contributor reads on a green run, and
 * a grouping that drifted between them would print two different shapes for
 * the same idea. That is the drift the OK-line rewrite was about.
 */
function groupByPackage<T>(items: readonly T[], name: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const group = grouped.get(name(item));
    if (group === undefined) grouped.set(name(item), [item]);
    else group.push(item);
  }
  return grouped;
}

/** Human-readable report; the CLI prints this and nothing else. */
export function formatAuditVerdict(verdict: AuditVerdict, checkName: string): string {
  const lines: string[] = [];
  if (verdict.unexpected.length > 0) {
    lines.push(
      `${checkName}: ${counted(verdict.unexpected.length, "high/critical advisory", "high/critical advisories")} not in the baseline:`,
    );
    for (const key of verdict.unexpected) lines.push(`  NEW  ${key}`);
    lines.push(
      "Read each at https://github.com/advisories, triage it in SECURITY.md, then add its ID to that package's `advisories` with whether it reaches the client — or fix it.",
    );
  }
  if (verdict.fixableInRange.length > 0) {
    lines.push(
      `${checkName}: npm can fix ${counted(verdict.fixableInRange.length, "advisory", "advisories")} without a major version change:`,
    );
    for (const found of verdict.fixableInRange) {
      // The redirect is printed only when there IS one. A finding whose fix
      // lives in its own package needs no explanation, and "(fix in undici)"
      // on every line is how the redirect stops being read on the one line
      // where it is the whole answer.
      const via =
        found.updatePackage === advisoryPackage(found.key)
          ? ""
          : `  (fix in ${found.updatePackage})`;
      lines.push(`  FIXABLE  ${found.severity.padEnd(8)}  ${found.key}${via}`);
    }
    lines.push(
      `Run \`npm update ${fixCommandPackages(verdict.fixableInRange).join(" ")}\` and commit the lockfile. An advisory a lockfile bump clears is not a triage decision, at any severity — accepting one is how seven of these sat on the baseline being read as read, and how three moderate/low roots went a month without anybody asking.`,
    );
  }
  if (verdict.stale.length > 0) {
    lines.push(
      `${checkName}: ${counted(verdict.stale.length, "baseline entry", "baseline entries")} no longer reported — remove ${plural(verdict.stale.length, "it", "them")}: ${verdict.stale.join(", ")}`,
    );
  }
  if (isClean(verdict)) {
    lines.push(
      // Three clauses, one per question a green run answers: is anything new,
      // what am I still accepting, and what would clearing the rest cost.
      // Semicolons between them because two of the three END in a
      // comma-separated list of packages, and a comma joining the clauses put
      // the list's last entry and the next clause in the same punctuation.
      `${checkName}: OK — no new high/critical advisories; ${acceptedSummary(verdict.stillPresent)}${majorOnlySummary(verdict.majorOnly)}.`,
    );
  } else {
    lines.push("", PUBLISHED_ELSEWHERE_NOTE);
  }
  return lines.join("\n");
}

/**
 * The package half of a `package#advisory` key.
 *
 * `lastIndexOf`, not `split`: an advisory id has no `#` today and the key is
 * built from whatever npm reports, so the package name is what is definitely
 * on the left of the LAST separator.
 */
export function advisoryPackage(key: string): string {
  const at = key.lastIndexOf("#");
  return at < 0 ? key : key.slice(0, at);
}

/**
 * The packages one `npm update` should name, in the order they were reported.
 *
 * Deduplicated, because three advisories on one root are one upgrade: a
 * command reading `npm update brace-expansion brace-expansion brace-expansion`
 * is one a reader stops trusting. The dedupe now collapses ACROSS roots as
 * well — twelve advisories whose fix is `expo@57` are one `npm update expo`,
 * where naming the vulnerable packages produced twelve names for one upgrade.
 *
 * Reads {@link FixableAdvisory.updatePackage}, so npm's own report decides. The
 * first version named the vulnerable package instead and printed
 * `npm update esbuild` for a fix that lived in `tsx`; a contributor following
 * the printed instruction literally saw it no-op with no way to tell why. The
 * command is still a starting point rather than a guarantee — the gate re-runs
 * and says so if the advisory survives it — but it now names a package that
 * can actually move.
 */
export function fixCommandPackages(
  fixable: readonly FixableAdvisory[],
): readonly string[] {
  return [...new Set(fixable.map((found) => found.updatePackage))];
}

/**
 * Whether the gate passes.
 *
 * Three failure lists and one informational one, in one predicate, because
 * `check-audit-baseline` and the suites both need the answer and the day they
 * disagree is the day a finding is printed and exits 0. `majorOnly` is
 * deliberately absent: it is npm restating what each `why` sentence claims,
 * and a gate that failed on it would be demanding an `expo` major upgrade on
 * every PR.
 *
 * `fixableInRange` reads every severity, so this is the predicate that turns a
 * moderate npm can already fix into a red run. That is affordable only because
 * it stays true of the accepted list that a low or moderate needs no entry:
 * the demand is a lockfile bump, never a paragraph.
 */
export function isClean(verdict: AuditVerdict): boolean {
  return (
    verdict.unexpected.length === 0 &&
    verdict.fixableInRange.length === 0 &&
    verdict.stale.length === 0
  );
}
