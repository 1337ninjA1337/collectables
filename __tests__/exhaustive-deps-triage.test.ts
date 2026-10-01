/**
 * The 13 `react-hooks/exhaustive-deps` findings, held to the tree.
 *
 * A triage is a set of sentences about code, and the way it rots is that the
 * code moves and the sentences do not: a verdict about a line that is no
 * longer there reads exactly like a verdict about a line that is. So every
 * entry names a line and this suite finds it, the same shape
 * `set-state-in-effect-triage.test.ts` established one rule over.
 *
 * The two fixes are pinned here as well as described there, because "fixed"
 * is the one verdict that can be undone by an edit that looks like a tidy-up:
 * a dependency array is exactly the kind of list somebody shortens.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXHAUSTIVE_DEPS_ENTRIES,
  EXHAUSTIVE_DEPS_SITES,
  EXHAUSTIVE_DEPS_TOTAL,
  triageProblems,
  verdictCounts,
} from "@/lib/exhaustive-deps-triage";

import { readRepoFile } from "./helpers/repo-file";

describe("the triage describes code that is there", () => {
  it("finds every registered anchor in the file it names", () => {
    assert.deepEqual(triageProblems(readRepoFile), []);
  });

  it("gives every entry a sentence rather than a shrug", () => {
    for (const site of EXHAUSTIVE_DEPS_SITES) {
      assert.ok(site.why.length > 60, `${site.file} ${site.dependency}: ${site.why}`);
      assert.ok(site.dependency.length > 0, `${site.file} names no dependency`);
    }
  });

  it("counts eleven entries for thirteen findings, and says where the two go", () => {
    // render-harness spells one fixture three times — a single failure,
    // several together, a nested tree — and three copies of one fixture is
    // one decision. The arithmetic is written down so the day somebody adds a
    // twelfth entry they have to say which of the two numbers moved.
    assert.equal(EXHAUSTIVE_DEPS_SITES.length, EXHAUSTIVE_DEPS_ENTRIES);
    assert.equal(EXHAUSTIVE_DEPS_TOTAL - EXHAUSTIVE_DEPS_ENTRIES, 2);
  });

  it("reports an entry whose line has gone, which is how it stays honest", () => {
    const problems = triageProblems((file) =>
      file === "lib/use-transition-event.ts" ? "export function nothing() {}" : readRepoFile(file),
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0].file, "lib/use-transition-event.ts");
    assert.match(problems[0].message, /describes code that has been edited or removed/);
  });
});

describe("the verdicts", () => {
  it("is eight keep, two fixed and one open", () => {
    assert.deepEqual(verdictCounts(), { keep: 8, fixed: 2, open: 1 });
  });

  it("pins the reorder fix, which is the bug this reading found", () => {
    // `toggleReorderMode` is a useCallback over five names and the header
    // memo held two of them. Sort by price, press Reorder, and the early
    // return ran against the sort the header was built with.
    const screen = readRepoFile("app/collection/[id].tsx");
    const header = screen.slice(screen.indexOf("const pageHeader = useMemo("));
    const deps = header.slice(header.indexOf("}, ["), header.indexOf("]);") + 3);
    assert.match(deps, /\btoggleReorderMode\b/, "the header memo stopped depending on the callback it renders");
  });

  it("pins the translator fix, which is the quieter one", () => {
    const provider = readRepoFile("lib/social-context.tsx");
    const deps = provider.slice(provider.indexOf("[ensureProfilesLoaded"));
    assert.match(deps.slice(0, deps.indexOf("]")), /\bt\b/, "the social value factory stopped depending on t");
  });

  it("leaves the one open verdict open, and says what the decision is", () => {
    const open = EXHAUSTIVE_DEPS_SITES.filter((site) => site.verdict === "open");
    assert.equal(open.length, 1);
    assert.equal(open[0].file, "lib/social-context.tsx");
    assert.match(open[0].why, /sync-traffic decision/);
  });
});
