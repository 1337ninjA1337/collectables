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

import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile, repoPath } from "./repo-file";

/** Where the suites live, repo-relative — the one statement of it. */
export const SUITES_REL = "__tests__";

/** The same absolute, for the walks and for the case that pins it. */
export const SUITES_DIR = repoPath(SUITES_REL);

/**
 * The walk and the reads, held for the life of the process.
 *
 * Memoised where the modules below it deliberately are not, and the difference
 * is what a hit is worth. `readRepoFile` is asked for one file per suite, so a
 * cache there could only ever hit within one process and the suites that read
 * twice already hold a `const`. A SWEEP reads every file, and there are six of
 * them across four guards — `repo-file-helper.test.ts` alone runs three, one
 * of which strips comments from ~290 files character by character. The tree
 * cannot change mid-run (each suite is its own process, and nothing here
 * writes to the repository), so one answer per process is also the only
 * correct answer.
 *
 * "Nothing writes to the repository" is a premise, not a law — the guard
 * fixtures write to `mkdtemp` roots, but `guard-fixture-refusals.test.ts`
 * already creates `guard-fixture-nested-*` directories under the repo root —
 * so {@link __resetSuiteFilesCacheForTests} exists for the case where a suite
 * does. Same shape as `lib/sentry.ts` and `lib/supabase-realtime.ts`, for the
 * same reason: a module-scope cache with no way to clear it is correct until
 * it quietly is not.
 */
let walked: readonly string[] | null = null;
const readCache = new Map<string, string>();
const textCache = new Map<string, string>();
const codeCache = new Map<string, string>();

/**
 * Forget the walk and the reads, for a suite that changes the tree under them.
 *
 * Nothing calls this today. It is here because the alternative to a two-line
 * escape hatch is a future suite discovering that the walk answers from before
 * its fixture existed, which reads as the walk being broken.
 */
export function __resetSuiteFilesCacheForTests(): void {
  walked = null;
  readCache.clear();
  textCache.clear();
  codeCache.clear();
}

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
  if (walked) return walked;
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
  walked = found;
  return walked;
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
  const cached = readCache.get(relative);
  if (cached !== undefined) return cached;
  const source = readRepoFile(SUITES_REL, relative);
  readCache.set(relative, source);
  return source;
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
  const cached = textCache.get(relative);
  if (cached !== undefined) return cached;
  const flattened = readSuite(relative).replace(/\s+/g, " ");
  textCache.set(relative, flattened);
  return flattened;
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
  const cached = codeCache.get(relative);
  if (cached !== undefined) return cached;
  const stripped = stripComments(readSuite(relative)).replace(/\s+/g, " ");
  codeCache.set(relative, stripped);
  return stripped;
}

/**
 * An allow-list is a hole, so hold it to the four things that keep it honest.
 *
 * Every sweep here needs exemptions — the helper a rule is about has to name
 * the shape, and so does the guard that quotes it to search for it — and four
 * guards had each written the same check around theirs, in the same order, in
 * nearly the same words. The fourth part (does the entry still NEED it?) was
 * written twice today, independently, which is the part most worth having in
 * one place: an entry that stopped doing the thing is a hole standing open for
 * whoever writes the next suite, and nothing about it looks stale.
 *
 * - `expected` is passed separately from `exemptions` ON PURPOSE. It is the
 *   tripwire: the list lives at module scope and this call sits in a case a
 *   hundred lines down, so widening the hole means finding both. Folding them
 *   into one literal would make the check agree with itself.
 * - `rule` names what the entries are exempt FROM, so the failure reads as a
 *   sentence rather than as a variable name.
 * - `stillNeeded` is the guard's own predicate — usually "its source still
 *   contains the shape" — because only the guard knows what its exemption is
 *   for.
 */
export function assertExemptionsHonest(options: {
  readonly exemptions: readonly string[];
  readonly expected: readonly string[];
  readonly rule: string;
  readonly stillNeeded: (relative: string) => boolean;
}): void {
  const { exemptions, expected, rule, stillNeeded } = options;
  assert.deepEqual(
    exemptions,
    expected,
    `the ${rule} exemption list changed — widening it is a decision to make out loud`,
  );
  assert.ok(exemptions.length > 0, `the ${rule} exemption list is empty — delete it instead`);
  assert.equal(
    new Set(exemptions).size,
    exemptions.length,
    `the ${rule} exemption list repeats an entry, which hides how wide it is`,
  );
  const walk = suiteFiles();
  for (const allowed of exemptions) {
    assert.ok(
      walk.includes(allowed),
      `${allowed} is exempted from ${rule} but is not in the walk — a stale entry exempts nothing and hides that it is stale`,
    );
    assert.ok(
      stillNeeded(allowed),
      `${allowed} is exempted from ${rule} but no longer needs it — drop the entry rather than leaving the hole open`,
    );
  }
}
