import { stripComments } from "@/lib/env-inlining";

/**
 * Scanner behind `scripts/check-problem-phrasing-imports.ts` (`npm run
 * lint:problem-phrasing`): flags any module that pulls a raw
 * `lib/scanned-floor` PHRASING PART out of the module without also pulling a
 * function that joins the parts.
 *
 * `scanned-floor.ts` renders one problem as one sentence — a subject and a
 * clause, joined in exactly one place. Both halves are exported on purpose, so
 * a test can assert what a refusal says without re-typing a fragment of it,
 * and that is also the hole: any module can import `scannedFloorProblemDetail`
 * and `scannedFloorProblemSubject` and build its own `"<subject> <clause>"`
 * string. The result reads like the module's own sentence and drifts from it
 * the first time either half is reworded — the exact failure the single-joining
 * refactor was meant to end, reintroduced from outside the file.
 *
 * The rule the module already keeps by convention, stated where it applies: a
 * file that reads a part must also import something that joins parts. That is
 * not proof the file uses the joiner for that particular sentence, and it is
 * not meant to be — it is the cheap structural claim, the same shape
 * `check-analytics-imports` makes about the taxonomy. A file with both in
 * scope is a file where re-joining by hand is a visible choice rather than the
 * only option available.
 *
 * `lib/scanned-floor.ts` needs no exemption: it declares these functions and
 * imports none of them.
 *
 * Pure module: no filesystem access — the CLI walks the directories and hands
 * sources over, so the matcher is unit-testable under node --test.
 */

/** The phrasing PARTS: each returns half a sentence, for a caller to join. */
export const PROBLEM_PART_ACCESSORS = [
  "scannedFloorProblemDetail",
  "scannedFloorProblemSubject",
] as const;

/**
 * The JOINERS: each returns a whole sentence with the parts already assembled.
 * `formatScannedFloorFailure` counts because a failure carries a problem ref
 * and the message table renders it through the same joining path.
 */
export const PROBLEM_SENTENCE_JOINERS = [
  "describeScannedFloorProblem",
  "describeScannedFloorProblemRef",
  "formatScannedFloorProblem",
  "formatScannedFloorFailure",
] as const;

/**
 * Named imports from the module, e.g. `import { a, b } from "../lib/scanned-floor"`.
 * The specifier is matched by SUFFIX so relative depth does not matter and a
 * longer neighbour (`scanned-floor-extras`) does not match.
 */
const NAMED_IMPORT_PATTERN =
  /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*\/scanned-floor(?:\.[jt]sx?)?["']/g;

/**
 * Namespace imports of the same module. Without this the guard would state a
 * rule that one extra line of syntax walks around: `import * as floor from
 * "../lib/scanned-floor"` then `floor.scannedFloorProblemDetail(code)` reads a
 * part while importing no name the pattern above can see.
 */
const NAMESPACE_IMPORT_PATTERN =
  /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*["'][^"']*\/scanned-floor(?:\.[jt]sx?)?["']/g;

export type ProblemPhrasingMatch = {
  file: string;
  line: number;
  /** The part accessor the file reads without a joiner in scope. */
  accessor: string;
  /** The offending source line, trimmed, for the report. */
  snippet: string;
};

/** Bare identifiers from one `{ ... }` clause, minus `as` aliases and `type`. */
function namedBindings(clause: string): string[] {
  return clause
    .split(",")
    .map((binding) => binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter((name) => name.length > 0);
}

/**
 * Scan one source string for a phrasing part imported with no joiner beside
 * it. Comments are stripped first, so a doc block naming an accessor — this
 * module's own does, several times — is prose rather than a finding.
 */
export function findUnjoinedProblemPhrasingImports(
  file: string,
  source: string,
): ProblemPhrasingMatch[] {
  const stripped = stripComments(source);

  const imported = new Set<string>();
  const namespaces: string[] = [];
  for (const m of stripped.matchAll(new RegExp(NAMED_IMPORT_PATTERN.source, "g"))) {
    for (const name of namedBindings(m[1])) imported.add(name);
  }
  for (const m of stripped.matchAll(
    new RegExp(NAMESPACE_IMPORT_PATTERN.source, "g"),
  )) {
    namespaces.push(m[1]);
  }
  if (imported.size === 0 && namespaces.length === 0) return [];

  // A namespace import puts the WHOLE module in scope under one name, so a
  // joiner is reachable there by construction; what the file actually reaches
  // for is the question, and `ns.member` reads are how it says so.
  const reads = (name: string): boolean =>
    imported.has(name) ||
    namespaces.some((ns) =>
      new RegExp(`\\b${ns}\\.${name}\\b`).test(stripped),
    );

  if (PROBLEM_SENTENCE_JOINERS.some(reads)) return [];

  const matches: ProblemPhrasingMatch[] = [];
  for (const accessor of PROBLEM_PART_ACCESSORS) {
    if (!reads(accessor)) continue;
    const index = stripped.indexOf(accessor);
    const before = stripped.slice(0, index);
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = source.indexOf("\n", index);
    matches.push({
      file,
      line: before.split("\n").length,
      accessor,
      snippet: source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
    });
  }
  return matches;
}

/**
 * Human-readable failure report; empty string when there is nothing to report
 * so callers can short-circuit.
 */
export function formatProblemPhrasingReport(
  matches: ProblemPhrasingMatch[],
): string {
  if (matches.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `Found ${matches.length} read(s) of a lib/scanned-floor phrasing part with no sentence-joining function in scope.`,
  );
  lines.push(
    `A part is half a sentence: import one of ${PROBLEM_SENTENCE_JOINERS.join(" / ")} and let the module join it, or the string this file builds becomes a second phrasing that drifts the first time either half is reworded.`,
  );
  for (const m of matches) {
    lines.push(`  ${m.file}:${m.line}  ${m.accessor} — ${m.snippet}`);
  }
  return lines.join("\n");
}
