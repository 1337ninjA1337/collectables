/**
 * Holding a reachability acceptance to an address that is still live, and to
 * being the whole address.
 *
 * ## What `reachedFrom` was, and what it was not
 *
 * An entry on `ACCEPTED_HIGH_ADVISORIES` that says `shipsToClient: true` is
 * accepted on an argument about call sites: the package reaches a browser, and
 * no call site here passes it the shape the advisory needs. No grep settles
 * that, which is why `absentFingerprint` skips those entries — so what they are
 * held to is naming WHERE the argument was made, and `ships-to-client.test.ts`
 * held each named path to still existing and still naming the package.
 *
 * "Still naming the package" was `source.includes("nanoid")`. That passes on a
 * doc comment about the removal, on a variable called `nanoidLike`, and — the
 * shape this is really about — on an `import` left behind after the call it
 * served was deleted. A dead import is exactly the address that has gone quiet
 * while reading as live, so the one check standing between an acceptance and a
 * sentence nobody can locate was the check most likely to be fooled by the
 * thing it was written to catch.
 *
 * {@link importsPackage} asks the question the substring was standing in for:
 * does this file take a module out of that package? Comments are stripped
 * first, so prose about the package is prose; the specifier has to be the
 * package itself or a subpath of it, so `nanoid` is not matched by
 * `nanoid-esm`.
 *
 * ## The half nobody was asking at all
 *
 * The old case walked the LISTED paths. An entry could name one file while the
 * package was imported in six, and the acceptance would read as fully argued —
 * the five unread call sites being precisely the ones where the argument might
 * not hold. That population is knowable: it is a sweep of the source tree for
 * files that import the package, and {@link evaluateReachedFrom} reports the
 * ones the entry does not name.
 *
 * Both halves come back from one pass because they are one question asked in
 * two directions — a listed path that does not import (`dead`) and an importer
 * that is not listed (`unlisted`) — and an entry that has drifted usually has
 * both.
 *
 * ## What this can and cannot say
 *
 * It says the addresses are live and complete. It says nothing about whether
 * the argument at those addresses is right: a call site that imports the
 * package and passes it attacker-controlled input reads identically here to
 * one that passes it a constant. That judgement stays a person's, which is the
 * whole reason the field records where to go and make it.
 *
 * Detection is a text match, so the ways out are the ways out of every text
 * match: a specifier built at runtime (`require(base + "/nanoid")`), a package
 * reached through a re-export somewhere else in the tree, a bundler alias. All
 * three make an importer invisible to the sweep, which shows up as an entry
 * naming a path the sweep does not — never as a silent pass on a dead address.
 */

import { stripComments } from "./strip-comments";

/**
 * Every module specifier the source imports, requires, or re-exports from.
 *
 * One pattern for all five spellings, because they all put the specifier in a
 * quoted string directly after a keyword: `import x from "p"`, a bare
 * `import "p"`, `export … from "p"`, `require("p")` and a dynamic `import("p")`.
 * A type-only import is included — `import type { X } from "p"` still says the
 * argument was made about this file's relationship to the package, and a file
 * that only names its types is one the reader should still be sent to.
 *
 * Comments are blanked first (to spaces, so nothing shifts), which is the
 * difference between this and the substring test it replaces: the file that
 * documents why a package was dropped is the file most likely to mention it.
 */
export function moduleSpecifiers(source: string): readonly string[] {
  const found = new Set<string>();
  for (const match of stripComments(source).matchAll(
    /\b(?:from|import|require)\s*\(?\s*["']([^"'\n]*)["']/g,
  )) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * Whether the source takes a module out of that package.
 *
 * Exact specifier or a subpath of it: `nanoid` and `nanoid/non-secure` are the
 * package, `nanoid-esm` and `@scoped/nanoid` are other packages that happen to
 * start with the same letters. The prefix rule is what the substring match was
 * missing — it is also why a scoped package works without a special case, its
 * name being `@scope/pkg` and its subpaths `@scope/pkg/…`.
 */
export function importsPackage(source: string, pkg: string): boolean {
  return moduleSpecifiers(source).some(
    (specifier) => specifier === pkg || specifier.startsWith(`${pkg}/`),
  );
}

/** What a `shipsToClient: true` entry's listed call sites turned out to be. */
export interface ReachedFromVerdict {
  /**
   * Listed paths that no longer import the package.
   *
   * Either the file was refactored and the acceptance points at nothing, or
   * the import is still in the text and the call is gone — both leave an
   * address that reads live and answers nothing. A path missing from the tree
   * entirely lands here too: a deleted file is the same finding.
   */
  readonly dead: readonly string[];
  /**
   * Files that import the package and the entry does not name.
   *
   * The half nothing asked. The acceptance is an argument about which call
   * sites exist, so a call site the argument never mentioned is either one
   * somebody forgot to write down or one that was never read — and the entry
   * cannot say which.
   */
  readonly unlisted: readonly string[];
}

/**
 * Compares one entry's `reachedFrom` against a tree that has been read.
 *
 * Takes the sources as a map rather than walking anything, the same shape
 * `evaluateShipsToClient` takes its chunks in: the walk belongs to the caller
 * that knows which directories are source, and the logic stays testable
 * without a tree.
 *
 * Both lists sorted, both empty being the passing case.
 */
export function evaluateReachedFrom(
  pkg: string,
  sites: readonly string[],
  tree: ReadonlyMap<string, string>,
): ReachedFromVerdict {
  const listed = new Set(sites);
  const dead = sites
    .filter((site) => {
      const source = tree.get(site);
      return source === undefined || !importsPackage(source, pkg);
    })
    .sort();
  const unlisted = [...tree]
    .filter(([relative, source]) => !listed.has(relative) && importsPackage(source, pkg))
    .map(([relative]) => relative)
    .sort();
  return { dead: [...new Set(dead)], unlisted };
}

/**
 * The findings as sentences, one per line, empty when the entry is clean.
 *
 * Written here rather than at the assertion so both halves say what to do
 * about it: the fix for either is to re-read the argument at the call sites,
 * never to edit the list until the check goes quiet.
 */
export function formatReachedFromFindings(pkg: string, verdict: ReachedFromVerdict): string[] {
  const lines: string[] = [];
  if (verdict.dead.length > 0) {
    lines.push(
      `${pkg}'s acceptance is argued from ${verdict.dead.join(", ")}, which no longer import the package — re-read the argument rather than re-pointing the path`,
    );
  }
  if (verdict.unlisted.length > 0) {
    lines.push(
      `${pkg} is imported by ${verdict.unlisted.join(", ")}, which \`reachedFrom\` does not name — the acceptance is an argument about which call sites exist, so an unnamed one is a call site nobody re-read`,
    );
  }
  return lines;
}
