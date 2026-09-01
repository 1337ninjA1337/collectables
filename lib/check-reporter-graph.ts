/**
 * The modules node loads with its OWN loader, and the two rules they live by.
 *
 * `npm test` passes `--test-reporter=./scripts/test-failure-reporter.ts`, and
 * node imports a custom reporter through the DEFAULT loader — `tsx`'s hooks
 * are never consulted for it. So that file, and everything it transitively
 * imports, is read by node's native TypeScript stripping rather than by the
 * transform the other 800 modules in this repository get. Two things follow,
 * and neither is visible from inside the files they constrain:
 *
 *  1. **Every repo-local import must name its `.ts` extension.** Native
 *     stripping infers none. Tidy one away and the run dies at link time with
 *     `ERR_MODULE_NOT_FOUND`, before a single suite has started.
 *  2. **Every file in the graph must be erasable.** `enum`, `namespace`, a
 *     constructor parameter property — anything strip-only mode cannot delete
 *     without emitting code — is `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load,
 *     again before any suite runs.
 *
 * WHY A GUARD AND NOT A TEST. Both failures kill the whole run, so the suite
 * that would have caught them never executes: `__tests__/test-failure-report.ts`
 * spawns the real command, which is the strongest check available and is also
 * unreachable in exactly the case it is for. `lint:all` runs BEFORE `npm test`
 * in `lint:ci` and in ci.yml, so this guard gets to say what happened while
 * there is still a run to say it in.
 *
 * The graph is WALKED rather than listed. `lib/thrown-value.ts` is in it today
 * and has two other callers that know nothing about any of this; the set of
 * files under these rules changes whenever an import here does, and a hardcoded
 * list would go stale silently in the direction of checking too little.
 *
 * Pure: `node:path`'s posix half and nothing else. `scripts/check-reporter-graph.ts`
 * does the reading and asks node itself about erasability.
 */

import * as path from "node:path";

/** The file node's test runner is pointed at, and the root of the graph. */
export const REPORTER_GRAPH_ENTRY = "scripts/test-failure-reporter.ts";

/** One sentence a contributor who has just tripped this needs to read. */
export const NATIVE_LOADER_REASON =
  "node imports a custom test reporter through its DEFAULT loader, so this file and everything it imports are read by native type stripping — which resolves no extensions and erases no enum, namespace or parameter property";

/** A repo-local import that node's loader cannot resolve. */
export interface ExtensionlessImport {
  /** Repo-relative file the import is written in. */
  readonly file: string;
  /** The specifier as written. */
  readonly specifier: string;
}

export interface ReporterGraph {
  /** Repo-relative paths reached from the entry, entry first, de-duplicated. */
  readonly files: readonly string[];
  /** Files named by a followable import that could not be read. */
  readonly unreadable: readonly string[];
  /** Repo-local imports written without the extension on disk. */
  readonly extensionless: readonly ExtensionlessImport[];
}

/** Returns the file's text, or `null` when it cannot be read. */
export type GraphReader = (repoRelative: string) => string | null;

/**
 * Every repo-local specifier in `source`, as written.
 *
 * Static `from "…"` and dynamic `import("…")` both, because node's loader
 * follows both and a graph that missed the dynamic half would check less than
 * it claims. Bare specifiers (`node:path`, a package) are not repo-local and
 * are node's to resolve however it likes, so only `.`-relative ones are
 * returned — the same set the rules above apply to.
 */
export function repoLocalSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\bfrom\s*"(\.[^"]*)"/g)) found.push(match[1]);
  for (const match of source.matchAll(/\bimport\s*\(\s*"(\.[^"]*)"\s*\)/g)) found.push(match[1]);
  return found;
}

/**
 * Where a relative specifier written in `file` points, repo-relative.
 *
 * `path.posix` rather than `path`: the values here are repo-relative paths
 * written with forward slashes in import statements, not host paths, and
 * joining them through the platform namespace would produce backslashes on
 * Windows that no subsequent comparison matches.
 */
export function resolveSpecifier(file: string, specifier: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
}

/**
 * Follows the graph from `entry`, collecting what it reached and what is wrong
 * with it.
 *
 * An extensionless specifier is recorded and NOT followed: node cannot resolve
 * it either, so guessing where it meant to point would report findings about a
 * file the failing run never opens.
 */
export function walkReporterGraph(
  read: GraphReader,
  entry: string = REPORTER_GRAPH_ENTRY,
): ReporterGraph {
  const files: string[] = [];
  const unreadable: string[] = [];
  const extensionless: ExtensionlessImport[] = [];
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    if (source === null) {
      unreadable.push(file);
      continue;
    }
    files.push(file);
    for (const specifier of repoLocalSpecifiers(source)) {
      if (!specifier.endsWith(".ts")) {
        extensionless.push({ file, specifier });
        continue;
      }
      queue.push(resolveSpecifier(file, specifier));
    }
  }

  return { files, unreadable, extensionless };
}

/**
 * One line per finding, or none.
 *
 * Findings rather than a thrown error so the caller reports ALL of them: a
 * graph with three tidied imports should cost one run, not three. Each line
 * says what and where and stops there — {@link NATIVE_LOADER_REASON} belongs
 * once, in the sentence the caller wraps the list in, not on every row.
 */
export function formatGraphIssues(graph: ReporterGraph): string[] {
  return [
    ...graph.unreadable.map(
      (file) => `${file} is imported by the reporter graph and could not be read`,
    ),
    ...graph.extensionless.map(
      ({ file, specifier }) =>
        `${file} imports "${specifier}", which names no extension on disk`,
    ),
  ];
}
