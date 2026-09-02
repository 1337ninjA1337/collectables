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
 * in versions below 3.3.12 — and the entry was removed rather than extended:
 * an `overrides` pin to `^3.3.18` in `package.json` clears all three, in the
 * same major, with no other package moving. An acceptance whose argument has
 * to be rewritten each time the package is re-audited is a fix deferred, and
 * this one shipped to every user.
 *
 * The KEY took three versions, and each wrong one failed differently. The
 * package name accepted every future CVE in an accepted package. npm's
 * per-path `source` id made the list churn with the lockfile, which turns a
 * blocking gate into noise. The GHSA is the advisory's own name and neither.
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
 * Triaged 2026-08-31 against `npm audit` on the committed lockfile, re-triaged
 * 2026-09-02 when `nanoid` was fixed instead.
 *
 * Six root packages carrying 11 distinct advisories between them, none of
 * which reaches the client. `npm audit` reports more high ENTRIES and more `via`
 * objects than there are advisories here: the extra entries are Expo/metro
 * packages that merely depend on these and carry no advisory of their own, and
 * the extra objects are one advisory seen down several dependency paths.
 */
export const ACCEPTED_HIGH_ADVISORIES: readonly AcceptedAdvisory[] = [
  {
    package: "brace-expansion",
    advisories: ["GHSA-3jxr-9vmj-r5cp", "GHSA-mh99-v99m-4gvg", "GHSA-rgw5-rvv9-x895"],
    shipsToClient: false,
    why: "three expansion DoS advisories in glob/minimatch under the build toolchain; never evaluated at runtime",
  },
  {
    package: "browserslist",
    advisories: ["GHSA-73wf-gq98-2v4g", "GHSA-c83g-rgw3-j3cx"],
    shipsToClient: false,
    why: "target resolution for @expo/metro-config and babel's core-js-compat, absent from both shipped chunks; the OOM needs an attacker feeding distinct queries to a build, and the prototype write needs an untrusted browserslist-stats.json in this repo — npm reports fixAvailable but `npm audit fix` moves 134 packages including 12 majors (expo-router 56→57)",
  },
  {
    package: "image-size",
    advisories: ["GHSA-5p2g-fcmc-qvqq", "GHSA-w3rx-r6r6-pgpr"],
    shipsToClient: false,
    why: "JXL/HEIF and ICNS parser DoS in metro's asset pipeline, build-time only (the string in the bundle is the icon name image-size-select-actual, not this package)",
  },
  {
    package: "js-yaml",
    advisories: ["GHSA-5p4m-2wfm-xmqj"],
    shipsToClient: false,
    why: "!!omap quadratic CPU in @expo/xcpretty and babel-jest; fix is react-native@0.86, a breaking major",
  },
  {
    package: "postcss",
    advisories: ["GHSA-6g55-p6wh-862q", "GHSA-r28c-9q8g-f849"],
    shipsToClient: false,
    why: "arbitrary file read and source-map path traversal in @expo/metro-config's build-time CSS transform; fix is expo@56, a breaking major",
  },
  {
    package: "tar",
    advisories: ["GHSA-r292-9mhp-454m"],
    shipsToClient: false,
    why: "uncontrolled recursion in npm/expo install-time archive handling; never on the runtime path",
  },
];

/** Shape of the slice of `npm audit --json` this reads. */
export interface AuditReport {
  readonly vulnerabilities?: Readonly<
    Record<string, { readonly severity?: string; readonly via?: readonly unknown[] }>
  >;
}

export interface AuditVerdict {
  /** High/critical advisories with no entry in the baseline — the failure. */
  readonly unexpected: readonly string[];
  /** Baseline advisories that still appear, i.e. the exemption still earns it. */
  readonly stillPresent: readonly string[];
  /** Baseline advisories the audit no longer reports — stale, remove them. */
  readonly stale: readonly string[];
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
 * The high/critical advisories `npm audit` attributes to each root package.
 *
 * A `via` entry is an advisory object on a root and a bare package name on
 * something that merely depends on one; the second kind changes whenever the
 * dependency tree is reshaped and says nothing new about exposure, so only the
 * first is collected.
 *
 * Severity is read from the ADVISORY, not the package: npm reports a package
 * at the highest severity among its advisories, so `postcss` is "high" while
 * two of its four are moderate — and a baseline built from the package's
 * severity would silently accept those two.
 *
 * The result is a SET, which is the fix for npm reporting one entry per
 * dependency path: `brace-expansion`'s three advisories arrive as nine `via`
 * objects carrying three GHSAs, and nine collapse to three here.
 */
export function observedAdvisories(report: AuditReport): readonly string[] {
  const found = new Set<string>();
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const advisory = via as { source?: unknown; url?: unknown; severity?: unknown };
      const severity = String(advisory.severity ?? "");
      if (severity !== "high" && severity !== "critical") continue;
      const identity = advisoryIdentity(advisory);
      if (identity === null) continue;
      found.add(advisoryKey(name, identity));
    }
  }
  return [...found];
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
  return {
    unexpected: [...observed].filter((key) => !acceptedKeys.has(key)).sort(),
    stillPresent: [...acceptedKeys].filter((key) => observed.has(key)).sort(),
    stale: [...acceptedKeys].filter((key) => !observed.has(key)).sort(),
  };
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
  if (verdict.stale.length > 0) {
    lines.push(
      `${checkName}: ${plural(verdict.stale.length, "baseline entry", "baseline entries")} no longer reported — remove ${verdict.stale.length === 1 ? "it" : "them"}: ${verdict.stale.join(", ")}`,
    );
  }
  if (verdict.unexpected.length === 0 && verdict.stale.length === 0) {
    lines.push(
      `${checkName}: OK — ${plural(verdict.stillPresent.length, "accepted high/critical advisory", "accepted high/critical advisories")}, no new ones.`,
    );
  }
  return lines.join("\n");
}
