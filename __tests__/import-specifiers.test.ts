import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  importSpecifiers,
  importedModules,
  specifierEndsWithModule,
  specifierIsPackage,
} from "@/lib/import-specifiers";

/**
 * One reader of the module graph, for the rules that each had their own.
 *
 * Four scanners here matched imports and no two agreed on what one looks
 * like: the analytics guard missed the side-effect form, the reporter graph
 * matched only double quotes and followed commented-out imports, and
 * `reached-from` was written last with all four shapes and a comment strip.
 * None of those differences was a decision — each pattern described the
 * shapes its author's tree happened to contain, which is how the eighteen
 * source-tree walks came to disagree about `node_modules`.
 *
 * The cases below are the union of what the three rules needed, asserted once
 * so a fifth caller inherits the answer rather than writing a fifth pattern.
 */
describe("importSpecifiers — the four shapes", () => {
  it("reads a static import, a re-export, a dynamic import and a require", () => {
    const source = [
      `import { a } from "./one.ts";`,
      `export { b } from "../two.ts";`,
      `const c = await import("expo-router");`,
      `const d = require("node:path");`,
    ].join("\n");
    assert.deepEqual(
      importSpecifiers(source).map((record) => [record.kind, record.specifier]),
      [
        ["static", "./one.ts"],
        ["static", "../two.ts"],
        ["dynamic", "expo-router"],
        ["require", "node:path"],
      ],
    );
  });

  it("reads the side-effect form, which has no bindings and no `from`", () => {
    // The shape `check-analytics-imports` used to miss entirely: a UI file can
    // drag a module into the bundle without naming anything from it.
    assert.deepEqual(importSpecifiers(`import "@/lib/analytics-events";`), [
      { specifier: "@/lib/analytics-events", index: 0, kind: "side-effect" },
    ]);
  });

  it("reads a type-only import and a namespace import", () => {
    const source = `import type { T } from "./types.ts";\nimport * as path from "node:path";`;
    assert.deepEqual(importedModules(source), ["./types.ts", "node:path"]);
  });

  it("reads a named clause spread over several lines", () => {
    // Prettier wraps a long clause, and a pattern that stopped at the line end
    // would call the file importless.
    const source = `import {\n  one,\n  two,\n} from "@/lib/thing";`;
    assert.deepEqual(importedModules(source), ["@/lib/thing"]);
  });

  it("reads single quotes as well as double", () => {
    // This repository's prettier config writes double quotes and node reads
    // both, so a rule that matched one was a rule about the formatter.
    assert.deepEqual(importedModules(`import { a } from './one.ts';`), ["./one.ts"]);
  });

  it("ignores an import that is only in a comment", () => {
    const source = `// import { a } from "./gone.ts";\n/* import "./also-gone.ts"; */\nexport const x = 1;`;
    assert.deepEqual(importSpecifiers(source), []);
  });

  it("ignores a quoted string that is not a specifier", () => {
    assert.deepEqual(importSpecifiers(`const label = "nanoid";\nconst from = "x";`), []);
  });

  it("reports one record per statement, in source order, keeping duplicates", () => {
    // Two imports of one module on two lines are two findings to a rule that
    // reports `file:line`.
    const source = `import { a } from "./one.ts";\nimport { b } from "./one.ts";`;
    const records = importSpecifiers(source);
    assert.equal(records.length, 2);
    assert.ok(records[0].index < records[1].index);
    assert.deepEqual(importedModules(source), ["./one.ts"]);
  });

  it("gives an offset that maps into the source as passed in", () => {
    // `stripComments` blanks to spaces rather than deleting, which is what
    // lets a caller slice the ORIGINAL text for the snippet it prints.
    const source = `// a comment about "./one.ts"\nimport { a } from "./one.ts";`;
    const [record] = importSpecifiers(source);
    assert.equal(source.slice(record.index, record.index + 6), "import");
  });

  it("does not splice two statements into one match", () => {
    // The static pattern crosses no quote and no semicolon, so a `from` on a
    // later line cannot be paired with an `import` on an earlier one.
    assert.deepEqual(importedModules(`import x;\nconst y = fromCache("./one.ts");`), []);
  });
});

describe("specifierIsPackage", () => {
  it("accepts the package and its subpaths and nothing longer", () => {
    assert.equal(specifierIsPackage("nanoid", "nanoid"), true);
    assert.equal(specifierIsPackage("nanoid/non-secure", "nanoid"), true);
    assert.equal(specifierIsPackage("nanoid-esm", "nanoid"), false);
  });

  it("needs no special case for a scoped package", () => {
    assert.equal(specifierIsPackage("@scope/pkg/deep", "@scope/pkg"), true);
    assert.equal(specifierIsPackage("@scope/pkg-other", "@scope/pkg"), false);
  });
});

describe("specifierEndsWithModule", () => {
  it("matches the alias and any relative depth, with or without extension", () => {
    for (const specifier of [
      "@/lib/analytics-events",
      "../lib/analytics-events",
      "./analytics-events.ts",
      "../../lib/analytics-events.tsx",
    ]) {
      assert.equal(specifierEndsWithModule(specifier, "analytics-events"), true, specifier);
    }
  });

  it("does not match a longer neighbour or a bare package of the same name", () => {
    assert.equal(specifierEndsWithModule("./analytics-events-migration", "analytics-events"), false);
    assert.equal(specifierEndsWithModule("@/lib/analytics-helpers", "analytics-events"), false);
    // No leading `/`, so a package whose whole name is the module's does not
    // pass — the rule is about a path into this repository.
    assert.equal(specifierEndsWithModule("analytics-events", "analytics-events"), false);
  });

  it("treats the module name as a literal, not a pattern", () => {
    assert.equal(specifierEndsWithModule("@/lib/a-b", "a.b"), false);
  });
});
