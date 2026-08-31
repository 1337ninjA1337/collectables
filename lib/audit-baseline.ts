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
 * the advisory IDS it has read and says whether the package reaches the
 * production web bundle, because that is the question the severity number
 * cannot answer: `nanoid` is high, ships to every user, and both of its
 * advisories need an argument shape no call site in this app passes.
 *
 * Keying on ids rather than names was the second version. The first keyed on
 * the package, and `nanoid` already had TWO high advisories the day it was
 * written — so the list accepted one nobody had read, which is the failure a
 * baseline exists to prevent, reproduced inside the baseline.
 */

/** One triaged advisory root. Transitive dependents are not listed. */
export interface AcceptedAdvisory {
  /** The package `npm audit` names as the advisory's root. */
  readonly package: string;
  /**
   * The npm advisory ids (`via[].source`) this entry has actually read.
   *
   * The ids are the point. The first version of this list keyed on the package
   * NAME, and `nanoid` was already carrying TWO high advisories when it was
   * written — 1138811 (negative `size`) and 1139427 (custom generators). The
   * `why` below reasoned about the first one and silently accepted the second,
   * which is the exact failure a baseline exists to prevent, reproduced inside
   * the baseline. A name covers every future CVE in that package; an id covers
   * the one somebody read.
   */
  readonly advisories: readonly number[];
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
 * Triaged 2026-08-31 against `npm audit` on the committed lockfile.
 *
 * Six root packages carrying 18 high advisories between them; the other seven
 * high ENTRIES `npm audit` reports are Expo/metro packages that merely depend
 * on these, and carry no advisory of their own.
 */
export const ACCEPTED_HIGH_ADVISORIES: readonly AcceptedAdvisory[] = [
  {
    package: "nanoid",
    advisories: [1138811, 1139427],
    shipsToClient: true,
    why: "ships via @react-navigation/routers for route keys; 1138811 needs a negative size argument and 1139427 needs a custom generator, and every bundled call site is nanoid() with neither",
  },
  {
    package: "brace-expansion",
    advisories: [1123896, 1123897, 1123898, 1130588, 1130589, 1130591, 1130734, 1130736, 1130737],
    shipsToClient: false,
    why: "three DoS advisories, each reported once per dependency path, in glob/minimatch under the build toolchain; never evaluated at runtime",
  },
  {
    package: "image-size",
    advisories: [1138808, 1138809],
    shipsToClient: false,
    why: "ICNS and JXL/HEIF parser DoS in metro's asset pipeline, build-time only (the string in the bundle is the icon name image-size-select-actual, not this package)",
  },
  {
    package: "js-yaml",
    advisories: [1138114, 1138115],
    shipsToClient: false,
    why: "!!omap quadratic CPU in @expo/xcpretty and babel-jest; fix is react-native@0.86, a breaking major",
  },
  {
    package: "postcss",
    advisories: [1124252, 1139510],
    shipsToClient: false,
    why: "arbitrary file read and source-map path traversal in @expo/metro-config's build-time CSS transform; fix is expo@56, a breaking major",
  },
  {
    package: "tar",
    advisories: [1145647],
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
 * The high/critical advisory ids `npm audit` attributes to each root package.
 *
 * A `via` entry is an advisory object on a root and a bare package name on
 * something that merely depends on one; the second kind changes whenever the
 * dependency tree is reshaped and says nothing new about exposure, so only the
 * first is collected. Severity is read from the ADVISORY, not the package: npm
 * reports a package at the highest severity among its advisories, so `postcss`
 * is "high" while two of its four advisories are moderate — and a baseline
 * built from the package's severity would silently accept those two.
 */
export function observedAdvisories(report: AuditReport): readonly string[] {
  const found = new Set<string>();
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const advisory = via as { source?: unknown; severity?: unknown };
      const severity = String(advisory.severity ?? "");
      if (severity !== "high" && severity !== "critical") continue;
      if (advisory.source === undefined || advisory.source === null) continue;
      found.add(advisoryKey(name, advisory.source as number));
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
