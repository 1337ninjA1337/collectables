import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateReachedFrom,
  formatReachedFromFindings,
  importsPackage,
} from "@/lib/reached-from";

/**
 * The address of a reachability argument, held to being live and complete.
 *
 * `reachedFrom` is what a `shipsToClient: true` entry is held to instead of the
 * bundle: the package ships, no grep settles whether a call site passes it the
 * shape the advisory needs, and so the entry names the files the argument was
 * made about. Until this module existed the check was `source.includes(pkg)`,
 * which a doc comment satisfies, and it only ever walked the paths the entry
 * listed — so an entry naming one of six importers read as fully argued.
 *
 * Every case here is a fixture, and deliberately: the baseline has no
 * `shipsToClient: true` entry today (`nanoid` was the only one there has ever
 * been, and it was fixed rather than re-argued), so the rule has no live
 * subject to be proved against. Fixtures are the only way to pin the shape
 * before the day it is needed.
 */
describe("importsPackage", () => {
  it("matches the package itself and its subpaths", () => {
    assert.equal(importsPackage(`import { nanoid } from "nanoid";`, "nanoid"), true);
    assert.equal(
      importsPackage(`import { customAlphabet } from "nanoid/non-secure";`, "nanoid"),
      true,
    );
  });

  it("does not match a package that merely starts with the same letters", () => {
    // The failure the substring test had: `nanoid-esm` is somebody else's
    // package and answers nothing about this one.
    assert.equal(importsPackage(`import { nanoid } from "nanoid-esm";`, "nanoid"), false);
  });

  it("does not match a mention that is not an import", () => {
    const source = `const nanoidLike = makeId();\nexport const label = "nanoid";`;
    assert.equal(importsPackage(source, "nanoid"), false);
  });

  it("handles a scoped package with no special case", () => {
    assert.equal(importsPackage(`import x from "@scope/pkg/deep";`, "@scope/pkg"), true);
    assert.equal(importsPackage(`import x from "@scope/pkg-other";`, "@scope/pkg"), false);
  });
});

const tree = (entries: Record<string, string>): ReadonlyMap<string, string> =>
  new Map(Object.entries(entries));

describe("evaluateReachedFrom", () => {
  it("accepts an entry whose listed path is the only importer", () => {
    const verdict = evaluateReachedFrom(
      "nanoid",
      ["lib/ids.ts"],
      tree({ "lib/ids.ts": `import { nanoid } from "nanoid";`, "lib/other.ts": "export const a = 1;" }),
    );
    assert.deepEqual(verdict, { dead: [], unlisted: [] });
    assert.deepEqual(formatReachedFromFindings("nanoid", verdict), []);
  });

  it("reports a listed path that no longer imports the package", () => {
    // The import was removed and the acceptance still points here. A file that
    // mentions the package in prose is exactly the shape the old substring
    // check called live.
    const verdict = evaluateReachedFrom(
      "nanoid",
      ["lib/ids.ts"],
      tree({ "lib/ids.ts": `// nanoid used to be generated here\nexport const id = 1;` }),
    );
    assert.deepEqual(verdict.dead, ["lib/ids.ts"]);
    assert.match(formatReachedFromFindings("nanoid", verdict)[0], /no longer import the package/);
  });

  it("counts a path missing from the tree as dead", () => {
    const verdict = evaluateReachedFrom("nanoid", ["lib/gone.ts"], tree({}));
    assert.deepEqual(verdict.dead, ["lib/gone.ts"]);
  });

  it("reports an importer the entry does not name", () => {
    // The half nothing asked: five unread call sites behind one listed one.
    const verdict = evaluateReachedFrom(
      "nanoid",
      ["lib/ids.ts"],
      tree({
        "lib/ids.ts": `import { nanoid } from "nanoid";`,
        "app/create.tsx": `import { nanoid } from "nanoid";`,
        "lib/share.ts": `import { customAlphabet } from "nanoid/non-secure";`,
      }),
    );
    assert.deepEqual(verdict.unlisted, ["app/create.tsx", "lib/share.ts"]);
    assert.match(formatReachedFromFindings("nanoid", verdict)[0], /which `reachedFrom` does not name/);
  });

  it("reports both directions of one drifted entry", () => {
    // The usual shape when an entry has gone stale: the call moved, and the
    // list stayed where the call used to be.
    const verdict = evaluateReachedFrom(
      "nanoid",
      ["lib/ids.ts"],
      tree({
        "lib/ids.ts": "export const id = 1;",
        "lib/moved.ts": `import { nanoid } from "nanoid";`,
      }),
    );
    assert.deepEqual(verdict.dead, ["lib/ids.ts"]);
    assert.deepEqual(verdict.unlisted, ["lib/moved.ts"]);
    assert.equal(formatReachedFromFindings("nanoid", verdict).length, 2);
  });

  it("says nothing about a package no file imports", () => {
    // An entry with no list and no importers is a different finding — the
    // `unargued` one, which `evaluateShipsToClient` reports — and this must
    // not double up on it.
    const verdict = evaluateReachedFrom("nanoid", [], tree({ "lib/a.ts": "export const a = 1;" }));
    assert.deepEqual(verdict, { dead: [], unlisted: [] });
  });

  it("sorts both lists and reports a repeated path once", () => {
    const verdict = evaluateReachedFrom(
      "nanoid",
      ["lib/b.ts", "lib/a.ts", "lib/a.ts"],
      tree({ "lib/z.ts": `import "nanoid";`, "lib/m.ts": `import "nanoid";` }),
    );
    assert.deepEqual(verdict.dead, ["lib/a.ts", "lib/b.ts"]);
    assert.deepEqual(verdict.unlisted, ["lib/m.ts", "lib/z.ts"]);
  });
});
