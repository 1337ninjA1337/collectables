import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { existsSync } from "node:fs";

import { repoPath } from "./helpers/repo-file";
import { readSuite, suiteFiles, SUITES_REL } from "./helpers/suite-files";
import { readSource } from "./helpers/source-files";

/**
 * A suite that mocks a module must not load it first.
 *
 * `mockModule` writes a shim into a registry and aliases a specifier — and it
 * only takes effect for a module that has NOT been evaluated yet, which its own
 * doc says. What the doc cannot say is how the failure looks: nothing throws,
 * nothing warns, the mock's recorder simply stays empty and the real module
 * runs. `diagnostics-provider-mounted.test.ts` was written with
 *
 *     import { DIAGNOSTICS_KEY } from "../lib/storage-keys";
 *
 * at the top, which is a constant — and `lib/storage-keys.ts` imports
 * AsyncStorage on its first line, so the REAL
 * `@react-native-async-storage/async-storage` was evaluated before the mock
 * registered. Its web build threw `ReferenceError: window is not defined`
 * inside the provider's hydrate, and five cases that meant to test the
 * successful read all tested the failure arm instead, in a suite that looked
 * like it covered everything.
 *
 * The rule is transitive, because that is where it hides: the import that
 * broke it named no mocked module. It reaches through the whole static graph
 * of everything a suite pulls in at module scope, `helpers/` included, and asks
 * whether any of it arrives at a specifier the suite mocks.
 *
 * A dynamic `await import(...)` inside a case is the fix and is deliberately
 * not matched — it runs after the mocks register, which is the whole point.
 */

/** `import … from "x"` — statements only, so `await import("x")` is not one. */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm;
/** A bare `import "x"` side-effect statement, which also evaluates the module. */
const SIDE_EFFECT_IMPORT = /^\s*import\s*["']([^"']+)["']\s*;?\s*$/gm;
const MOCKED_SPECIFIER = /mockModule\(\s*["']([^"']+)["']/g;

const EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js"];

/** Repo-relative path of a suite, as the walks spell it. */
function suiteRel(relative: string): string {
  return path.posix.join(SUITES_REL, relative);
}

function readRepoRelative(relative: string): string {
  return relative.startsWith(`${SUITES_REL}/`)
    ? readSuite(relative.slice(SUITES_REL.length + 1))
    : readSource(relative);
}

function matchesOf(source: string, pattern: RegExp): string[] {
  // A fresh RegExp per read: these carry /g, and a shared one would advance
  // `lastIndex` between files and skip half the tree.
  const fresh = new RegExp(pattern.source, pattern.flags);
  return [...source.matchAll(fresh)].map((match) => match[1]);
}

/** Every specifier a file evaluates at module scope. */
function staticImports(relative: string): string[] {
  const source = readRepoRelative(relative);
  return [...matchesOf(source, STATIC_IMPORT), ...matchesOf(source, SIDE_EFFECT_IMPORT)];
}

/**
 * Resolves a specifier to a repo-relative file, or null when it is a package
 * (`react`, `node:path`) or a path with nothing behind it.
 */
function resolveRepoFile(specifier: string, fromRelative: string): string | null {
  let candidate: string | null = null;
  if (specifier.startsWith("@/")) {
    candidate = specifier.slice(2);
  } else if (specifier.startsWith(".")) {
    candidate = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromRelative), specifier),
    );
  }
  if (candidate === null || candidate.startsWith("..")) return null;
  for (const extension of ["", ...EXTENSIONS]) {
    const withExtension = `${candidate}${extension}`;
    if (existsSync(repoPath(withExtension))) return withExtension;
  }
  for (const extension of EXTENSIONS) {
    const index = path.posix.join(candidate, `index${extension}`);
    if (existsSync(repoPath(index))) return index;
  }
  return null;
}

type Offence = {
  readonly suite: string;
  readonly specifier: string;
  /** How the suite reaches it: the suite itself, then each import in between. */
  readonly through: readonly string[];
};

/**
 * Walks one suite's static import graph, returning every mocked specifier it
 * evaluates before the mock could register — with the path that got there,
 * because the offending import usually names something else entirely.
 */
function offencesIn(suiteRelative: string): Offence[] {
  const root = suiteRel(suiteRelative);
  const mocked = new Set(matchesOf(readSuite(suiteRelative), MOCKED_SPECIFIER));
  const offences: Offence[] = [];
  const seen = new Set<string>([root]);
  const queue: { file: string; through: string[] }[] = [{ file: root, through: [root] }];

  while (queue.length > 0) {
    const { file, through } = queue.shift()!;
    for (const specifier of staticImports(file)) {
      // A helper that mocks (`helpers/spy-async-storage`) adds its own targets
      // to the set: a suite calling `installStorageSpy()` mocks AsyncStorage
      // just as surely as one spelling the call itself.
      const resolved = resolveRepoFile(specifier, file);
      if (mocked.has(specifier)) {
        offences.push({ suite: suiteRelative, specifier, through: [...through, specifier] });
        continue;
      }
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      for (const target of matchesOf(readRepoRelative(resolved), MOCKED_SPECIFIER)) {
        mocked.add(target);
      }
      queue.push({ file: resolved, through: [...through, resolved] });
    }
  }
  return offences;
}

/** Suites that mock anything, directly or through a helper they import. */
function mockingSuites(): string[] {
  return suiteFiles().filter((relative) => {
    if (!relative.endsWith(".test.ts")) return false;
    const source = readSuite(relative);
    return source.includes("mockModule(") || source.includes("installStorageSpy(");
  });
}

describe("mockModule suites do not evaluate what they mock", () => {
  it("finds the suites that mock at all — an empty walk proves nothing", () => {
    const suites = mockingSuites();
    assert.ok(
      suites.length >= 8,
      `the walk found ${suites.length} mocking suites; there were eleven when this rule was written, so a reader that stopped matching would pass this sweep by finding nobody to check`,
    );
  });

  it("no suite statically reaches a module it mocks", () => {
    const offences = mockingSuites().flatMap(offencesIn);
    assert.deepEqual(
      offences.map((offence) => `${offence.suite}: ${offence.through.join(" → ")}`),
      [],
      "these suites evaluate a module at import time and mock it afterwards, so the mock never takes effect and the real module runs — move the import into the case as `await import(...)`",
    );
  });

  it("reads a specifier through a chain of files, not just the suite's own imports", () => {
    // The bug this rule exists for was two hops out: the suite imported
    // `lib/storage-keys`, which imports AsyncStorage. A resolver that only
    // looked at the suite's own import list would have passed it.
    const chain = resolveRepoFile("@/lib/storage-keys", suiteRel("x.test.ts"));
    assert.equal(chain, "lib/storage-keys.ts");
    assert.ok(
      staticImports("lib/storage-keys.ts").includes(
        "@react-native-async-storage/async-storage",
      ),
      "the file that made this rule necessary must still be the example it is read through",
    );
  });

  it("does not count a dynamic import, which is the sanctioned fix", () => {
    const dynamic = readSuite("diagnostics-provider-mounted.test.ts");
    assert.match(dynamic, /await import\("\.\.\/lib\/storage-keys"\)/);
    assert.deepEqual(offencesIn("diagnostics-provider-mounted.test.ts"), []);
  });
});
