/**
 * The suite directory, walked and read once.
 *
 * Seven suites here sweep their own siblings — a guard that says "no suite
 * does X" cannot check a list, because the list is the thing that goes stale.
 * Each of them had written the walk for itself, and by this morning four of
 * the copies were byte-identical twelve-line `suiteFiles()` functions, three
 * of them added the same day by the runs that removed exactly this duplication
 * one level down (`readRepoFile`, `repoPath`, `readEdgeFunction`). Four copies
 * of a walk written in one day is the argument for the fifth never being
 * written.
 *
 * Two shapes, because the sweeps genuinely want two:
 *
 * - {@link suiteFiles} — every `.ts`, one level of subdirectory included, so a
 *   rule about how suites are WRITTEN reaches `helpers/` too. This is what the
 *   "said once" guards want; a helper is exactly where a retired shape hides.
 * - {@link topLevelSuites} — the `*.test.ts` names directly under `__tests__`,
 *   which is the set `npm test`'s `__tests__/*.test.ts` glob actually RUNS. A
 *   rule about behaviour at runtime wants this one, and the difference is not
 *   cosmetic: a suite in a subdirectory typechecks and never executes, which
 *   is what `test-typecheck-prelude.test.ts` exists to catch.
 *
 * Both return paths relative to the suite directory (`"helpers/repo-file.ts"`,
 * `"i18n-source-file.test.ts"`), because that is what an offender list should
 * print and what an exemption entry should be written as.
 *
 * The readers are here for the same reason as the walk. A sweep that greps
 * source is comparing text, and how the text is normalised before the compare
 * is part of the rule: {@link suiteText} flattens whitespace so a prettier
 * rewrap cannot hide a shape, and {@link suiteCode} strips comments first so a
 * doc comment may still explain the thing being retired. Two guards had
 * written both, under two names, and the choice between them is a decision
 * worth reading in one place.
 *
 * `test-typecheck-prelude.test.ts` keeps its own recursive walk on purpose:
 * its subject is the files this module's one-level walk would MISS, so
 * sharing the walk would make it agree with itself.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/env-inlining";

import { readRepoFile, repoPath } from "./repo-file";

/** Where the suites live, repo-relative — the one statement of it. */
export const SUITES_REL = "__tests__";

/** The same absolute, for the walks and for the case that pins it. */
export const SUITES_DIR = repoPath(SUITES_REL);

/**
 * Every `.ts` under `__tests__`, one level of subdirectory included.
 *
 * One level rather than fully recursive because that is the tree that exists —
 * `helpers/` and `helpers/stubs/` — and because a sweep should report a
 * surprise rather than absorb it. Nothing here reads a third level today, and
 * a suite that appears at one should turn a guard red rather than be quietly
 * skipped.
 */
export function suiteFiles(): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(SUITES_DIR)) {
    const full = path.join(SUITES_DIR, entry);
    if (statSync(full).isDirectory()) {
      for (const nested of readdirSync(full)) {
        if (nested.endsWith(".ts")) found.push(path.join(entry, nested));
      }
      continue;
    }
    if (entry.endsWith(".ts")) found.push(entry);
  }
  return found;
}

/**
 * The `*.test.ts` names directly under `__tests__` — the set `npm test` runs.
 *
 * Ask for this when the rule is about what EXECUTES (a suite that must be in
 * the glob, a script that must select a subset of it) and for
 * {@link suiteFiles} when the rule is about what is WRITTEN.
 */
export function topLevelSuites(): readonly string[] {
  return suiteFiles().filter(
    (relative) => !relative.includes(path.sep) && relative.endsWith(".test.ts"),
  );
}

/** One suite's source text, by the relative path the walks return. */
export function readSuite(relative: string): string {
  return readRepoFile(SUITES_REL, relative);
}

/**
 * The same with runs of whitespace flattened.
 *
 * So a shape survives being found across a prettier rewrap: `assert.equal(\n
 * matches.length,\n  6,\n)` and the one-line form are the same string here,
 * and a guard that matched only the one-liner is how three suites once read
 * clean while still doing the thing.
 */
export function suiteText(relative: string): string {
  return readSuite(relative).replace(/\s+/g, " ");
}

/**
 * The same with comments removed BEFORE flattening.
 *
 * The right default for a rule about what a suite DOES, because prose is where
 * the decision gets explained — the guards that retire a shape quote it in
 * their own doc comments, and so does the helper that replaced it. Stripping
 * lets the rule stay "not at all" instead of growing an exemption per file
 * that mentions it.
 */
export function suiteCode(relative: string): string {
  return stripComments(readSuite(relative)).replace(/\s+/g, " ");
}
