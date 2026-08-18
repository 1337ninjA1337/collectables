import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/env-inlining";

import {
  edgeFunctionPath,
  edgeFunctionRel,
  readEdgeFunction,
} from "./helpers/edge-function-source";
import { REPO_ROOT, readRepoFile, repoPath } from "./helpers/repo-file";

/**
 * One statement of `supabase/functions/<name>/index.ts`.
 *
 * Three adoption suites — `assert-caller`, `cors-shared`, `service-role-claim`
 * — iterate over a list of function NAMES and open each entry point, and each
 * had written its own `fnSource(name)` for it. Two copies is not a problem;
 * two copies is how the hundred and fourteen inline repo reads started, and
 * the layout is exactly the kind of fact that has one true value and gets
 * spelled once per suite until someone counts.
 *
 * The sweep below is over the suite directory rather than a list, and carries
 * a floor, for the same reason the repo-file one does: a walk that finds no
 * offenders and a walk that is broken look identical from here.
 */

const TESTS_DIR = repoPath("__tests__");
/** The one file allowed to render the layout, and this suite, which quotes it. */
const ALLOWED_TO_SPELL_THE_LAYOUT: readonly string[] = [
  path.join("helpers", "edge-function-source.ts"),
  "edge-function-source-helper.test.ts",
];

/** Every `.ts` under `__tests__`, one level of subdirectory included. */
function suiteFiles(): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(TESTS_DIR)) {
    const full = path.join(TESTS_DIR, entry);
    if (statSync(full).isDirectory()) {
      for (const nested of readdirSync(full)) {
        if (nested.endsWith(".ts")) found.push(path.join(entry, nested));
      }
      continue;
    }
    if (entry.endsWith(".ts")) found.push(entry);
  }
  return found;
}

const code = (relative: string): string =>
  stripComments(readRepoFile("__tests__", relative)).replace(/\s+/g, " ");

describe("an Edge Function's source, by name", () => {
  it("renders the layout every function in the repo actually uses", () => {
    assert.equal(edgeFunctionRel("delete-account"), "supabase/functions/delete-account/index.ts");
    assert.equal(edgeFunctionPath("delete-account"), repoPath("supabase/functions/delete-account/index.ts"));
    assert.ok(edgeFunctionPath("delete-account").startsWith(REPO_ROOT));
  });

  it("reads a real function, and every name the adoption suites list", () => {
    assert.match(readEdgeFunction("delete-account"), /serve\(|Deno\.serve/);
    // The layout is a claim about the tree, so check it against the tree
    // rather than against one example: every directory under
    // `supabase/functions` that is not the `_shared` module folder is a
    // function, and each has to be readable through the helper.
    const names = readdirSync(repoPath("supabase", "functions"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name);
    assert.ok(names.length >= 5, `only ${names.length} Edge Functions found`);
    for (const name of names) {
      assert.ok(
        readEdgeFunction(name).length > 0,
        `${name} is a function directory the layout does not reach`,
      );
    }
  });

  it("throws on a name with no function behind it", () => {
    // The failure mode worth avoiding is an adoption list that still names a
    // renamed function and silently checks nothing.
    assert.throws(() => readEdgeFunction("no-such-function"), /ENOENT/);
  });

  it("leaves no suite rendering the layout for itself", () => {
    // Matches the layout being BUILT from a name — a template literal, or a
    // join whose third segment is an identifier rather than a quoted string.
    // A suite naming one function outright (`readRepoFile("supabase/functions/
    // sign-upload/index.ts")`) is not this: it states one path once, which is
    // what every other single-file suite in here does. What this catches is
    // the `fnSource(name)` habit coming back, which is the one that was
    // already at three copies.
    const offenders = suiteFiles().filter((relative) => {
      if (ALLOWED_TO_SPELL_THE_LAYOUT.includes(relative)) return false;
      return /supabase\/functions\/\$\{|"supabase", "functions", [a-z]/.test(code(relative));
    });
    assert.deepEqual(
      offenders,
      [],
      `these suites build a function path from a name instead of calling readEdgeFunction: ${offenders.join(", ")}`,
    );
  });

  it("has enough suites in the walk that the sweep is not scanning an empty room", () => {
    const files = suiteFiles();
    assert.ok(files.length > 200, `only ${files.length} suite files walked`);
    for (const allowed of ALLOWED_TO_SPELL_THE_LAYOUT) {
      assert.ok(files.includes(allowed), `exempted file ${allowed} is not in the walk`);
    }
  });
});
