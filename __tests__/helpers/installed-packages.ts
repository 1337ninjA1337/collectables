/**
 * Reading what npm installed — the fourth tree, and the first one named.
 *
 * WHAT THIS IS ABOUT. A suite here reads four different trees and until now
 * only three of them had a name.
 *
 *   - `helpers/source-files.ts` walks the application's own code.
 *   - `helpers/suite-files.ts` walks the suites.
 *   - the bundle suites walk `dist/`, which the build produced.
 *   - and two suites reach into `node_modules`, which is none of those.
 *
 * The three named ones are facts about THIS REPOSITORY: the same commit gives
 * the same answer next year, which is the property the whole gate rests on.
 * `node_modules` is a fact about what npm resolved on the machine the run is
 * happening on. A lockfile bump changes it with no diff in any file a suite
 * reads, and a `npm ci` on a different day can change it too. That is a real
 * distinction and nothing in the tree stated it, so the two reads that exist
 * were written twice, differently, by people who each decided it was fine.
 *
 * `ships-to-client.test.ts` is the one that needs it most: it checks that each
 * accepted advisory's `absentFingerprint` is really a string in that package,
 * because a fingerprint that is not in the package can never be in a bundle
 * either — the guard would pass forever while reporting the claim as measured.
 * That case is a statement about an installed dependency's source, and it goes
 * red when a major upgrade rewords an error message. Which is correct, and is
 * a thing a reader should be told before they start debugging their own diff.
 *
 * ## What a caller gets, and what it does not
 *
 * A package's OWN code, its nested dependencies excluded — {@link
 * installedPackageFiles} skips `node_modules` inside the package, because a
 * string borrowed from something the package merely depends on goes missing
 * the day that dependency moves and the borrower would quietly stop asking.
 *
 * No walk of the whole installed tree. Nothing here needs one, it is the
 * slowest read available in this repository, and a helper that offered it
 * would make "scan every dependency" a one-liner for a suite that should be
 * asking a narrower question.
 */

import path from "node:path";

import { listFilesUnder } from "@/scripts/guard-io";

import { readRepoFile, repoPath } from "./repo-file";

/** Where npm puts things. Written once, here, and nowhere else in a suite. */
const INSTALLED = "node_modules";

/**
 * The installed tree's own root, for a caller whose subject is the directory
 * rather than anything in it — `guard-fixture-refusals.test.ts` walks the
 * resolution chain that starts there.
 */
export function installedRoot(): string {
  return repoPath(INSTALLED);
}

/**
 * An absolute path inside an installed package, e.g.
 * `installedPackagePath("postcss", "lib", "css-syntax-error.js")`.
 *
 * Scoped names work as written (`@sentry/react-native`): the package name is
 * split on `/` so a caller never has to know that the scope is a directory.
 */
export function installedPackagePath(pkg: string, ...rest: readonly string[]): string {
  return repoPath(INSTALLED, ...pkg.split("/"), ...rest);
}

/**
 * A package's own JavaScript, as paths relative to the package root, sorted.
 *
 * Empty is a legitimate answer for a types-only or ESM-`.ts` package, so
 * callers that need the walk to have found something assert that themselves —
 * a helper that threw on empty would be deciding a question it cannot see.
 */
export function installedPackageFiles(pkg: string): readonly string[] {
  return listFilesUnder(installedPackagePath(pkg), {
    extensions: [".js", ".mjs", ".cjs"],
    skipDirs: [INSTALLED],
  });
}

/** One file's text out of an installed package, by its package-relative path. */
export function readInstalledFile(pkg: string, relative: string): string {
  return readRepoFile(path.join(INSTALLED, pkg, relative));
}

/**
 * An installed CLI, e.g. `installedBin("tsc")`.
 *
 * `.bin` is npm's own shim directory rather than a package, so it gets its own
 * function instead of a `installedPackagePath(".bin", name)` call that would
 * read as a package called `.bin`.
 */
export function installedBin(name: string): string {
  return repoPath(INSTALLED, ".bin", name);
}
