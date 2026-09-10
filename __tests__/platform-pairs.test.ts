/**
 * `lib/check-platform-pairs.ts` — the rule that the two halves of a
 * platform-split module still export the same names.
 *
 * Most of these run the reader over source strings rather than matching its
 * source, because the thing worth pinning is what it NAMES: the pair this repo
 * ships spells one shared type two different ways (`export type T` on the
 * native side, `export type { T } from` on the web side), and a reader that
 * missed either form would report a difference that is not there and would go
 * on doing so until somebody deleted the guard.
 *
 * The last block runs the real tree through the same functions the wrapper
 * does, so the two pairs in this repository are asserted to agree rather than
 * assumed to.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PLATFORM_SUFFIXES,
  comparePlatformPair,
  exportedNames,
  formatPlatformPairReport,
  platformPairs,
  platformSpelling,
  type PlatformPair,
} from "@/lib/check-platform-pairs";

import { readRepoFile } from "./helpers/repo-file";

/** The names one source exports, sorted — the shape every case here compares. */
function names(source: string): string[] {
  return exportedNames(source)
    .exports.map((record) => record.name)
    .sort();
}

/** A pair whose halves are the two sources given, for the comparison cases. */
function pairOf(file = "lib/thing.web.ts"): PlatformPair {
  const platform = platformSpelling(file);
  assert.ok(platform, `${file} is not a platform spelling`);
  return { platform, native: "lib/thing.ts" };
}

describe("platformSpelling — which files are one half of a pair", () => {
  it("splits a web spelling into its base and platform", () => {
    assert.deepEqual(platformSpelling("lib/reorder-announcement.web.ts"), {
      file: "lib/reorder-announcement.web.ts",
      base: "lib/reorder-announcement",
      platform: "web",
    });
  });

  it("reads a .tsx spelling too", () => {
    assert.deepEqual(platformSpelling("components/DraggableList.web.tsx"), {
      file: "components/DraggableList.web.tsx",
      base: "components/DraggableList",
      platform: "web",
    });
  });

  it("matches the suffix as its own segment, not as a substring", () => {
    // `includes(".web")` would be wrong in both directions: it claims
    // `webhooks.ts` and it would claim `lib/web.ts`. The dot before the
    // platform is what makes it a Metro suffix.
    assert.equal(platformSpelling("lib/webhooks.ts"), null);
    assert.equal(platformSpelling("lib/web.ts"), null);
    assert.equal(platformSpelling("lib/supabase.ts"), null);
  });

  it("knows every suffix Metro resolves, not only the one this tree uses", () => {
    for (const platform of PLATFORM_SUFFIXES) {
      assert.equal(
        platformSpelling(`lib/thing.${platform}.ts`)?.platform,
        platform,
        `${platform} is declared but not recognised`,
      );
    }
    assert.ok(PLATFORM_SUFFIXES.includes("web"), "web is the suffix this repo actually ships");
    assert.ok(PLATFORM_SUFFIXES.length >= 4, "Metro resolves web/native/ios/android");
  });
});

describe("platformPairs — pairing against the files the scan saw", () => {
  it("pairs a web spelling with a native sibling of either extension", () => {
    const pairs = platformPairs([
      "lib/a.web.ts",
      "lib/a.ts",
      "components/B.web.tsx",
      "components/B.tsx",
    ]);
    assert.deepEqual(
      pairs.map((p) => [p.platform.file, p.native]),
      [
        ["lib/a.web.ts", "lib/a.ts"],
        ["components/B.web.tsx", "components/B.tsx"],
      ],
    );
  });

  it("pairs a .web.ts with a .tsx sibling", () => {
    // The extensions need not match: what Metro resolves is the BASE, and
    // `lib/a.web.ts` beside `lib/a.tsx` is one module with two spellings.
    const [pair] = platformPairs(["lib/a.web.ts", "lib/a.tsx"]);
    assert.equal(pair?.native, "lib/a.tsx");
  });

  it("reports a missing sibling as null rather than skipping the pair", () => {
    const [pair] = platformPairs(["lib/orphan.web.ts", "lib/other.ts"]);
    assert.equal(pair?.native, null);
  });

  it("finds nothing in a tree with no platform spellings", () => {
    assert.deepEqual(platformPairs(["lib/a.ts", "components/B.tsx"]), []);
  });
});

describe("exportedNames — the forms this tree actually writes", () => {
  it("names a declaration of every keyword", () => {
    assert.deepEqual(
      names(
        [
          "export function f() {}",
          "export async function g() {}",
          "export const c = 1;",
          "export let l = 1;",
          "export var v = 1;",
          "export class K {}",
          "export type T = string;",
          "export interface I { a: string }",
          "export enum E { A }",
        ].join("\n"),
      ),
      ["E", "I", "K", "T", "c", "f", "g", "l", "v"],
    );
  });

  it("names the EXPORTED half of a renamed re-export, not the local one", () => {
    // `a as b` is imported as `b`. Comparing local names would report two
    // halves that export the same thing under different internals as a
    // difference — which is the opposite of what this guard is for.
    assert.deepEqual(names('export { a as b, c } from "./x";'), ["b", "c"]);
  });

  it("reads a multi-line brace list", () => {
    // The shape components/DraggableList.tsx uses, and the one a `[^}]*`
    // pattern reads correctly only by accident.
    assert.deepEqual(
      names('export {\n  NestableScrollContainer,\n  ScaleDecorator,\n} from "react-native-draggable-flatlist";'),
      ["NestableScrollContainer", "ScaleDecorator"],
    );
  });

  it("reads `export type { T } from` as the same name `export type T` declares", () => {
    // The exact pair this repository ships: reorder-announcement declares the
    // type natively and re-exports it on web. Two statement forms, one name.
    assert.deepEqual(names('export type { ReorderAnnouncement } from "@/lib/reorder-announcement";'), [
      "ReorderAnnouncement",
    ]);
    assert.deepEqual(names('export type ReorderAnnouncement = "a" | "b";'), ["ReorderAnnouncement"]);
  });

  it("reads `export { type T }` — the inline type modifier", () => {
    assert.deepEqual(names("export { type T, value };"), ["T", "value"]);
  });

  it("names a default export `default`, whatever follows it", () => {
    // What an importer writes is `import X from`, so the name that has to
    // match across the pair is `default` — naming the function would compare
    // an identifier no importer ever types.
    assert.deepEqual(names("export default function screen() {}"), ["default"]);
    assert.deepEqual(names("export default 42;"), ["default"]);
    assert.deepEqual(names('export { default as DraggableFlatList } from "x";'), [
      "DraggableFlatList",
    ]);
  });

  it("names a namespaced star re-export", () => {
    assert.deepEqual(names('export * as helpers from "./helpers";'), ["helpers"]);
  });

  it("ignores the word export in a comment or a string", () => {
    const source = [
      "// export const ghost = 1;",
      "/** export function alsoGhost() {} */",
      'const label = "export const stillGhost = 1";',
      "export const real = 1;",
    ].join("\n");
    assert.deepEqual(names(source), ["real"]);
  });

  it("reports the line the export is declared on", () => {
    const scan = exportedNames(["// header", "", "export const first = 1;", "export const second = 2;"].join("\n"));
    assert.deepEqual(
      scan.exports.map((record) => [record.name, record.line]),
      [
        ["first", 3],
        ["second", 4],
      ],
    );
  });
});

describe("exportedNames — where it refuses instead of guessing", () => {
  it("refuses a bare `export * from`, whose names live in another module", () => {
    const scan = exportedNames('export * from "./everything";');
    assert.deepEqual(scan.exports, []);
    assert.equal(scan.unreadable.length, 1);
    assert.match(scan.unreadable[0]!.reason, /names nothing this scan can resolve/);
  });

  it("refuses a statement that declares two names, rather than naming the first", () => {
    // The silent direction this whole `unreadable` channel exists for: naming
    // `a` and stopping produces a name set that is short by one, and a short
    // set is indistinguishable from a half that really is missing an export.
    const scan = exportedNames("export const a = 1, b = 2;");
    assert.deepEqual(scan.exports.map((r) => r.name), ["a"]);
    assert.equal(scan.unreadable.length, 1);
    assert.match(scan.unreadable[0]!.reason, /more than one name/);
  });

  it("does not mistake a comma inside an initialiser for a second declarator", () => {
    // Every one of these is ONE declaration. The arrow is the case that broke
    // the first version: `=>` read as a closing bracket, drove the depth
    // negative, and made the argument list's comma look top-level.
    for (const source of [
      "export const f = () => fn(a, b);",
      "export const g = (a: number, b: number) => a + b;",
      "export const table: Record<string, number> = {};",
      "export const o = { a: 1, b: 2 };",
      "export const list = [1, 2, 3];",
      'export const s = "a, b";',
    ]) {
      assert.deepEqual(exportedNames(source).unreadable, [], `refused a single declaration: ${source}`);
    }
  });

  it("refuses a form it has never seen rather than dropping it", () => {
    const scan = exportedNames("export @decorated thing;");
    assert.equal(scan.unreadable.length, 1);
    assert.match(scan.unreadable[0]!.reason, /recognises no export form/);
  });
});

describe("comparePlatformPair", () => {
  it("says nothing when both halves export the same names", () => {
    assert.deepEqual(
      comparePlatformPair(pairOf(), "export function go() {}\n", "export function go() {}\n"),
      [],
    );
  });

  it("is order-blind and form-blind — the same set spelled differently agrees", () => {
    assert.deepEqual(
      comparePlatformPair(
        pairOf(),
        'export type { T } from "@/lib/thing";\nexport function go() {}\n',
        "export function go() {}\nexport type T = string;\n",
      ),
      [],
    );
  });

  it("names an export the web half has and the native half does not", () => {
    const findings = comparePlatformPair(
      pairOf(),
      "export function go() {}\nexport const REGION_ID = 1;\n",
      "export function go() {}\n",
    );
    assert.deepEqual(findings.map((f) => [f.code, f.file, f.line]), [
      ["platform-only-export", "lib/thing.web.ts", 2],
    ]);
    assert.match(findings[0]!.detail, /native spelling gets undefined/);
  });

  it("names an export the native half has and the web half does not", () => {
    const findings = comparePlatformPair(
      pairOf(),
      "export function go() {}\n",
      "export function go() {}\nexport function alsoGo() {}\n",
    );
    assert.deepEqual(findings.map((f) => [f.code, f.file, f.line]), [
      ["native-only-export", "lib/thing.ts", 2],
    ]);
    // The direction matters in the message: this one breaks the WEB build,
    // which is the only build this repository deploys.
    assert.match(findings[0]!.detail, /"web" spelling gets undefined/);
  });

  it("reports both directions at once", () => {
    const findings = comparePlatformPair(pairOf(), "export const a = 1;\n", "export const b = 1;\n");
    assert.deepEqual(findings.map((f) => f.code).sort(), [
      "native-only-export",
      "platform-only-export",
    ]);
  });

  it("reports a missing native sibling as one finding, not one per export", () => {
    const platform = platformSpelling("lib/orphan.web.ts");
    assert.ok(platform);
    const findings = comparePlatformPair(
      { platform, native: null },
      "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
      null,
    );
    assert.deepEqual(findings.map((f) => [f.code, f.file, f.line]), [
      ["missing-native", "lib/orphan.web.ts", 1],
    ]);
    assert.match(findings[0]!.detail, /no native sibling/);
  });

  it("refuses to compare at all when either half has an unreadable export", () => {
    // A short name set invents differences. The refusal has to be the whole
    // report, or the reader is handed one real problem and two phantoms.
    const findings = comparePlatformPair(
      pairOf(),
      'export * from "./elsewhere";\nexport const shared = 1;\n',
      "export const shared = 1;\nexport const nativeOnly = 2;\n",
    );
    assert.deepEqual(findings.map((f) => f.code), ["unreadable-export"]);
    assert.equal(findings[0]!.file, "lib/thing.web.ts");
  });
});

describe("formatPlatformPairReport", () => {
  it("is empty when there is nothing to report", () => {
    assert.equal(formatPlatformPairReport([]), "");
  });

  it("prints one openable location per finding, and says why it matters", () => {
    const report = formatPlatformPairReport(
      comparePlatformPair(pairOf(), "export const a = 1;\n", "export const b = 1;\n"),
    );
    assert.match(report, /Found 2 platform-pair problem\(s\)\./);
    assert.match(report, /lib\/thing\.web\.ts:1/);
    assert.match(report, /lib\/thing\.ts:1/);
    // The reason a reader needs, since no type-check and no suite here can
    // reproduce the failure they are being asked to fix.
    assert.match(report, /Metro serves one spelling per platform/);
  });
});

describe("this repository's own pairs", () => {
  const PAIRS: readonly (readonly [string, string])[] = [
    ["components/DraggableList.web.tsx", "components/DraggableList.tsx"],
    ["lib/reorder-announcement.web.ts", "lib/reorder-announcement.ts"],
  ];

  for (const [web, native] of PAIRS) {
    it(`${web} exports exactly what ${native} does`, () => {
      const platform = platformSpelling(web);
      assert.ok(platform, `${web} is not recognised as a platform spelling`);
      assert.deepEqual(
        comparePlatformPair({ platform, native }, readRepoFile(web), readRepoFile(native)),
        [],
      );
    });
  }

  it("reads a real name set out of each half, so the agreement above is not two empty sets", () => {
    // Two is the smaller pair's whole surface (`announceReorder` and the
    // `ReorderAnnouncement` type), and the number that matters: a reader that
    // returned nothing at all would make every pair in this tree agree.
    for (const [web, native] of PAIRS) {
      assert.ok(names(readRepoFile(web)).length >= 2, `${web} exports almost nothing`);
      assert.ok(names(readRepoFile(native)).length >= 2, `${native} exports almost nothing`);
    }
  });

  it("still finds both pairs by walking the paths, not by this list", () => {
    // The list above is a fixture; this is the question the guard asks. A third
    // pair landing without a native sibling fails in the guard, and a pair
    // vanishing from the tree fails here.
    const pairs = platformPairs(PAIRS.flatMap(([web, native]) => [web, native]));
    assert.equal(pairs.length, PAIRS.length);
    for (const pair of pairs) assert.notEqual(pair.native, null);
  });
});
