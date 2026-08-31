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
 * Only ever "read, understood, and not exploitable HERE" — never "old". Each
 * entry says whether the package reaches the production web bundle, because
 * that is the question the severity number cannot answer: `nanoid` is high,
 * ships to every user, and its vulnerable path takes a negative `size`
 * argument that no call site in this app passes.
 */

/** One triaged advisory root. Transitive dependents are not listed. */
export interface AcceptedAdvisory {
  /** The package `npm audit` names as the advisory's root. */
  readonly package: string;
  /**
   * Whether the package's code reaches the production web bundle.
   *
   * Not the same as "vulnerable": a package can ship and still be safe when
   * the vulnerable entry point is unreachable from this app's call sites.
   */
  readonly shipsToClient: boolean;
  /** Why this one is accepted rather than fixed. One sentence. */
  readonly why: string;
}

/**
 * Triaged 2026-08-31 against `npm audit` on the committed lockfile.
 *
 * Six roots; the other seven high entries `npm audit` reports are Expo/metro
 * packages that merely depend on these.
 */
export const ACCEPTED_HIGH_ADVISORIES: readonly AcceptedAdvisory[] = [
  {
    package: "nanoid",
    shipsToClient: true,
    why: "ships via @react-navigation/routers for route keys; the DoS needs a negative size argument and every bundled call site is nanoid() with none",
  },
  {
    package: "brace-expansion",
    shipsToClient: false,
    why: "glob/minimatch under the build toolchain; never evaluated at runtime",
  },
  {
    package: "image-size",
    shipsToClient: false,
    why: "metro's asset pipeline, build-time only (the string in the bundle is the icon name image-size-select-actual, not this package)",
  },
  {
    package: "js-yaml",
    shipsToClient: false,
    why: "@expo/xcpretty and babel-jest; fix is react-native@0.86, a breaking major",
  },
  {
    package: "postcss",
    shipsToClient: false,
    why: "@expo/metro-config's build-time CSS transform; fix is expo@56, a breaking major",
  },
  {
    package: "tar",
    shipsToClient: false,
    why: "npm/expo install-time archive handling; never on the runtime path",
  },
];

/** Shape of the slice of `npm audit --json` this reads. */
export interface AuditReport {
  readonly vulnerabilities?: Readonly<
    Record<string, { readonly severity?: string; readonly via?: readonly unknown[] }>
  >;
}

export interface AuditVerdict {
  /** High/critical roots with no entry in the baseline — the failure. */
  readonly unexpected: readonly string[];
  /** Baseline entries that still appear, i.e. the exemption is still earning it. */
  readonly stillPresent: readonly string[];
  /** Baseline entries the audit no longer reports — stale, remove them. */
  readonly stale: readonly string[];
}

/**
 * An advisory ROOT is one whose `via` names an advisory object rather than
 * only other package names.
 *
 * npm reports a package as vulnerable both when it carries the flaw and when
 * it merely depends on something that does; the second kind is noise for a
 * baseline, because it changes whenever the dependency tree is reshaped and
 * says nothing new about exposure. Seven of the thirteen high entries in this
 * tree today are that kind.
 */
export function isAdvisoryRoot(via: readonly unknown[] | undefined): boolean {
  return (via ?? []).some((entry) => typeof entry === "object" && entry !== null);
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
  const acceptedNames = new Set(accepted.map((entry) => entry.package));
  const roots = new Set<string>();
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    const severity = entry.severity ?? "";
    if (severity !== "high" && severity !== "critical") continue;
    if (!isAdvisoryRoot(entry.via)) continue;
    roots.add(name);
  }
  return {
    unexpected: [...roots].filter((name) => !acceptedNames.has(name)).sort(),
    stillPresent: [...acceptedNames].filter((name) => roots.has(name)).sort(),
    stale: [...acceptedNames].filter((name) => !roots.has(name)).sort(),
  };
}

/** Human-readable report; the CLI prints this and nothing else. */
export function formatAuditVerdict(verdict: AuditVerdict, checkName: string): string {
  const lines: string[] = [];
  if (verdict.unexpected.length > 0) {
    lines.push(
      `${checkName}: ${String(verdict.unexpected.length)} high/critical advisory root(s) not in the baseline:`,
    );
    for (const name of verdict.unexpected) lines.push(`  NEW  ${name}`);
    lines.push(
      "Triage each in SECURITY.md, then add it to ACCEPTED_HIGH_ADVISORIES with whether it reaches the client — or fix it.",
    );
  }
  if (verdict.stale.length > 0) {
    lines.push(
      `${checkName}: ${String(verdict.stale.length)} baseline entr(ies) no longer reported — remove them: ${verdict.stale.join(", ")}`,
    );
  }
  if (verdict.unexpected.length === 0 && verdict.stale.length === 0) {
    lines.push(
      `${checkName}: OK — ${String(verdict.stillPresent.length)} accepted high/critical advisory root(s), no new ones.`,
    );
  }
  return lines.join("\n");
}
