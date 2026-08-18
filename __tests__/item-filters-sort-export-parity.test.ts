import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * `components/item-filters.tsx` re-exports the pure helpers from
 * `lib/item-filters.ts` because that is where they used to live — call sites
 * still import from `@/components/item-filters`, and the lib extraction was
 * meant to be invisible to them.
 *
 * The re-export list was hand-maintained, which is how it drifted:
 * `countActiveFilters` and `getTitleCollator` were public in the lib for weeks
 * while consumers on the historical path could not see them, and nothing
 * failed. The rule this file enforces is ALL-OR-NOTHING — every public export
 * of the lib is mirrored by the component — because a hand-picked subset has
 * no invariant a test can check, only a list someone has to remember.
 *
 * Structural rather than runtime: `components/item-filters.tsx` pulls
 * react-native, so it cannot be imported under `tsx --test`. Both files are
 * parsed as text instead.
 */

const LIB = read("lib/item-filters.ts");
const COMPONENT = read("components/item-filters.tsx");

/** Public value exports (`export const|function`) declared in the lib. */
function libValueExports(src: string): string[] {
  return [...src.matchAll(/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
}

/** Public type exports (`export type`) declared in the lib. */
function libTypeExports(src: string): string[] {
  return [...src.matchAll(/^export\s+type\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
}

/** Names inside the component's `export { … }` block. */
function componentValueReExports(src: string): string[] {
  const match = src.match(/^export\s*\{([^}]*)\}\s*;/m);
  assert.ok(match, "components/item-filters.tsx has no `export { … }` re-export block");
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Names inside the component's `export type { … }` block. */
function componentTypeReExports(src: string): string[] {
  const match = src.match(/^export\s+type\s*\{([^}]*)\}\s*;/m);
  assert.ok(match, "components/item-filters.tsx has no `export type { … }` re-export block");
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("item-filters — lib → component re-export parity", () => {
  it("the lib actually declares exports (guards against a vacuous pass)", () => {
    // If the regexes stopped matching (a formatting change, a barrel rewrite),
    // every parity assertion below would compare two empty sets and pass.
    assert.ok(libValueExports(LIB).length >= 5, "suspiciously few lib value exports parsed");
    assert.ok(libTypeExports(LIB).length >= 2, "suspiciously few lib type exports parsed");
  });

  it("re-exports EVERY public value export of lib/item-filters.ts", () => {
    const missing = libValueExports(LIB).filter((name) => !componentValueReExports(COMPONENT).includes(name));
    assert.deepEqual(
      missing,
      [],
      `lib/item-filters.ts exports these without a component re-export: ${missing.join(", ")}`,
    );
  });

  it("re-exports EVERY public type export of lib/item-filters.ts", () => {
    const missing = libTypeExports(LIB).filter((name) => !componentTypeReExports(COMPONENT).includes(name));
    assert.deepEqual(
      missing,
      [],
      `lib/item-filters.ts exports these types without a component re-export: ${missing.join(", ")}`,
    );
  });

  it("re-exports nothing the lib does not declare (no phantom names)", () => {
    // The reverse direction: a re-export of a deleted helper is a build error
    // in TS, but a renamed one that still resolves via some other import would
    // quietly widen the surface.
    const declared = libValueExports(LIB);
    const phantom = componentValueReExports(COMPONENT).filter((name) => !declared.includes(name));
    assert.deepEqual(phantom, [], `component re-exports names not declared in the lib: ${phantom.join(", ")}`);
  });

  it("names the two helpers the original task called out by name", () => {
    // `applySortMode` + `ItemSortMode` were the specific pair the task was
    // filed over. Pinned explicitly so the general rule above can never be
    // weakened into passing while these two regress.
    assert.ok(componentValueReExports(COMPONENT).includes("applySortMode"));
    assert.ok(componentTypeReExports(COMPONENT).includes("ItemSortMode"));
  });

  it("imports every re-exported name from the lib, not from elsewhere", () => {
    // A re-export sourced from a different module would satisfy the parity
    // check above while silently forking the implementation.
    const importBlock = COMPONENT.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/item-filters";/);
    assert.ok(importBlock, "no `import { … } from \"@/lib/item-filters\"` block found");
    const imported = importBlock[1]
      .split(",")
      .map((s) => s.trim().replace(/^type\s+/, ""))
      .filter(Boolean);
    for (const name of [...componentValueReExports(COMPONENT), ...componentTypeReExports(COMPONENT)]) {
      assert.ok(imported.includes(name), `${name} is re-exported but not imported from @/lib/item-filters`);
    }
  });

  it("keeps the re-export list alphabetised so additions land predictably", () => {
    // Not cosmetic: an unsorted list is where a duplicate or a near-miss name
    // hides. Sorting makes a missing entry visible in review.
    for (const list of [componentValueReExports(COMPONENT), componentTypeReExports(COMPONENT)]) {
      const sorted = [...list].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      assert.deepEqual(list, sorted, `re-export list is not alphabetised: ${list.join(", ")}`);
    }
  });

  it("carries a comment explaining that the mirror is all-or-nothing", () => {
    // Without it, the next contributor reads a long export list as incidental
    // and prunes it back to "what's actually used here".
    const idx = COMPONENT.search(/^export\s*\{/m);
    const doc = COMPONENT.slice(Math.max(0, idx - 900), idx)
      .replace(/^\s*\/\/\s?/gm, "")
      .replace(/\s+/g, " ");
    assert.match(doc, /ALL-OR-NOTHING|all-or-nothing/i);
    assert.match(doc, /item-filters-sort-export-parity/);
  });
});
