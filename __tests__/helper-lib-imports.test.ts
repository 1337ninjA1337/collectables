import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile, repoPath } from "./helpers/repo-file";
import { readSuite, suiteFiles, topLevelSuites, SUITES_REL } from "./helpers/suite-files";

/**
 * What a test helper may import from `lib/`, and why the answer is not "anything".
 *
 * ## The failure this prevents
 *
 * `helpers/render.ts` aliases module specifiers onto doubles, and ESM caches a
 * module the first time it evaluates. A suite therefore registers its mocks at
 * module scope and imports the code under test LAZILY — the rule every mounted
 * suite states in its own header. A helper the suite imports statically is
 * evaluated before any of that, so anything that helper pulls in is resolved
 * for real, permanently, for that process.
 *
 * Two helpers already sit on the wrong side of that line and are safe only
 * because their imports are erased: `storage-failure-report.ts` takes
 * `CaptureContext` from `lib/sentry` and `StorageFailureReason` from
 * `lib/report-storage-failure` — the exact two modules its suites mock. Turn
 * either `import type` into a plain `import` (an auto-import, a lint autofix,
 * a hand edit that "tidies" the two lines together) and every one of those
 * suites loads the real Sentry wrapper before its shim registers. The failure
 * looks like a mock that stopped working, which is a long way from the edit.
 *
 * ## The rule
 *
 * A helper may import a `lib/` module for its VALUES only if that module's
 * transitive `lib/` closure imports nothing outside `node:` builtins. That is
 * the property that makes evaluation harmless: no React Native, no
 * AsyncStorage, no Supabase, no Sentry — nothing a suite would want to replace,
 * and nothing with module-level state a second suite would inherit.
 *
 * `import type` is exempt, because it is erased before the runner sees the
 * file. That is not a loophole; it is the whole reason the two risky imports
 * above are allowed to exist.
 *
 * The closure is walked rather than assumed, so a pure module that GROWS a
 * dependency (`lib/thrown-value` reaching for a store, `lib/i18n-source`
 * importing the context it parses) turns this red at the import that became
 * unsafe rather than in whichever suite happens to mock that module first.
 */

const LIB_REL = "lib";

/**
 * `@/lib/x` and `../../lib/x` are the two spellings the helpers use.
 *
 * Anchored at a line start and bounded by `[^;]` on purpose: a `[\s\S]*?`
 * middle matches from the FIRST import in the file to the lib import several
 * statements later, which reads `import assert from "node:assert/strict"` as
 * the start of the lib import and reports every type-only one as a value
 * import. The first draft did exactly that.
 */
const LIB_IMPORT =
  /^import\s+(type\s+)?([^;]*?)from\s+"(?:@\/lib\/|\.\.\/\.\.\/lib\/|\.\.\/lib\/)([\w.-]+)";/gm;

/** Anything a module imports, read from source with the comments removed. */
const ANY_IMPORT = /from\s+"([^"]+)"/g;

function libModulePath(name: string): string | null {
  for (const extension of [".ts", ".tsx"]) {
    const candidate = repoPath(LIB_REL, `${name}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readLibModule(name: string): string | null {
  const file = libModulePath(name);
  return file === null ? null : readRepoFile(LIB_REL, path.basename(file));
}

/**
 * Every non-`lib` specifier reachable from one `lib/` module, following only
 * `lib/` edges.
 *
 * Returns them with the module that imports each, so the failure names the
 * edge rather than the seed: "helpers/render.ts imports lib/thrown-value" is
 * not the useful half when the problem is three modules further in.
 */
function externalReach(seed: string): { specifier: string; from: string }[] {
  const found: { specifier: string; from: string }[] = [];
  const seen = new Set<string>();
  const queue = [seed];

  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);

    const source = readLibModule(name);
    if (source === null) {
      found.push({ specifier: `<no lib/${name}.ts>`, from: name });
      continue;
    }

    // Comments first: every module here explains itself, and a doc comment
    // quoting `from "somewhere"` is not an import. The first draft read one as
    // a dependency called "did not look there".
    for (const match of stripComments(source).matchAll(ANY_IMPORT)) {
      const specifier = match[1];
      if (specifier.startsWith("@/lib/")) {
        queue.push(specifier.slice("@/lib/".length));
      } else if (specifier.startsWith("./")) {
        queue.push(specifier.slice("./".length));
      } else {
        found.push({ specifier, from: name });
      }
    }
  }

  return found;
}

type HelperImport = { helper: string; module: string; typeOnly: boolean };

function helperLibImports(): HelperImport[] {
  const imports: HelperImport[] = [];
  for (const relative of suiteFiles()) {
    if (!relative.startsWith(`helpers${path.sep}`)) continue;
    if (!relative.endsWith(".ts")) continue;
    const source = stripComments(readRepoFile(SUITES_REL, relative));
    for (const match of source.matchAll(LIB_IMPORT)) {
      imports.push({ helper: relative, module: match[3], typeOnly: Boolean(match[1]) });
    }
  }
  return imports;
}

describe("what a test helper may take from lib/", () => {
  it("finds the imports it is about, so the rules below are not scanning an empty room", () => {
    const imports = helperLibImports();

    assert.ok(
      imports.length >= 10,
      `only ${String(imports.length)} lib imports found across the helpers — the parse, not the tree`,
    );
    assert.ok(
      imports.some((entry) => entry.typeOnly),
      "no type-only import was found, and the rule's whole exemption is that they are erased",
    );
  });

  it("every VALUE import reaches nothing but node builtins", () => {
    const offenders: string[] = [];
    for (const entry of helperLibImports()) {
      if (entry.typeOnly) continue;
      for (const reach of externalReach(entry.module)) {
        if (reach.specifier.startsWith("node:")) continue;
        offenders.push(
          `${entry.helper} imports lib/${entry.module} for its values, which reaches "${reach.specifier}" through lib/${reach.from}`,
        );
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "a helper is evaluated before any suite's mocks register, so anything it pulls in is resolved for real and permanently:\n" +
        offenders.join("\n"),
    );
  });

  it("the two risky modules are imported for their types and nothing else", () => {
    // Named rather than derived, because these are the two the rule exists for:
    // `lib/sentry` and `lib/report-storage-failure` are mocked by nine suites,
    // and a plain `import` of either would load the real one first.
    const risky = ["sentry", "report-storage-failure"];
    const value = helperLibImports().filter(
      (entry) => !entry.typeOnly && risky.includes(entry.module),
    );

    assert.deepEqual(
      value.map((entry) => `${entry.helper} -> lib/${entry.module}`),
      [],
      "these must be `import type`, which is erased — a plain import loads the module the suites replace",
    );
    assert.ok(
      helperLibImports().some((entry) => entry.typeOnly && risky.includes(entry.module)),
      "neither risky module is imported at all any more — delete this case rather than leaving it green over nothing",
    );
  });
});

/**
 * The same rule one level out: what a SUITE may take from `lib/` eagerly.
 *
 * A suite registers its mocks at module scope and imports the code under test
 * lazily, for the reason above — ESM caches a module the first time it
 * evaluates. Every mounted suite states that in its own header and every one of
 * them keeps it by hand. A static `import { x } from "@/lib/y"` at the top of
 * such a suite is the same failure as the helper one, arriving through the
 * suite's own import list instead of through a helper's: if `lib/y`'s closure
 * reaches a module the suite goes on to mock, the real one is already resolved
 * and cached when `mockModule` runs, and the mock is registered over a module
 * nobody will load again.
 *
 * ## Why this rule is narrower than the helper rule
 *
 * A helper is imported by suites it knows nothing about, so the only safe
 * property is an absolute one: its closure reaches nothing but `node:`
 * builtins. A suite knows exactly which modules it replaces, so the rule can be
 * the precise one — an eager `lib/` value import may reach anything EXCEPT a
 * specifier this suite mocks. That needs no exemption list: a suite eagerly
 * importing `@/lib/balanced-source` while mocking AsyncStorage is doing nothing
 * wrong, and saying so by hand in a list would be the part that goes stale.
 *
 * ## The mocks a suite installs through a helper count too
 *
 * `providerHarness` and `installSpyAsyncStorage` register mocks on the suite's
 * behalf, and a suite that eagerly imported a module those replace would be
 * just as broken for having delegated. The helper→specifier map is DERIVED by
 * reading the helpers for their own `mockModule` calls, so a helper that starts
 * mocking a fifth module extends this rule without anyone editing it.
 */

/**
 * One suite's source with the comments gone and its LINE structure kept.
 *
 * `suiteCode()` flattens whitespace, which is right for the shape sweeps and
 * wrong here: `LIB_IMPORT` is anchored at a line start on purpose, so over a
 * one-line file it matches at most once and the rule reads as a clean tree.
 * That is how the first draft of this sweep found a population of zero.
 */
function suiteSource(relative: string): string {
  return stripComments(readSuite(relative));
}

/** Every `helpers/*.ts` module that registers mocks, and what each replaces. */
function helperMockMap(): Map<string, ReadonlySet<string>> {
  const map = new Map<string, ReadonlySet<string>>();
  for (const relative of suiteFiles()) {
    if (!relative.startsWith(`helpers${path.sep}`)) continue;
    if (!relative.endsWith(".ts")) continue;
    const mocked = new Set<string>();
    for (const match of stripComments(readRepoFile(SUITES_REL, relative)).matchAll(
      /mockModule\(\s*"([^"]+)"/g,
    )) {
      mocked.add(match[1]);
    }
    if (mocked.size > 0) {
      map.set(path.basename(relative, ".ts"), mocked);
    }
  }
  return map;
}

/** What one suite replaces: its own `mockModule` calls plus its helpers'. */
function mockedBySuite(source: string, helpers: Map<string, ReadonlySet<string>>): Set<string> {
  const mocked = new Set<string>();
  for (const match of source.matchAll(/mockModule\(\s*"([^"]+)"/g)) mocked.add(match[1]);
  for (const [helper, specifiers] of helpers) {
    if (!source.includes(`"./helpers/${helper}"`)) continue;
    for (const specifier of specifiers) mocked.add(specifier);
  }
  return mocked;
}

/** The `lib/` modules a suite imports for their VALUES, at module scope. */
function eagerLibValueImports(source: string): string[] {
  return [...source.matchAll(LIB_IMPORT)].filter((match) => !match[1]).map((match) => match[3]);
}

/**
 * Why this suite's eager `lib/` imports are unsafe, or an empty list.
 *
 * Split out from the sweep so the planted-offender case can hand it a source
 * string: a rule whose negative half nothing runs is a rule that could be
 * `return []`, and this one is green over the whole tree today.
 */
function eagerImportOffences(source: string, helpers: Map<string, ReadonlySet<string>>): string[] {
  const mocked = mockedBySuite(source, helpers);
  if (mocked.size === 0) return [];
  const offences: string[] = [];
  for (const module of eagerLibValueImports(source)) {
    if (mocked.has(`@/lib/${module}`)) {
      offences.push(
        `imports lib/${module} for its values and then mocks it — the real one is cached before mockModule runs`,
      );
    }
    for (const reach of externalReach(module)) {
      if (!mocked.has(reach.specifier)) continue;
      offences.push(
        `imports lib/${module} for its values, which reaches "${reach.specifier}" through lib/${reach.from} — and this suite mocks it`,
      );
    }
  }
  return offences;
}

/**
 * A planted line, assembled rather than spelled out.
 *
 * Two other sweeps read this repository's suites for exactly the shapes the
 * cases below have to hand the detector: a hand-rolled double for the Sentry
 * wrapper, and a `providerHarness` import from the mounted-provider helper. A
 * string literal is source to both — and one of them reads the file WITH its
 * comments, so this paragraph may not spell either shape out either. Writing a
 * needle here would make this file an offender under two rules it has nothing
 * to do with, and the fix for THAT is an exemption in each of those sweeps: a
 * hole in a real rule, bought with a fixture. Splitting the needle costs one
 * function and leaves both sweeps absolute.
 */
const QUOTE = '"';

function plantedImport(names: string, from: string): string {
  return `import { ${names} } from ${QUOTE}${from}${QUOTE};`;
}

function plantedTypeImport(names: string, from: string): string {
  return `import type { ${names} } from ${QUOTE}${from}${QUOTE};`;
}

function plantedMock(specifier: string): string {
  return `mockModule(${QUOTE}${specifier}${QUOTE}, {});`;
}

describe("what a suite may take from lib/ before its mocks register", () => {
  it("finds suites that both mock and import eagerly, so the rule is not scanning an empty room", () => {
    const helpers = helperMockMap();
    assert.ok(
      helpers.size > 0,
      "no helper registers a mock — the derivation, not the tree; the map is what makes a delegated mock count",
    );

    const population = topLevelSuites().filter((relative) => {
      const source = suiteSource(relative);
      return (
        mockedBySuite(source, helpers).size > 0 && eagerLibValueImports(source).length > 0
      );
    });

    assert.ok(
      population.length >= 3,
      `only ${String(population.length)} suites both mock and import lib eagerly — the parse, not the tree`,
    );
  });

  it("no suite eagerly imports a lib module reaching something it mocks", () => {
    const helpers = helperMockMap();
    const offenders: string[] = [];
    for (const relative of topLevelSuites()) {
      for (const offence of eagerImportOffences(suiteSource(relative), helpers)) {
        offenders.push(`${relative} ${offence}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "move the import inside the case (await import(...)) so it resolves after the mock:\n" +
        offenders.join("\n"),
    );
  });

  it("catches a planted import that reaches a mocked module three edges in", () => {
    // The positive control the sweep cannot provide itself. `lib/storage-keys`
    // is where the AsyncStorage edge actually is; `lib/report-storage-failure`
    // is what a suite would plausibly import, and the message has to name the
    // former or the reader goes looking in the wrong file.
    const planted = [
      plantedImport("reportStorageFailure", "@/lib/report-storage-failure"),
      plantedMock("@react-native-async-storage/async-storage"),
    ].join("\n");

    const offences = eagerImportOffences(planted, helperMockMap());

    assert.equal(offences.length, 1);
    assert.match(offences[0], /@react-native-async-storage\/async-storage/);
    assert.match(offences[0], /through lib\/storage-keys/);
  });

  it("catches a suite that imports the very module it mocks", () => {
    const planted = [
      plantedImport("captureException", "@/lib/sentry"),
      plantedMock("@/lib/sentry"),
    ].join("\n");

    assert.deepEqual(eagerImportOffences(planted, helperMockMap()), [
      "imports lib/sentry for its values and then mocks it — the real one is cached before mockModule runs",
    ]);
  });

  it("counts a mock a helper registers on the suite's behalf", () => {
    // `providerHarness` mocks AsyncStorage; a suite that delegated is no less
    // broken for it, and this is the half a per-suite `mockModule` scan misses.
    const planted = [
      plantedImport("STORAGE_KEYS", "@/lib/storage-keys"),
      plantedImport("providerHarness", "./helpers/mount-provider"),
    ].join("\n");

    const offences = eagerImportOffences(planted, helperMockMap());

    assert.equal(offences.length, 1, "the helper's mock has to count or this is green");
    assert.match(offences[0], /@react-native-async-storage\/async-storage/);
  });

  it("leaves a type-only import alone, and a pure module alone", () => {
    const typeOnly = [
      plantedTypeImport("StorageFailureReason", "@/lib/report-storage-failure"),
      plantedMock("@react-native-async-storage/async-storage"),
    ].join("\n");
    const pure = [
      plantedImport("stripComments", "@/lib/strip-comments"),
      plantedMock("@react-native-async-storage/async-storage"),
    ].join("\n");

    assert.deepEqual(eagerImportOffences(typeOnly, helperMockMap()), [], "erased before the runner");
    assert.deepEqual(
      eagerImportOffences(pure, helperMockMap()),
      [],
      "a pure module reaches nothing this suite replaces, and forbidding it would need an exemption list",
    );
  });
});
