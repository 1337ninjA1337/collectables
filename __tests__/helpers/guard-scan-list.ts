/**
 * The scan list a guard declares, read out of its own source.
 *
 * `guard-scan-dirs.test.ts` has parsed `const SCANNED_DIRS = [...] as const;`
 * out of each `scripts/check-*.ts` since the day three guards were found
 * declaring the same list under three different names. The parse lives here
 * rather than in that suite because a second reader arrived on 2026-09-14:
 * `jsx-walk-reach.test.ts` floors how much markup the JSX rules read, and the
 * set of directories it has to cover is not its own decision — it is the union
 * of what those rules scan, and a copy of that union is a number that goes
 * stale the first time a rule widens.
 *
 * A LITERAL is what gets parsed, deliberately. A `[...SOURCE_DIRS]` spread
 * would satisfy the one-copy-of-the-list rule and defeat the pin that keeps
 * every guard's scan list readable from its own file; `guard-scan-dirs.test.ts`
 * records the two guards that legitimately write the six roots out because of
 * it.
 */

import assert from "node:assert/strict";

import { MARKUP_DIRS } from "@/lib/source-dirs";

import { readRepoFile } from "./repo-file";

/**
 * The directories `scripts/<guard>.ts` declares it scans.
 *
 * Throws rather than returning empty when the declaration is missing: a guard
 * whose list could not be read is a guard nothing downstream can reason about,
 * and an empty answer would quietly widen or narrow whatever asked.
 */
export function declaredScanDirs(guard: string): string[] {
  const source = readRepoFile("scripts", `${guard}.ts`);
  const match = source.match(/const SCANNED_DIRS = \[([^\]]*)\] as const;/);
  assert.ok(match, `${guard} does not declare a SCANNED_DIRS list`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The roots the SUITE-SIDE JSX rules walk.
 *
 * `lib/source-dirs.ts`'s {@link MARKUP_DIRS}, re-exported under the name the
 * three suites reach for. It was its own two-element literal for one commit,
 * which made it the SECOND statement of a list the script guards already
 * state — the same split `source-dirs.ts` exists to resolve, reproduced one
 * directory over.
 *
 * The alias rather than a bare re-export because the suites' own list used to
 * be a different thing from the guards' and could become one again; the day a
 * suite-side rule legitimately reads a root with no markup in it, this is
 * where that stops being an alias and the diff says so.
 */
export const JSX_SUITE_SCAN_DIRS = MARKUP_DIRS;

/** The union of several guards' scan lists, sorted and de-duplicated. */
export function unionOfScanDirs(...guards: readonly string[]): string[] {
  return [...new Set(guards.flatMap((guard) => declaredScanDirs(guard)))].sort();
}
