/**
 * An Edge Function's source, by name.
 *
 * `supabase/functions/<name>/index.ts` is a layout, not a path — every
 * function in the repo lives at it, and the suites that check adoption of a
 * shared helper (`assertCaller`, the `cors` gate, the service-role claim)
 * iterate over a list of NAMES and open each one. Three of them had written
 * the same `fnSource(name)` for themselves, and the reason to stop at three
 * rather than at thirty is the one the repo-file migration paid for at
 * scale: two copies is not a problem, it is how a hundred and fourteen start.
 *
 * Layered on {@link readRepoFile}, so the layout is the only thing said here
 * and how the suites reach the tree stays said once, one module down.
 *
 * Names, not paths, because the name is what the callers actually have — the
 * adoption suites list `["delete-account", "sign-upload", …]` and a helper
 * taking a path would make each of them re-render the layout to call it,
 * which is the duplication with an extra step.
 */

import { readRepoFile, repoPath } from "./repo-file";

/** Where a function's entry point lives, repo-relative — the layout, once. */
export const edgeFunctionRel = (name: string): string =>
  `supabase/functions/${name}/index.ts`;

/** The same, absolute — for the few assertions that `stat` it rather than read it. */
export const edgeFunctionPath = (name: string): string =>
  repoPath(edgeFunctionRel(name));

/**
 * A function's entry-point source text.
 *
 * Throws (`ENOENT`) on a name with no function behind it, which is what a
 * renamed or deleted function should do to an adoption list that still names
 * it — a suite silently checking nothing is the failure mode worth avoiding.
 */
export const readEdgeFunction = (name: string): string =>
  readRepoFile(edgeFunctionRel(name));
