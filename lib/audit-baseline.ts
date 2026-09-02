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
 */

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
    why: "JXL/HEIF and ICNS parser DoS in metro's asset pipeline, build-time only (the string in the bundle is the icon name image-size-select-actual, not this package); fix is expo@57, a breaking major",
  },
  {
    package: "postcss",
    advisories: ["GHSA-6g55-p6wh-862q", "GHSA-r28c-9q8g-f849"],
    shipsToClient: false,
    why: "arbitrary file read and source-map path traversal in @expo/metro-config's build-time CSS transform; fix is expo@57, a breaking major",
  },
];

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
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const advisory = via as { source?: unknown; url?: unknown; severity?: unknown };
      const identity = advisoryIdentity(advisory);
      if (identity === null) continue;
      found.set(advisoryKey(name, identity), {
        severity: String(advisory.severity ?? ""),
        fix,
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
      .map(([key, detail]) => ({ key, severity: detail.severity }))
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
  const rank = (severity: string): number => {
    const at = SEVERITY_ORDER.indexOf(severity);
    return at < 0 ? SEVERITY_ORDER.length : at;
  };
  return rank(a.severity) - rank(b.severity) || a.key.localeCompare(b.key);
}

/** `1 advisory` / `18 advisories` — the report is read by people, not matched. */
function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Human-readable report; the CLI prints this and nothing else. */
export function formatAuditVerdict(verdict: AuditVerdict, checkName: string): string {
  const lines: string[] = [];
  if (verdict.unexpected.length > 0) {
    lines.push(
      `${checkName}: ${plural(verdict.unexpected.length, "high/critical advisory", "high/critical advisories")} not in the baseline:`,
    );
    for (const key of verdict.unexpected) lines.push(`  NEW  ${key}`);
    lines.push(
      "Read each at https://github.com/advisories, triage it in SECURITY.md, then add its ID to that package's `advisories` with whether it reaches the client — or fix it.",
    );
  }
  if (verdict.fixableInRange.length > 0) {
    lines.push(
      `${checkName}: npm can fix ${plural(verdict.fixableInRange.length, "advisory", "advisories")} without a major version change:`,
    );
    for (const found of verdict.fixableInRange) {
      lines.push(`  FIXABLE  ${found.severity.padEnd(8)}  ${found.key}`);
    }
    lines.push(
      `Run \`npm update ${fixCommandPackages(verdict.fixableInRange).join(" ")}\` and commit the lockfile. An advisory a lockfile bump clears is not a triage decision, at any severity — accepting one is how seven of these sat on the baseline being read as read, and how three moderate/low roots went a month without anybody asking.`,
    );
  }
  if (verdict.stale.length > 0) {
    lines.push(
      `${checkName}: ${plural(verdict.stale.length, "baseline entry", "baseline entries")} no longer reported — remove ${verdict.stale.length === 1 ? "it" : "them"}: ${verdict.stale.join(", ")}`,
    );
  }
  if (isClean(verdict)) {
    lines.push(
      `${checkName}: OK — ${plural(verdict.stillPresent.length, "accepted high/critical advisory", "accepted high/critical advisories")}, no new ones${
        verdict.majorOnly.length === 0
          ? ""
          : `, and npm offers no fix short of a semver-major for ${plural(verdict.majorOnly.length, "advisory", "advisories")} (${verdict.majorOnly.map((found) => `${found.key} [${found.severity}]`).join(", ")})`
      }.`,
    );
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
 * is one a reader stops trusting.
 *
 * npm's own fix may be a DIFFERENT package — `esbuild`'s in-range fix was
 * reached by moving `tsx`, which declares `esbuild: ~0.27.0` and had a newer
 * release inside the root's own `^4.21.0`. So this names the vulnerable
 * package and the command is a starting point rather than a guarantee; the
 * gate re-runs and says so if the advisory is still there.
 */
export function fixCommandPackages(
  fixable: readonly FixableAdvisory[],
): readonly string[] {
  return [...new Set(fixable.map((found) => advisoryPackage(found.key)))];
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
