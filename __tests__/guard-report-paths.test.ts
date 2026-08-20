import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { LINT_GUARDS } from "@/lib/lint-guards";

import { checkNameOf, makePartialRoot, runGuardIn } from "./helpers/guard-fixture";
import { readRepoFile } from "./helpers/repo-file";

/**
 * A guard's report names a file. Can a reader open it?
 *
 * Every walking guard prints `<path>:<line>:<column>  <finding>`, and the path
 * is relative to something the report never states. That was fine while each
 * guard did its own `path.relative(repoRoot, absolute)` and could not get it
 * wrong; it stopped being fine the moment the shared walk started returning
 * paths relative to the ROOT IT WAS GIVEN — `dist/`-relative for the bundle
 * scan, repo-relative for the rest. Both `_expo/static/js/web/entry-….js` and
 * `dist/_expo/…` look equally plausible in a report, and neither the type
 * system nor a green run can tell them apart.
 *
 * So each guard is run over a scratch tree with a planted offender, and the
 * path it prints is joined back onto the root it was pointed at and opened.
 * The failure this catches is a report that names a file nobody can find,
 * which is a guard that is right and useless.
 *
 * The offenders are the smallest thing each matcher rejects, written out
 * rather than borrowed from the real tree: an offender that already exists
 * would make the case pass on a walk that ignored the plant entirely.
 */

/** Guard → the roots to copy, and the offending file to plant beside them. */
const PLANTED: Readonly<
  Record<string, { readonly entries: readonly string[]; readonly file: string; readonly source: string }>
> = {
  "check-inline-hex": {
    entries: ["app", "components", "lib"],
    file: "app/planted-offender.tsx",
    source: 'export const bg = "#123456";\n',
  },
  "check-inline-radius": {
    entries: ["app", "components"],
    file: "app/planted-offender.tsx",
    source: "export const s = { borderRadius: 999 };\n",
  },
  "check-analytics-imports": {
    entries: ["app", "components"],
    file: "app/planted-offender.tsx",
    source: 'import { ANALYTICS_EVENTS } from "@/lib/analytics-events";\n\nexport const e = ANALYTICS_EVENTS;\n',
  },
  "check-clarity-input-mask": {
    entries: ["app", "components"],
    file: "app/planted-offender.tsx",
    source: "export const Screen = () => <TextInput value={email} />;\n",
  },
  "check-a11y-jsx": {
    entries: ["app", "components"],
    file: "app/planted-offender.tsx",
    // An arrow in the attribute on purpose: it is the shape that made the
    // first version of this scanner read a fragment of the open tag, so a
    // plant without one would be found by a scanner this guard has already
    // outgrown.
    source:
      'export const Screen = () => (\n  <Pressable onPress={() => close()}>\n    <Ionicons name="close" />\n  </Pressable>\n);\n',
  },
};

/**
 * The path a guard printed for the PLANTED file, exactly as printed.
 *
 * Matched by the plant's own basename rather than by "the first path-shaped
 * thing in the output", because the reports carry prose that names real files
 * — `check-inline-hex` tells the reader to route the value through
 * `lib/design-tokens.ts`, which exists in the fixture and would resolve
 * happily while saying nothing about the finding. The three guards also print
 * the location three ways (bare, `:line`, `:line:column`), so the line and
 * column are deliberately not part of this: what is under test is the BASE the
 * path is relative to.
 */
function reportedPath(output: string, plantedBasename: string): string | null {
  const match = output.match(
    new RegExp(`([\\w./\\[\\]-]*${plantedBasename.replace(".", "\\.")})(?::\\d+)*`),
  );
  return match ? match[1] : null;
}

describe("a guard's report names a file its reader can open", () => {
  for (const [checkName, plant] of Object.entries(PLANTED)) {
    const guard = LINT_GUARDS.find((g) => checkNameOf(g.scriptPath) === checkName);

    it(`${checkName} reports a path that resolves under the root it scanned`, () => {
      assert.ok(guard, `${checkName} is not in LINT_GUARDS`);
      const fixture = makePartialRoot(plant.entries, { [plant.file]: plant.source });
      try {
        const run = runGuardIn(guard, fixture.root);
        // The plant has to be FOUND first, or the path assertion below is
        // about a report that was never printed.
        assert.equal(
          run.status,
          1,
          `${checkName} did not flag its planted offender, so there is no report to check:\n${run.output}`,
        );
        const reported = reportedPath(run.output, path.basename(plant.file));
        assert.ok(reported, `${checkName} printed no path:line:column at all:\n${run.output}`);
        const resolved = path.join(fixture.root, reported);
        assert.ok(
          existsSync(resolved),
          `${checkName} reported "${reported}", which does not resolve under the root it was pointed at — a reader following that path opens nothing`,
        );
        // Readable, not just present: a path that resolves to a directory
        // would satisfy `existsSync` and still not be the thing that was
        // scanned.
        assert.equal(typeof readFileSync(resolved, "utf8"), "string");
        assert.ok(
          !path.isAbsolute(reported),
          `${checkName} reported an absolute path — the report should be readable without knowing where CI checked out`,
        );
      } finally {
        fixture.cleanup();
      }
    });
  }

  it("check-problem-phrasing-imports reads and reports through the same base", () => {
    // The one `listSourceFiles` caller with no planted fixture, and the reason
    // is its floor: it scans five roots including `__tests__/` and refuses
    // below 450 files, so a fixture that gets far enough to print a report has
    // to copy the whole suite directory — four hundred files per run to prove
    // the three lines the other four already prove. The lines are pinned
    // instead, as the pair that has to agree: the path handed to the matcher
    // (which becomes the report) and the path handed to the reader must have
    // the same base, or the guard reports a file it did not open.
    const source = readRepoFile("scripts/check-problem-phrasing-imports.ts");
    assert.match(source, /const files = listSourceFiles\(repoRoot, SCANNED_DIRS\);/);
    assert.match(source, /readFileSync\(path\.join\(repoRoot, file\), "utf8"\)/);
    assert.match(source, /findUnjoinedProblemPhrasingImports\(file, source\)/);
  });

  it("covers every guard whose walk returns paths relative to a root", () => {
    // The list above is a list, so it goes stale the way a list does. This is
    // what says it did not: every wrapper calling the shared source walk is
    // either planted or asserted at the source with a reason, because the
    // walk's base is exactly what those guards can now get wrong.
    const ASSERTED_AT_SOURCE = ["check-problem-phrasing-imports"];
    const callers = LINT_GUARDS.map((g) => checkNameOf(g.scriptPath)).filter((checkName) =>
      /\blistSourceFiles\(/.test(readRepoFile("scripts", `${checkName}.ts`)),
    );
    assert.deepEqual(
      callers.sort(),
      [...Object.keys(PLANTED), ...ASSERTED_AT_SOURCE].sort(),
      "a guard started walking through listSourceFiles without a planted-offender case",
    );
  });

  it("names the bundle scan's base in the report, since its walk is dist-relative", () => {
    // `check-bundle-secrets` is the one guard whose walk is NOT rooted at the
    // repository, and it is the reason this suite exists. Running it needs a
    // real `dist/` and the bundle premise refuses without one, so the property
    // is asserted at the source instead: whatever the walk returns, the
    // reported path is joined back under `dist/`.
    const source = readRepoFile("scripts/check-bundle-secrets.ts");
    assert.match(
      source,
      /listFilesUnder\(DIST_DIR, \{\s*extensions: BUNDLE_SCAN_EXTENSIONS,\s*skipDirs: BUNDLE_SKIP_DIRS,\s*\}\)/,
    );
    assert.match(source, /scanForSecrets\(path\.join\("dist", file\), source\)/);
    assert.match(source, /readFileSync\(path\.join\(DIST_DIR, file\), "utf8"\)/);
  });

  it("keeps check-secrets' report repo-relative, which is what its own skip list is written in", () => {
    // Two things read the same string here: the report, and `SKIP_FILES`,
    // which is written in repo-relative paths. A walk whose base moved would
    // break the skip list silently — the matcher's own fixtures would start
    // being scanned and reported as findings — so the two are pinned together
    // rather than one at a time.
    const source = readRepoFile("scripts/check-secrets.ts");
    assert.match(source, /listFilesUnder\(repoRoot, \{/);
    assert.match(source, /SKIP_FILES\.has\(path\.normalize\(rel\)\)/);
    assert.match(source, /readFileSync\(path\.join\(repoRoot, rel\), "utf8"\)/);
    assert.match(source, /scanForSecrets\(rel, source\)/);
  });
});
