import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const GLOBALS_PATH = path.join(process.cwd(), "types", "globals.d.ts");
const DEV_MENU_PATH = path.join(process.cwd(), "lib", "dev-menu.ts");

function read(rel: string): string {
  return readFileSync(rel, "utf8");
}

describe("types/globals.d.ts ambient declarations", () => {
  it("declares __DEV__ as a boolean global", () => {
    const src = read(GLOBALS_PATH);
    assert.match(
      src,
      /declare\s+const\s+__DEV__\s*:\s*boolean/,
      "must declare `__DEV__` as a `boolean` ambient global",
    );
  });

  it("is picked up by `**/*.ts` in tsconfig.json (no explicit entry needed)", () => {
    const tsconfig = JSON.parse(read(path.join(process.cwd(), "tsconfig.json"))) as {
      include?: string[];
    };
    const include = tsconfig.include ?? [];
    // The default `**/*.ts` pattern matches `.d.ts` too, so the ambient
    // declaration is reachable without bespoke wiring. If a future
    // contributor narrows the glob, this assertion fails-loud.
    const hasTsGlob = include.some((p) => p === "**/*.ts" || p.endsWith("/*.ts"));
    assert.ok(
      hasTsGlob,
      `tsconfig.include must keep a glob that picks up types/globals.d.ts (got: ${include.join(", ")})`,
    );
  });
});

describe("lib/dev-menu.ts uses the ambient __DEV__ global", () => {
  it("no longer carries the `(globalThis as { __DEV__?: boolean })` cast", () => {
    const src = read(DEV_MENU_PATH);
    assert.doesNotMatch(
      src,
      /globalThis\s+as\s+\{\s*__DEV__/,
      "the cast workaround should be replaced by the ambient declaration",
    );
  });

  it("references __DEV__ directly inside isDevEnvironment()", () => {
    const src = read(DEV_MENU_PATH);
    assert.match(
      src,
      /typeof\s+__DEV__\s*===\s*"boolean"/,
      "isDevEnvironment must `typeof __DEV__` guard for node-test bootstraps",
    );
  });
});
