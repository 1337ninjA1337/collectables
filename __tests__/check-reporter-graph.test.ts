/**
 * The guard over the modules node loads for itself.
 *
 * `npm test` points node's test runner at `scripts/test-failure-reporter.ts`,
 * and node imports a custom reporter through its DEFAULT loader — tsx's hooks
 * are never consulted. That puts the reporter and its whole import graph under
 * two rules the rest of the repository does not live by: every repo-local
 * import names its `.ts` extension (native stripping infers none), and every
 * file in the graph is erasable (no `enum`, no `namespace`, no parameter
 * property). Break either and the run dies at LINK TIME, before a single suite
 * starts — which is why the suite next door cannot be the thing that catches
 * it, and why this is a `lint:all` guard instead.
 *
 * The trap is real rather than theoretical: `lib/thrown-value.ts` is in the
 * graph and has two other callers who know nothing about any of this.
 *
 * The fold is unit-tested below over hand-built readers. The other half — that
 * the guard's oracle is node itself — is asserted against the working tree,
 * because `node --check` parses a `.ts` file with an `enum` in it quite
 * happily: a text scan cannot answer the erasability question at all.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  LOADED_FILE_MARKER,
  NATIVE_LOADER_REASON,
  REPORTER_GRAPH_ENTRY,
  formatGraphIssues,
  missingFromWalk,
  parseLoadedFiles,
  repoLocalSpecifiers,
  resolveSpecifier,
  walkReporterGraph,
  type GraphReader,
} from "../lib/check-reporter-graph";
import { LINT_GUARDS } from "../lib/lint-guards";
import { SCANNED_FLOORS } from "../lib/scanned-floor";
import { REPO_ROOT, readRepoFile as read } from "./helpers/repo-file";

const GUARD_SCRIPT = "scripts/check-reporter-graph.ts";

/** A reader over a literal file table; anything absent reads as unreadable. */
const readerOver = (files: Readonly<Record<string, string>>): GraphReader =>
  (relative) => (relative in files ? files[relative] : null);

describe("repoLocalSpecifiers", () => {
  it("takes static imports", () => {
    assert.deepEqual(
      repoLocalSpecifiers('import { a } from "./one.ts";\nimport b from "../two.ts";'),
      ["./one.ts", "../two.ts"],
    );
  });

  it("takes dynamic imports — node's loader follows those too", () => {
    assert.deepEqual(repoLocalSpecifiers('await import("./lazy.ts");'), ["./lazy.ts"]);
  });

  it("leaves bare specifiers alone", () => {
    // `node:path` and a package are node's to resolve however it likes; the
    // two rules this guard enforces are about repo-local files only.
    assert.deepEqual(
      repoLocalSpecifiers('import p from "node:path";\nimport x from "tsx";'),
      [],
    );
  });

  it("takes a type-only import, which is still a specifier node has to resolve", () => {
    assert.deepEqual(repoLocalSpecifiers('import { type T } from "./types.ts";'), [
      "./types.ts",
    ]);
  });

  it("takes a re-export, which the `from` pattern already covers", () => {
    assert.deepEqual(repoLocalSpecifiers('export { a } from "./re.ts";'), ["./re.ts"]);
    assert.deepEqual(repoLocalSpecifiers('export * from "./star.ts";'), ["./star.ts"]);
  });

  it("takes a side-effect import, which has no `from` at all", () => {
    // The shape the first version of this scan missed entirely: no bindings,
    // so nothing for the `from` pattern to anchor on, and node follows it
    // exactly like any other import.
    assert.deepEqual(repoLocalSpecifiers('import "./setup.ts";'), ["./setup.ts"]);
  });
});

describe("parseLoadedFiles", () => {
  it("reads the recorder's marked lines and drops node's own output", () => {
    const stderr = [
      "(node:1) Warning: something node felt strongly about",
      `${LOADED_FILE_MARKER} /repo/scripts/a.ts`,
      "    at someFrame (node:internal/x:1:1)",
      `${LOADED_FILE_MARKER} /repo/lib/b.ts`,
    ].join("\n");
    assert.deepEqual(parseLoadedFiles(stderr, "/repo"), ["scripts/a.ts", "lib/b.ts"]);
  });

  it("drops files outside the scan root", () => {
    // node loads its own internals and, in principle, a package's files.
    // Neither is under the two rules this guard enforces.
    const stderr = `${LOADED_FILE_MARKER} /elsewhere/x.ts\n${LOADED_FILE_MARKER} /repo/ok.ts`;
    assert.deepEqual(parseLoadedFiles(stderr, "/repo"), ["ok.ts"]);
  });

  it("reports each file once even when node loads it twice", () => {
    const stderr = `${LOADED_FILE_MARKER} /repo/a.ts\n${LOADED_FILE_MARKER} /repo/a.ts`;
    assert.deepEqual(parseLoadedFiles(stderr, "/repo"), ["a.ts"]);
  });

  it("finds nothing in output that carries no markers", () => {
    assert.deepEqual(parseLoadedFiles("just a stack trace\n  at x", "/repo"), []);
  });
});

describe("missingFromWalk", () => {
  it("names a file node loaded that the walk never reached", () => {
    assert.deepEqual(missingFromWalk(["a.ts"], ["a.ts", "hidden.ts"]), ["hidden.ts"]);
  });

  it("is silent when the walk saw more than node loaded", () => {
    // Only one direction is a finding. A dynamic import on a branch that did
    // not run is still a file under the rules, and the walk is right to have
    // it; node not loading it says nothing about the graph.
    assert.deepEqual(missingFromWalk(["a.ts", "lazy.ts"], ["a.ts"]), []);
  });
});

describe("resolveSpecifier", () => {
  it("resolves against the importing file's directory", () => {
    assert.equal(resolveSpecifier("scripts/a.ts", "../lib/b.ts"), "lib/b.ts");
    assert.equal(resolveSpecifier("lib/a.ts", "./b.ts"), "lib/b.ts");
  });

  it("stays posix so a repo-relative path never grows a backslash", () => {
    // These are import specifiers, not host paths. Joining them through the
    // platform namespace would produce a key on Windows that no later
    // comparison matches.
    assert.equal(resolveSpecifier("lib/deep/a.ts", "../../scripts/b.ts"), "scripts/b.ts");
  });
});

describe("walkReporterGraph", () => {
  it("follows the graph transitively and reports it entry-first", () => {
    const graph = walkReporterGraph(
      readerOver({
        "scripts/entry.ts": 'import { x } from "../lib/mid.ts";',
        "lib/mid.ts": 'import { y } from "./leaf.ts";',
        "lib/leaf.ts": "export const y = 1;",
      }),
      "scripts/entry.ts",
    );
    assert.deepEqual(graph.files, ["scripts/entry.ts", "lib/mid.ts", "lib/leaf.ts"]);
    assert.deepEqual(graph.extensionless, []);
    assert.deepEqual(graph.unreadable, []);
  });

  it("visits a diamond once", () => {
    const graph = walkReporterGraph(
      readerOver({
        "e.ts": 'import a from "./a.ts";\nimport b from "./b.ts";',
        "a.ts": 'import s from "./shared.ts";',
        "b.ts": 'import s from "./shared.ts";',
        "shared.ts": "export default 1;",
      }),
      "e.ts",
    );
    assert.deepEqual(graph.files, ["e.ts", "a.ts", "b.ts", "shared.ts"]);
  });

  it("survives a cycle rather than walking forever", () => {
    const graph = walkReporterGraph(
      readerOver({ "a.ts": 'import b from "./b.ts";', "b.ts": 'import a from "./a.ts";' }),
      "a.ts",
    );
    assert.deepEqual(graph.files, ["a.ts", "b.ts"]);
  });

  it("records an extensionless import and does NOT follow it", () => {
    // Node cannot resolve it either, so guessing where it meant to point would
    // report findings about a file the failing run never opens.
    const graph = walkReporterGraph(
      readerOver({
        "e.ts": 'import x from "./target";',
        "target.ts": 'import boom from "./nowhere.ts";',
      }),
      "e.ts",
    );
    assert.deepEqual(graph.extensionless, [{ file: "e.ts", specifier: "./target" }]);
    assert.deepEqual(graph.files, ["e.ts"]);
    assert.deepEqual(graph.unreadable, [], "the unfollowed file must not also be a read failure");
  });

  it("records a followable import that cannot be read", () => {
    const graph = walkReporterGraph(readerOver({ "e.ts": 'import x from "./gone.ts";' }), "e.ts");
    assert.deepEqual(graph.unreadable, ["gone.ts"]);
  });

  it("reports the entry itself as unreadable rather than throwing", () => {
    const graph = walkReporterGraph(readerOver({}), "e.ts");
    assert.deepEqual(graph.files, []);
    assert.deepEqual(graph.unreadable, ["e.ts"]);
  });
});

describe("formatGraphIssues", () => {
  it("is empty for a clean graph", () => {
    assert.deepEqual(
      formatGraphIssues({ files: ["a.ts"], unreadable: [], extensionless: [] }),
      [],
    );
  });

  it("names the file and the specifier, and says the reason only once", () => {
    // The caller wraps the list in a sentence carrying NATIVE_LOADER_REASON;
    // repeating it per row buried the findings under the explanation.
    const lines = formatGraphIssues({
      files: [],
      unreadable: ["lib/gone.ts"],
      extensionless: [{ file: "lib/a.ts", specifier: "./b" }],
    });
    assert.equal(lines.length, 2);
    assert.ok(lines.some((line) => line.includes("lib/gone.ts")));
    assert.ok(lines.some((line) => line.includes("lib/a.ts") && line.includes('"./b"')));
    for (const line of lines) assert.ok(!line.includes(NATIVE_LOADER_REASON));
  });
});

describe("the guard is wired into the fleet", () => {
  const guard = LINT_GUARDS.find((entry) => entry.scriptPath === GUARD_SCRIPT);

  it("is in LINT_GUARDS, so lint:all and lint:ci run it", () => {
    assert.ok(guard, `${GUARD_SCRIPT} must be registered in lib/lint-guards.ts`);
  });

  it("keeps the recorder's marker literal in step with the constant", () => {
    // The recorder cannot import the constant: a hook module is loaded on the
    // loader thread before the graph it watches, so anything it pulls in would
    // appear inside its own measurement. The copy is deliberate; this is what
    // keeps the two spellings honest.
    const recorder = read("scripts", "record-loaded-files.ts");
    assert.ok(
      recorder.includes(`"${LOADED_FILE_MARKER}"`),
      `scripts/record-loaded-files.ts must carry "${LOADED_FILE_MARKER}" as a literal`,
    );
  });

  it("keeps the recorder free of imports, so it stays outside its own measurement", () => {
    const recorder = read("scripts", "record-loaded-files.ts");
    assert.deepEqual(
      [...recorder.matchAll(/^\s*import\s/gm)].map((m) => m[0]),
      [],
      "an import here would be loaded by the hook thread and recorded as part of the graph it measures",
    );
  });

  it("declares its entry point as its input floor and nothing else", () => {
    // The graph BELOW the entry is walked, not declared. Listing
    // lib/thrown-value.ts here would turn "the reporter stopped needing that
    // helper" into a premise failure about a file nothing reads any more.
    const floor = SCANNED_FLOORS["check-reporter-graph"];
    assert.deepEqual(floor?.inputs, [REPORTER_GRAPH_ENTRY]);
  });

  it("guards the entry `npm test` actually points node at", () => {
    // Without this the guard has two independent definitions of "the
    // reporter": a constant here and a string in package.json. Point the
    // script at a different file and this guard keeps checking the old one,
    // greenly — a guard whose subject has quietly moved is worse than none.
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const reporters = [...pkg.scripts.test.matchAll(/--test-reporter=(\S+)/g)].map((m) => m[1]);
    const repoLocal = reporters
      .filter((value) => value.startsWith("."))
      .map((value) => value.replace(/^\.\//, ""));
    assert.deepEqual(
      repoLocal,
      [REPORTER_GRAPH_ENTRY],
      "the repo-local reporter `npm test` runs must be the entry this guard walks from",
    );
  });

  it("runs before `npm test` in lint:ci, which is the only reason it can help", () => {
    // Both failures kill the whole run at link time, so the suites cannot
    // report them — this guard has to get there first.
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const ci = pkg.scripts["lint:ci"];
    assert.ok(ci.indexOf("lint:all") < ci.indexOf("npm test"));
  });
});

describe("node itself is the oracle, and it has to be", () => {
  const graphFiles = (() => {
    const seen = new Set<string>();
    const queue = [REPORTER_GRAPH_ENTRY];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of repoLocalSpecifiers(read(file))) {
        if (specifier.endsWith(".ts")) queue.push(resolveSpecifier(file, specifier));
      }
    }
    return [...seen];
  })();

  it("finds a real graph rather than an empty one", () => {
    // The hazard every sweep here has: a walk that stopped matching satisfies
    // "nothing is wrong" perfectly.
    assert.ok(
      graphFiles.length >= 2,
      `only ${graphFiles.length} file(s) reachable from ${REPORTER_GRAPH_ENTRY} — the walk stopped matching`,
    );
  });

  it("`node --check` cannot answer the erasability question", () => {
    // The reason the guard spawns an import instead of a syntax check: node's
    // parser accepts an enum in a .ts file and says nothing. A guard built on
    // --check would be green on the exact change it exists to catch.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-graph-"));
    try {
      const file = path.join(dir, "enum.ts");
      fs.writeFileSync(file, "export enum E { A }\n", "utf8");
      let checkAccepted = true;
      try {
        execFileSync(process.execPath, ["--check", file], { stdio: "ignore" });
      } catch {
        checkAccepted = false;
      }
      assert.equal(
        checkAccepted,
        true,
        "node --check now rejects an enum — the guard could use the cheaper oracle",
      );

      let importRejected = false;
      try {
        execFileSync(
          process.execPath,
          ["--input-type=module", "-e", `await import(${JSON.stringify(`file://${file}`)});`],
          { stdio: "ignore" },
        );
      } catch {
        importRejected = true;
      }
      assert.equal(importRejected, true, "importing an enum under strip-only mode must fail");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the recorder reports the graph node really loaded, not the one text found", () => {
    // The end-to-end of the measurement half: register the hook, import the
    // entry the way the guard does, and read the markers back. A recorder that
    // silently stopped printing would leave the guard reporting an empty graph
    // as a pass, which is the vacuous green this whole fleet refuses — the
    // guard has its own assertion for that, and this is the case that proves
    // the mechanism works at all.
    const program = [
      'import { register } from "node:module";',
      `register(${JSON.stringify(`file://${path.join(REPO_ROOT, "scripts/record-loaded-files.ts")}`)});`,
      `await import(${JSON.stringify(`file://${path.join(REPO_ROOT, REPORTER_GRAPH_ENTRY)}`)});`,
    ].join("\n");
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    assert.equal(run.status, 0, `the recorded import failed:\n${run.stderr}`);
    const measured = parseLoadedFiles(run.stderr ?? "", REPO_ROOT);
    assert.ok(measured.includes(REPORTER_GRAPH_ENTRY), `entry missing from ${measured.join(", ")}`);
    assert.deepEqual(
      [...measured].sort(),
      [...graphFiles].sort(),
      "the measured graph and the text walk disagree — one of the two is checking the wrong set of files",
    );
  });

  it("every file in the working tree's graph loads under node's own loader", () => {
    // The same check the guard makes, asserted here too so a red suite says
    // which file rather than only which guard.
    for (const file of graphFiles) {
      assert.doesNotThrow(() => {
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `await import(${JSON.stringify(`file://${path.join(REPO_ROOT, file)}`)});`,
          ],
          { stdio: "ignore", timeout: 30_000 },
        );
      }, `${file} is in the reporter's graph and node's own loader cannot import it — ${NATIVE_LOADER_REASON}`);
    }
  });
});
