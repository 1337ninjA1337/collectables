import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { measuredFloor } from "./helpers/coverage-floor";
import { sourceFiles } from "./helpers/source-files";
import { suiteCode, suiteFiles } from "./helpers/suite-files";

/**
 * The modules no suite in this tree so much as names.
 *
 * WHAT THIS IS ABOUT. `lib/export-pdf.ts` had never been run by a case, and the
 * reason was not a decision: it imports `expo-print`, `expo-sharing` and
 * `react-native`, so no node suite could load it, and the half worth checking —
 * escaping, totals, which fields an item prints — sat behind those imports. It
 * was found by a walk somebody ran once in a session, which is the same place
 * every census in this repository starts and the same place three of them
 * stopped until a case was written.
 *
 * A MENTION IS NOT A TEST, and this walk knows it. `import { x } from
 * "@/lib/y"` and the string `"y"` in a comment read identically here, so a
 * module this walk calls covered may be named by a suite that never calls it.
 * What the walk can say is the other direction, and that is the half worth
 * pinning: a module NO suite names is certainly untested, and today there are
 * five of them.
 *
 * WHY THEY ARE PINNED RATHER THAN FIXED. All five are hooks or components, so
 * the split that freed the export document — pure half into a module a node
 * test can load — does not apply as written. What they need is a render
 * harness, which is a different piece of work and a decision about which of
 * them is worth one. Naming them means a SIXTH arrives as a red run with a
 * path, rather than as a discovery in whichever session next runs the walk.
 */

/** Modules with no suite that names them, and why each one is still here. */
const UNREFERENCED: Readonly<Record<string, string>> = {
  "components/DraggableList.tsx": "a native drag list; needs a render harness",
  "components/DraggableList.web.tsx": "its web twin, same",
  "lib/nav-animation-context.tsx": "a provider whose value is an Animated ref",
  "lib/use-reactions.ts": "a hook over the reaction bar's state",
  "lib/use-visibility-refresh.ts": "a hook over AppState/visibility events",
};

/**
 * This suite, which does not count as a mention.
 *
 * It names all five paths in order to pin them, so reading itself would report
 * every one of them as covered — the census would answer "nothing is
 * unreferenced" the moment it was written, which is exactly what it did on the
 * first run. A suite that lists modules is not a suite that tests them.
 */
const THIS_SUITE = "unreferenced-modules.test.ts";

/** The stem a suite would have to write to name this module at all. */
function moduleStem(relative: string): string {
  return relative.replace(/^.*\//, "").replace(/\.tsx?$/, "");
}

describe("every product module is named by some suite", () => {
  const corpus = suiteFiles()
    .filter((relative) => relative !== THIS_SUITE)
    .map((relative) => suiteCode(relative))
    .join("\n");
  const modules = sourceFiles("lib", "components");
  const unreferenced = modules.filter((relative) => !corpus.includes(moduleStem(relative)));

  it("walks a tree and a suite corpus that are both really there", () => {
    // Both halves can go empty and both failures look like a pass: no modules
    // means nothing to check, and an empty corpus means every module is
    // unreferenced — which would fail the case below for the wrong reason.
    assert.ok(modules.length >= 100, measuredFloor(modules.length, 100, "product module(s) walked"));
    assert.ok(
      corpus.includes("buildCollectionExportHtml"),
      "the suite corpus does not contain a symbol a suite is known to name, so it was not read",
    );
  });

  it("names the five that no suite mentions, and no others", () => {
    assert.deepEqual(
      unreferenced,
      Object.keys(UNREFERENCED).sort(),
      "the set of modules no suite names has changed — a new one is a module nothing can be checking, and one that has gone means a suite now names it and this list should lose the entry",
    );
  });

  it("does not call a module unreferenced while a suite names it", () => {
    // The anti-vacuous half: a walk that read nothing would report every module
    // as unreferenced, and a walk that matched everything would report none.
    // Two modules with suites of their own, one of them named only through an
    // import path rather than by a symbol.
    for (const covered of ["lib/plural.ts", "lib/export-pdf-html.ts"]) {
      assert.ok(
        modules.includes(covered),
        `\`${covered}\` is not in the walk, so this case is asking about nothing`,
      );
      assert.ok(
        !unreferenced.includes(covered),
        `\`${covered}\` has a suite and the walk still reads it as unreferenced`,
      );
    }
  });
});
