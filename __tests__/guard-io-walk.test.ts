import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MARKUP_EXTENSIONS,
  NEVER_WALKED,
  NEVER_WALKED_REASONS,
  NON_APP_TS_DIRS,
  outsideSourceTree,
  SOURCE_DIRS,
  SOURCE_EXTENSIONS,
} from "@/lib/source-dirs";
import { SECRET_SKIP_DIRS } from "@/lib/secret-scan";

import { readRepoFile, REPO_ROOT } from "./helpers/repo-file";
import { sourceFiles, tsxFiles } from "./helpers/source-files";
import { listFilesUnder, listSourceFiles } from "../scripts/guard-io";

/**
 * `scripts/guard-io.ts`'s two walks, against a tree built for the purpose.
 *
 * Seven guards had each written a recursive `readdirSync` out, and the copies
 * differed on four things nobody chose — the extension test, whether a
 * non-directory counted as a file, whether the caller or the walk sorted, and
 * whether an unreadable directory returned nothing or threw. Those differences
 * agreed on every tree this repository has ever had, which is exactly why they
 * were free to keep drifting: nothing distinguished them, so nothing could go
 * red when one of them was wrong.
 *
 * The fixture below is a tree where they do NOT agree — a symlink, a directory
 * whose name ends in `.ts`, a nested skip directory, a file with no extension —
 * so each decision is a case rather than a coincidence.
 */

/** A throwaway tree under `mkdtemp`, in the shape the differences show up in. */
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "guard-io-walk-"));
  mkdirSync(path.join(root, "app", "collection"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(path.join(root, "app", "node_modules", "pkg"), { recursive: true });
  mkdirSync(path.join(root, "app", "weird.ts"), { recursive: true });
  writeFileSync(path.join(root, "app", "index.tsx"), "x");
  writeFileSync(path.join(root, "app", "helpers.ts"), "x");
  writeFileSync(path.join(root, "app", "notes.md"), "x");
  writeFileSync(path.join(root, "app", "LICENSE"), "x");
  writeFileSync(path.join(root, "app", "collection", "[id].tsx"), "x");
  writeFileSync(path.join(root, "app", "weird.ts", "inner.ts"), "x");
  writeFileSync(path.join(root, "node_modules", "pkg", "index.ts"), "x");
  writeFileSync(path.join(root, "app", "node_modules", "pkg", "index.ts"), "x");
  return root;
}

describe("listFilesUnder", () => {
  it("recurses, filters by extension, and sorts — relative to the root it was given", () => {
    const root = fixture();
    try {
      assert.deepEqual(listFilesUnder(path.join(root, "app"), { extensions: SOURCE_EXTENSIONS }), [
        "collection/[id].tsx",
        "helpers.ts",
        "index.tsx",
        // Walked, because nothing told this call to skip it: `listFilesUnder`
        // descends into everything and `skipDirs` is the caller's decision.
        // `listSourceFiles` is the one that passes NEVER_WALKED.
        "node_modules/pkg/index.ts",
        "weird.ts/inner.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats a directory named `foo.ts` as a directory, not a source file", () => {
    // `entry.isFile()` rather than "not a directory", which two of the seven
    // copies had. The tree here has never held one; a `dist.ts/` or an
    // `assets.json/` is one `mkdir` away.
    const root = fixture();
    try {
      const found = listFilesUnder(path.join(root, "app"), { extensions: SOURCE_EXTENSIONS });
      assert.ok(!found.includes("weird.ts"), "a directory was returned as a file");
      assert.ok(found.includes("weird.ts/inner.ts"), "the directory was not walked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a directory by NAME, wherever it appears", () => {
    const root = fixture();
    try {
      const found = listFilesUnder(root, {
        extensions: SOURCE_EXTENSIONS,
        skipDirs: ["node_modules"],
      });
      assert.ok(!found.some((f) => f.includes("node_modules")));
      assert.ok(found.includes("app/index.tsx"));
      // Without the skip list it IS walked, so the case above is about the
      // option rather than about the fixture happening to be empty.
      const unskipped = listFilesUnder(root, { extensions: SOURCE_EXTENSIONS });
      assert.ok(unskipped.includes("node_modules/pkg/index.ts"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores a file with no extension, and one whose extension is not asked for", () => {
    const root = fixture();
    try {
      const found = listFilesUnder(path.join(root, "app"), { extensions: SOURCE_EXTENSIONS });
      assert.ok(!found.includes("LICENSE"));
      assert.ok(!found.includes("notes.md"));
      assert.deepEqual(listFilesUnder(path.join(root, "app"), { extensions: [".md"] }), [
        "notes.md",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("folds case before the extension test, and matches everything when asked for nothing", () => {
    // A stray `MANUAL-TASKS.MD` sat at the root of this repository outside the
    // secret scan for as long as it existed: `path.extname` answers `.MD` and
    // the scan's set is written in lower case, so the file with the manual DB
    // steps in it was the one text file at the root nothing read.
    const root = fixture();
    try {
      writeFileSync(path.join(root, "app", "NOTES.MD"), "x");
      writeFileSync(path.join(root, "app", "SCREEN.TSX"), "x");
      assert.deepEqual(listFilesUnder(path.join(root, "app"), { extensions: [".md"] }), [
        "NOTES.MD",
        "notes.md",
      ]);
      assert.ok(
        listFilesUnder(path.join(root, "app"), { extensions: MARKUP_EXTENSIONS }).includes(
          "SCREEN.TSX",
        ),
      );
      // No extension list at all is every file, which is what the census in
      // `secret-scan.test.ts` asks for — an absent filter says "all of them"
      // more clearly than a list that has to be kept exhaustive.
      const everything = listFilesUnder(path.join(root, "app"), {});
      assert.ok(everything.includes("LICENSE"), "a file with no extension was dropped");
      assert.ok(everything.includes("notes.md"));
      assert.ok(everything.includes("index.tsx"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not return a symlink as a source file", () => {
    // A symlink is neither `isFile()` nor `isDirectory()` to `readdirSync`'s
    // dirents, so it falls out — which is the answer a secret scanner wants:
    // the target is walked on its own if it is in the tree, and reading it
    // through the link as well would report the same finding twice. Two of the
    // seven retired copies took "not a directory" and would have returned it.
    const root = fixture();
    try {
      symlinkSync(path.join(root, "app", "helpers.ts"), path.join(root, "app", "linked.ts"));
    } catch {
      // Creating one needs a privilege this environment may not have. Bail
      // rather than assert something else, so the case never passes for a
      // reason that has nothing to do with the walk.
      rmSync(root, { recursive: true, force: true });
      return;
    }
    try {
      const found = listFilesUnder(path.join(root, "app"), { extensions: SOURCE_EXTENSIONS });
      assert.ok(found.includes("helpers.ts"), "the link's target should still be walked");
      assert.ok(!found.includes("linked.ts"), "the symlink was returned as a file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns nothing for a root that is not there, rather than throwing", () => {
    // The property `listDirEntries` exists for: a guard pointed at a tree that
    // does not hold what it walks reports a count of zero, and the scanned
    // floor is what refuses it — in the guard's own words, not as an ENOENT
    // stack naming `fs.readdirSync`.
    assert.deepEqual(
      listFilesUnder(path.join(tmpdir(), "guard-io-walk-does-not-exist"), {
        extensions: SOURCE_EXTENSIONS,
      }),
      [],
    );
  });
});

describe("listSourceFiles", () => {
  it("prefixes each directory back on, and sorts across all of them", () => {
    const found = listSourceFiles(REPO_ROOT, ["app", "components"]);
    assert.ok(found.includes("app/collection/[id].tsx"));
    assert.ok(found.includes("components/item-card.tsx"));
    assert.deepEqual([...found].sort(), found, "the combined walk is not sorted");
    assert.equal(new Set(found).size, found.length);
  });

  it("takes both source extensions by default and narrows on request", () => {
    const all = listSourceFiles(REPO_ROOT, ["components"]);
    const markup = listSourceFiles(REPO_ROOT, ["components"], MARKUP_EXTENSIONS);
    assert.ok(markup.length < all.length, "components/ holds no .ts, so the narrowing proves nothing");
    assert.ok(markup.every((f) => f.endsWith(".tsx")));
    assert.ok(all.some((f) => f.endsWith(".ts")));
  });

  it("skips the never-walked names, so a stray install cannot flood a scan", () => {
    // The list is shared with the suite-side walk rather than restated, which
    // is what lets the agreement case below be a check rather than a
    // coincidence. `node_modules` under `components/` is one `npm install`
    // away and would turn a 64-file scan into a several-thousand-file one.
    const root = fixture();
    try {
      assert.ok(NEVER_WALKED.includes("node_modules"));
      const found = listSourceFiles(root, ["app"]);
      assert.ok(found.includes("app/index.tsx"), "the scan root itself was not walked");
      assert.ok(
        !found.some((f) => f.includes("node_modules")),
        `the shared source walk descended into a nested node_modules: ${found.join(", ")}`,
      );
      // The skip is about a directory FOUND during the walk, not about the
      // roots a caller names: asking to walk `node_modules` walks it, because
      // a caller that names it has said what it means.
      assert.deepEqual(listSourceFiles(root, ["node_modules"]), ["node_modules/pkg/index.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("agrees with the suite-side walk over every source directory, in both extension sets", () => {
    // Two walks over one tree is the drift this consolidation removed one
    // level up; they are still two implementations, because the guards cannot
    // import from `__tests__/`. This is what says they answer the same.
    //
    // Parameterised over the five directories and both extension sets rather
    // than run once over `app`/`components`/`lib` with the defaults: that was
    // the one configuration both are used in, so a disagreement reached
    // through `MARKUP_EXTENSIONS` or over `scripts/` had nothing looking at
    // it. The loop is the case that justifies keeping two implementations.
    let markupSeen = 0;
    for (const dir of SOURCE_DIRS) {
      const guardSide = listSourceFiles(REPO_ROOT, [dir]);
      assert.ok(guardSide.length > 0, `${dir} walked to nothing — the comparison below proves nothing`);
      assert.deepEqual(guardSide, [...sourceFiles(dir)], `the two walks disagree over ${dir}`);

      const guardMarkup = listSourceFiles(REPO_ROOT, [dir], MARKUP_EXTENSIONS);
      // `data/` and `scripts/` hold no markup, and that is the right answer
      // rather than a hole — the union below is what has to be non-empty.
      assert.deepEqual(
        guardMarkup,
        [...tsxFiles(dir)],
        `the two walks disagree over ${dir} under MARKUP_EXTENSIONS`,
      );
      markupSeen += guardMarkup.length;
    }
    assert.ok(markupSeen > 0, "no .tsx was walked at all — the markup comparisons were vacuous");

    // And over all five at once, which is what every caller of either actually
    // asks for: a per-directory agreement plus a combined sort disagreement
    // would still be a disagreement.
    assert.deepEqual(listSourceFiles(REPO_ROOT, SOURCE_DIRS), [...sourceFiles()]);
  });
});

describe("what a walk never descends into", () => {
  it("gives every never-walked name a reason of its own", () => {
    // The list was three names under one sentence; a fourth would have
    // arrived with none, which is how a skip list stops being reviewable.
    assert.deepEqual(NEVER_WALKED, Object.keys(NEVER_WALKED_REASONS));
    assert.ok(NEVER_WALKED.includes("node_modules"));
    for (const name of NEVER_WALKED) {
      const reason = NEVER_WALKED_REASONS[name];
      assert.ok(
        reason !== undefined && reason.length >= 30,
        `${name} is skipped for a reason shorter than a reason: ${JSON.stringify(reason)}`,
      );
    }
  });

  it("never skips a directory that holds source", () => {
    // The failure this list can cause is silent in both walks and in the
    // secret scan: a source directory in either one reads as "no offenders".
    for (const dir of [...SOURCE_DIRS, ...NON_APP_TS_DIRS]) {
      assert.ok(!NEVER_WALKED.includes(dir), `NEVER_WALKED holds the source directory ${dir}`);
      assert.ok(
        !SECRET_SKIP_DIRS.includes(dir),
        `check-secrets skips ${dir} — a credential committed there would never be seen`,
      );
    }
  });

  it("names the root-level rule instead of leaving half of it inline", () => {
    // Two mechanisms for one question: the shared list, and a dot prefix that
    // used to be written into the root walk unnamed. Both still apply and they
    // are different rules — the dot one is about tooling directories at the
    // root and deliberately stops there.
    assert.ok(outsideSourceTree("node_modules"));
    assert.ok(outsideSourceTree(".github"), "a tooling directory at the root is not source");
    assert.ok(outsideSourceTree(".expo"), "covered by both rules, which is deliberate");
    for (const dir of [...SOURCE_DIRS, ...NON_APP_TS_DIRS]) {
      assert.ok(!outsideSourceTree(dir), `${dir} was read as outside the source tree`);
    }
    // The rule is said once now: the root walk takes the predicate rather than
    // spelling `startsWith(".")` out beside the list.
    const helper = readRepoFile("__tests__/helpers/source-files.ts");
    assert.match(helper, /outsideSourceTree\(entry\.name\)/);
    assert.doesNotMatch(helper, /entry\.name\.startsWith\("\."\)/);
  });
});

describe("the two widest walks say what they skip", () => {
  /**
   * `check-secrets` and `check-bundle-secrets` are the guards with the largest
   * blast radius — the whole repository across fourteen text extensions, and
   * `dist/` across five artifact ones — and were the two with no check on what
   * they cover, because `SOURCE_DIRS` is not the list they narrow.
   */
  it("check-secrets skips the shared rule plus three names of its own", () => {
    // Compared by VALUE, not by matching the guard's source: the list moved to
    // `lib/secret-scan.ts` — the pure half a suite can import — because the
    // wrapper runs `main()` at import and a regex over its text was the only
    // check available. The spread is the point: three entries are the shared
    // "never holds source" rule and three are this scan's own, which six
    // names in one literal could not say.
    assert.deepEqual(SECRET_SKIP_DIRS, [...NEVER_WALKED, ".git", "coverage", "web-build"]);
    // And the wrapper still passes it to the walk — a shared constant nothing
    // reaches is a list that agrees with itself.
    assert.match(readRepoFile("scripts/check-secrets.ts"), /skipDirs: SECRET_SKIP_DIRS/);
  });

  it("both secret guards route through the shared walk", () => {
    for (const guard of ["check-secrets", "check-bundle-secrets"]) {
      const source = readRepoFile("scripts", `${guard}.ts`);
      assert.match(source, /\blistFilesUnder\(/, `${guard} does not call the shared walk`);
      assert.doesNotMatch(
        source,
        /\breaddirSync\b/,
        `${guard} still walks a directory itself — including its own try/catch, which is the silent-pass hazard listDirEntries holds in one place`,
      );
    }
  });

  it("keeps the file-level skips out of the walk", () => {
    // `SKIP_FILES` names the matcher's own fixtures, which is a rule about
    // FILES; applying it after the walk keeps the walk about directories and
    // extensions, and keeps a second rule from hiding inside a recursion.
    const source = readRepoFile("scripts/check-secrets.ts");
    assert.match(source, /listFilesUnder\(repoRoot, \{[\s\S]*?\}\)\.filter\(/);
    assert.match(source, /SKIP_FILES\.has\(path\.normalize\(rel\)\)/);
  });
});
