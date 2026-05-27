import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regression for the iOS Safari crash captured at session a1e290cb:
 *
 *   "Rendered more hooks than during the previous render"
 *   in CollectionDetailsScreen at app/collection/[id].tsx
 *
 * Root cause: `toggleSelect = useCallback(...)` and `renderSelectableRow =
 * useCallback(...)` were declared AFTER two early-return branches
 * (`if (loadingRemote && !collection) return …`, `if (!collection) return …`).
 * On first paint the loading branch returned early and skipped the two
 * hooks; on the next render (data loaded) React saw two extra hooks and
 * crashed the screen.
 *
 * This test pins the structural invariant: every `useXxx(` call site in
 * `CollectionDetailsScreen` must appear ABOVE the first early return so
 * the hook order is stable across the loading→loaded transition.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function offsetsOf(src: string, re: RegExp): number[] {
  const out: number[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m.index);
  return out;
}

describe("CollectionDetailsScreen hook ordering", () => {
  const src = read("app/collection/[id].tsx");

  it("loading + not-found early returns live inside the component", () => {
    assert.match(src, /if\s*\(loadingRemote\s*&&\s*!collection\)\s*\{[\s\S]*?return/);
    assert.match(src, /if\s*\(!collection\)\s*\{[\s\S]*?return/);
  });

  it("every hook in the component body precedes the first early return", () => {
    // Find the body of CollectionDetailsScreen.
    const fnStart = src.indexOf("export default function CollectionDetailsScreen");
    assert.ok(fnStart >= 0, "CollectionDetailsScreen export must exist");
    const body = src.slice(fnStart);

    const earliestEarlyReturn = Math.min(
      ...["if (loadingRemote && !collection)", "if (!collection)"]
        .map((needle) => body.indexOf(needle))
        .filter((i) => i >= 0),
    );
    assert.ok(
      Number.isFinite(earliestEarlyReturn) && earliestEarlyReturn > 0,
      "expected at least one early-return branch in CollectionDetailsScreen",
    );

    // Match every hook call site (useState, useEffect, useMemo, useCallback,
    // useRef, useChunkedList, useAuth, useCollections, useSocial, useI18n,
    // useToast, useLocalSearchParams).
    const hookCallSites = offsetsOf(body, /\buse[A-Z][a-zA-Z]*\s*</g)
      .concat(offsetsOf(body, /\buse[A-Z][a-zA-Z]*\s*\(/g));

    assert.ok(hookCallSites.length > 0, "expected at least one hook call in the body");

    for (const offset of hookCallSites) {
      assert.ok(
        offset < earliestEarlyReturn,
        `hook call at body offset ${offset} appears AFTER the early return at ${earliestEarlyReturn} — ` +
          "this re-introduces the 'Rendered more hooks than during the previous render' crash",
      );
    }
  });

  it("toggleSelect and renderSelectableRow are still wired together via dep arrays", () => {
    // Hoisting them must not break the original referential-stability contract.
    assert.match(src, /const\s+toggleSelect\s*=\s*useCallback/);
    assert.match(src, /const\s+renderSelectableRow\s*=\s*useCallback/);
    assert.match(src, /\[selectedIds,\s*toggleSelect\]/);
  });
});
