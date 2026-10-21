/**
 * The fourth reader, refused.
 *
 * `fetchProfiles` and `searchProfiles` answer with the `profiles` table's rows.
 * The admin tombstone — `deletedProfileIds`, written by `deleteProfile` — lives
 * in `SocialProvider`'s state, so unlike the hidden-username list one module
 * over it CANNOT be applied inside the fetch: every direct reader has to ask.
 * On 2026-10-21 there were three readers and all three had forgotten, so a
 * profile an admin deleted was in the people browser, in the search sheet, and
 * one tap from a full profile screen.
 *
 * WHAT MAKES IT WORTH A GUARD rather than three fixed call sites: nothing at
 * the call site says a decision was skipped. The rows come back typed and
 * complete, the types cannot carry "visible to this viewer", and a review diff
 * of a new screen shows a fetch that looks exactly like the two correct ones.
 *
 * THE INTERESTING CASES ARE THE NEGATIVES, as in `check-latest-ref.test.ts`:
 * five modules discuss these two functions in prose, `fetchProfileById` is
 * deliberately not a subject, and a file that imports neither reader is not
 * being let off — it was never asked.
 *
 * Fixtures are spelled out: this file is in `__tests__/`, the one source root
 * the guard deliberately does not walk, for exactly this reason.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILES_MODULE,
  PROFILE_LIST_READERS,
  VISIBILITY_PREDICATE,
  consultsProfileVisibility,
  findProfileVisibilityRisks,
  formatProfileVisibilityReport,
  profileListReaderImport,
  profileVisibilityAnnotations,
} from "@/lib/check-profile-visibility";
import { isAnnotationLine } from "@/lib/github-annotations";
import { LINT_GUARDS } from "@/lib/lint-guards";
import { SCANNED_FLOORS } from "@/lib/scanned-floor";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/** A screen that lists the rows and asks nothing — the shape the rule is for. */
const OFFENDER = [
  'import { fetchProfiles } from "@/lib/supabase-profiles";',
  "",
  "export default function Screen() {",
  "  const rows = use(fetchProfiles(1, 25));",
  "  return rows.length;",
  "}",
].join("\n");

describe("what the rule catches", () => {
  it("catches a list reader with no visibility decision in the file", () => {
    const found = findProfileVisibilityRisks("app/screen.tsx", OFFENDER);
    assert.deepEqual(found, [
      { file: "app/screen.tsx", line: 1, readers: ["fetchProfiles"] },
    ]);
  });

  it("catches the search reader too, and names both when both are imported", () => {
    const both = [
      'import { fetchProfiles, searchProfiles } from "@/lib/supabase-profiles";',
      "export const rows = [];",
    ].join("\n");
    assert.deepEqual(findProfileVisibilityRisks("app/screen.tsx", both)[0].readers, [
      "fetchProfiles",
      "searchProfiles",
    ]);
    const search = 'import { searchProfiles } from "@/lib/supabase-profiles";\n';
    assert.deepEqual(findProfileVisibilityRisks("app/s.tsx", search)[0].readers, ["searchProfiles"]);
  });

  it("reads an import whose braces are wrapped over several lines", () => {
    // The real sheet's import is wrapped, and a line-at-a-time scan would
    // report the file this rule's two subjects are.
    const wrapped = [
      "import {",
      "  fetchProfiles,",
      "  searchProfiles,",
      '} from "@/lib/supabase-profiles";',
      "export const rows = [];",
    ].join("\n");
    const found = findProfileVisibilityRisks("components/sheet.tsx", wrapped);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 1, "the import's own line, not the one the brace closed on");
  });

  it("is not satisfied by the predicate's name in a comment", () => {
    // The direction that matters more than the other: a file could otherwise
    // pass by DISCUSSING the decision it skipped.
    const commented = [
      'import { fetchProfiles } from "@/lib/supabase-profiles";',
      "// Rows are filtered elsewhere, see isProfileDeleted.",
      "export const rows = [];",
    ].join("\n");
    assert.equal(consultsProfileVisibility(commented), false);
    assert.equal(findProfileVisibilityRisks("app/s.tsx", commented).length, 1);
  });
});

describe("what the rule must not say", () => {
  it("passes a reader that consults the predicate", () => {
    const fixed = [
      'import { fetchProfiles } from "@/lib/supabase-profiles";',
      "export default function Screen() {",
      "  const { isProfileDeleted } = useSocial();",
      "  const rows = use(fetchProfiles(1, 25)).filter((p) => !isProfileDeleted(p.id));",
      "  return rows.length;",
      "}",
    ].join("\n");
    assert.deepEqual(findProfileVisibilityRisks("app/screen.tsx", fixed), []);
  });

  it("asks nothing of a file that only talks about the readers", () => {
    // Five modules do: the debounce delay's header, the search needle's, the
    // hook's, and both providers' prose. A rule reading those as imports would
    // report files that call neither function.
    const prose = [
      "/** Delay for the profile search that hits Supabase (`searchProfiles`). */",
      "export const PROFILE_SEARCH_DEBOUNCE_MS = 300;",
    ].join("\n");
    assert.equal(profileListReaderImport(prose), null);
    assert.deepEqual(findProfileVisibilityRisks("lib/debounce-helpers.ts", prose), []);
  });

  it("asks nothing of fetchProfileById, which is not a list of other people", () => {
    // `lib/social-context.tsx` owns the tombstone and gates its own by-id
    // answer; `lib/collections-context.tsx` reads the SIGNED-IN user's row, and
    // `deleteProfile` refuses to tombstone the current user. Demanding a filter
    // there is demanding one against a profile that cannot be in the list.
    const byId = [
      'import { fetchProfileById } from "@/lib/supabase-profiles";',
      "export const mine = () => fetchProfileById(user.id);",
    ].join("\n");
    assert.equal(profileListReaderImport(byId), null);
    assert.deepEqual(findProfileVisibilityRisks("lib/collections-context.tsx", byId), []);
  });

  it("asks nothing of an import from another module that happens to share a name", () => {
    const elsewhere = 'import { fetchProfiles } from "@/lib/some-other-module";\n';
    assert.equal(profileListReaderImport(elsewhere), null);
  });
});

describe("what a failure says", () => {
  const found = findProfileVisibilityRisks("app/screen.tsx", OFFENDER);

  it("names the file, the line, the readers and the fix", () => {
    const report = formatProfileVisibilityReport(found);
    assert.match(report, /app\/screen\.tsx:1/);
    assert.match(report, /fetchProfiles/);
    assert.match(report, new RegExp(VISIBILITY_PREDICATE));
    assert.match(report, /useSocial\(\)/, "a report that names no fix is a complaint");
  });

  it("says nothing at all when there is nothing to say", () => {
    assert.equal(formatProfileVisibilityReport([]), "");
    assert.deepEqual(profileVisibilityAnnotations([]), []);
  });

  it("annotates each finding in the format Actions parses", () => {
    const lines = profileVisibilityAnnotations(found);
    assert.equal(lines.length, 1);
    for (const line of lines) assert.ok(isAnnotationLine(line), line);
    assert.match(lines[0], /line=1/);
  });
});

describe("the guard is wired in, and the tree is clean", () => {
  it("is a LINT_GUARDS entry pointing at its own wrapper", () => {
    const guard = LINT_GUARDS.find((g) => g.npmScript === "lint:profile-visibility");
    assert.ok(guard, "lint:profile-visibility must be in the registry so lint:all runs it");
    assert.equal(guard.scriptPath, "scripts/check-profile-visibility.ts");
  });

  it("declares a scanned floor over the roots its wrapper walks", () => {
    const floor = SCANNED_FLOORS["check-profile-visibility"];
    assert.ok(floor?.count, "a walk with no floor proves its negative over any tree");
    assert.deepEqual(floor.count.roots, ["app", "components", "lib"]);
    assert.match(
      readRepoFile("scripts/check-profile-visibility.ts"),
      /const SCANNED_DIRS = \["app", "components", "lib"\] as const;/,
    );
  });

  it("floors its own subject, because the healthy state is zero findings", () => {
    // Zero findings is also what a renamed reader looks like from in here, and
    // the two are indistinguishable without counting the imports.
    assert.match(readRepoFile("scripts/check-profile-visibility.ts"), /const IMPORT_FLOOR = 1;/);
  });

  it("finds nothing in the tree it guards, and still has a subject in it", () => {
    const files = sourceFiles("app", "components", "lib");
    const offenders = files.flatMap((file) =>
      findProfileVisibilityRisks(file, readRepoFile(file)),
    );
    assert.deepEqual(
      offenders.map((f) => `${f.file}:${f.line}`),
      [],
      `these must filter their rows with ${VISIBILITY_PREDICATE} from useSocial()`,
    );
    const subjects = files.filter((file) => profileListReaderImport(readRepoFile(file)));
    assert.deepEqual(
      subjects,
      ["app/people.tsx", "components/search-overlay.tsx"],
      "the rule's subject moved — re-read it before trusting the clean run",
    );
  });

  it("names the module and the readers once, where both halves read them", () => {
    // The rule, the wrapper and this suite all speak about the same two
    // functions; three spellings is how a rename leaves a guard matching
    // nothing and reporting nothing.
    assert.equal(PROFILES_MODULE, "@/lib/supabase-profiles");
    assert.deepEqual([...PROFILE_LIST_READERS], ["fetchProfiles", "searchProfiles"]);
    assert.match(
      readRepoFile("scripts/check-profile-visibility.ts"),
      /PROFILE_LIST_READERS\.join\(" or "\)/,
      "the lost-subject message writes the names out instead of reading them",
    );
  });

  it("does not attempt the half it cannot decide", () => {
    // A mention is not a proof: a file could consult the predicate for one
    // half of a union and not the other, which is what both surfaces did with
    // "not me" before they shared one predicate. Following rows from a fetch
    // into a render is not a question about text, and the per-surface claims
    // in social-context-wiring.test.ts are where that half lives.
    const rule = readRepoFile("lib/check-profile-visibility.ts");
    assert.match(rule, /WHAT COUNTS AS PASSING, and why it is this weak/);
    assert.match(readRepoFile("__tests__/social-context-wiring.test.ts"), /isProfileDeleted/);
  });
});
