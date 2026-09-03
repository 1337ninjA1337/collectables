/**
 * The four ways a file takes a module, read once for everybody who asks.
 *
 * ## Four scanners, four ideas of what an import looks like
 *
 * Every structural rule here that is about the module graph eventually writes
 * the same regex, and by the time there were four of them no two agreed:
 *
 *  - `check-analytics-imports.ts` matched `from`, `require(` and `import(`,
 *    and not the side-effect `import "…"` — a UI file that pulled the taxonomy
 *    in for its side effects was invisible to a guard whose whole subject is
 *    what the bundle carries.
 *  - `check-reporter-graph.ts` matched all four shapes and only DOUBLE quotes,
 *    because every file in its graph is written by this repository's prettier
 *    config; a single-quoted import there is a graph edge nobody walks.
 *  - `reached-from.ts` matched all four in one pattern and stripped comments
 *    first, because its predecessor was a substring test that prose fooled.
 *  - `check-problem-phrasing-imports.ts` needs the BINDINGS rather than the
 *    specifier, which is a different question and stays where it is.
 *
 * The differences were not decisions. Each pattern was written from the shapes
 * its author's tree happened to contain that day, which is the same way the
 * eighteen source-tree walks that `__tests__/helpers/source-files.ts` replaced
 * came to disagree about `node_modules`.
 *
 * ## What a record carries, and why it is not just a string
 *
 * Two of the three callers need more than the specifier. The analytics guard
 * reports `file:line` and the offending line's text, so it needs the OFFSET;
 * the reporter graph wants only the `.`-relative edges, and a caller that
 * cannot see the kind cannot tell a `require` from an `import` when the
 * distinction matters to it. So {@link importSpecifiers} returns records and
 * lets each rule ask its own question of them.
 *
 * Offsets are into the ORIGINAL source, which comes free: comments are blanked
 * by `stripComments` to spaces rather than deleted, so every index and line
 * number in the stripped text is the real one. That is what lets a caller
 * report a snippet by slicing the source it passed in.
 *
 * ## Still a text scan
 *
 * This is not a parse, and the ways around it are the ways around any text
 * match: a specifier built at runtime, a re-export chain, a bundler alias.
 * `check-reporter-graph` is the one caller that can tell — it compares this
 * list against the files node's own loader really pulled in, and reports the
 * difference rather than trusting either side.
 */

import { stripComments } from "./strip-comments";

/** How the module was taken. */
export type ImportKind =
  /** `import x from "p"`, `import type { X } from "p"`, `export … from "p"`. */
  | "static"
  /** `import "p"` — no bindings, and the shape a `from`-only pattern misses. */
  | "side-effect"
  /** `import("p")`. */
  | "dynamic"
  /** `require("p")`. */
  | "require";

/** One module the source takes, and where it says so. */
export interface ImportRecord {
  /** The specifier as written, quotes removed. */
  readonly specifier: string;
  /**
   * Offset of the statement's keyword in the source.
   *
   * Into the source as PASSED IN, not the stripped copy: `stripComments`
   * preserves every offset, so a caller can slice its own text for a snippet
   * and count newlines for a line number.
   */
  readonly index: number;
  /** Which of the four shapes matched. */
  readonly kind: ImportKind;
}

/**
 * One pattern per shape, because the kind is part of the answer.
 *
 * The static form allows anything but a quote, a semicolon or a backtick
 * between the keyword and its `from`, so a multi-line named clause is one
 * match and a `const x = "a"; from` cannot be spliced into one. `export` joins
 * `import` there: a re-export is an edge in the graph and reads as one to
 * every caller.
 */
const PATTERNS: readonly (readonly [ImportKind, RegExp])[] = [
  ["static", /\b(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"'\n]*)["']/g],
  ["dynamic", /\bimport\s*\(\s*["']([^"'\n]*)["']\s*\)/g],
  ["require", /\brequire\s*\(\s*["']([^"'\n]*)["']\s*\)/g],
  // Last of the four: `import ("p")`, written with a space, is a dynamic
  // import that this pattern also matches, and the earlier record wins.
  ["side-effect", /\bimport\s+["']([^"'\n]*)["']/g],
];

/**
 * Every module the source takes, in the order they appear.
 *
 * Comments are stripped first — the file that documents a forbidden import is
 * the file most likely to contain one — and duplicates are kept, because two
 * imports of one module on two lines are two findings to a rule that reports
 * `file:line`. A caller that wants the set says so.
 */
export function importSpecifiers(source: string): readonly ImportRecord[] {
  const stripped = stripComments(source);
  const found: ImportRecord[] = [];
  const seen = new Set<string>();
  for (const [kind, pattern] of PATTERNS) {
    for (const match of stripped.matchAll(new RegExp(pattern.source, "g"))) {
      // `import "p"` is inside `import x from "p"` for the side-effect pattern
      // only when the quote follows the keyword directly, but a dynamic
      // `import("p")` is matched by BOTH the side-effect and dynamic patterns
      // when written without a space. One record per (offset, specifier), and
      // the earlier pattern in the list wins — `static` before the rest.
      const key = `${String(match.index)} ${match[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ specifier: match[1], index: match.index, kind });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Just the specifiers, deduplicated and sorted — the set, for a membership test. */
export function importedModules(source: string): readonly string[] {
  return [...new Set(importSpecifiers(source).map((record) => record.specifier))].sort();
}

/**
 * Whether a specifier names that package or something inside it.
 *
 * Exact or a subpath: `nanoid` and `nanoid/non-secure` are the package,
 * `nanoid-esm` is somebody else's. The prefix rule is also why a scoped
 * package needs no special case, its name being `@scope/pkg`.
 */
export function specifierIsPackage(specifier: string, pkg: string): boolean {
  return specifier === pkg || specifier.startsWith(`${pkg}/`);
}

/**
 * Whether a specifier resolves to a repo module with that basename.
 *
 * By SUFFIX, so the relative depth a file happens to sit at does not matter
 * and `@/lib/analytics-events`, `../lib/analytics-events` and
 * `./analytics-events.ts` are one rule. A longer neighbour
 * (`analytics-events-migration`) does not match, which is the whole reason
 * this is not `includes`.
 */
export function specifierEndsWithModule(specifier: string, moduleName: string): boolean {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`/${escaped}(?:\\.[jt]sx?)?$`).test(specifier);
}
