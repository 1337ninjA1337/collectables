import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile, repoPath } from "./helpers/repo-file";
import { suiteFiles, SUITES_REL } from "./helpers/suite-files";

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
  /^import\s+(type\s+)?([^;]*?)from\s+"(?:@\/lib\/|\.\.\/\.\.\/lib\/)([\w.-]+)";/gm;

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
