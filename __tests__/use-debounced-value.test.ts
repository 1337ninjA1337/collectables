import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/env-inlining";
import {
  DEFAULT_DEBOUNCE_MS,
  PROFILE_SEARCH_DEBOUNCE_MS,
  commitDebouncedValue,
  isImmediateDelay,
  resolveDebounceDelay,
} from "@/lib/debounce-helpers";

/**
 * `lib/use-debounced-value.ts` is the shared trailing-edge debounce that
 * replaced two hand-rolled `setTimeout(..., 300)` blocks (`app/people.tsx`
 * and `components/search-overlay.tsx`), and is the guard the in-collection
 * search will need when live-as-you-type filtering lands.
 *
 * The pure half (`lib/debounce-helpers.ts`) is exercised directly; the hook
 * itself imports `react` and so is pinned structurally, exactly like
 * `use-share-link.test.ts` — the repo has no React mounting harness (see the
 * `[needs-dev-dep]` tasks in .tasks/.tasks.md).
 */
function readSrc(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const readHookSrc = () => readSrc("lib", "use-debounced-value.ts");
const readHelpersSrc = () => readSrc("lib", "debounce-helpers.ts");

describe("resolveDebounceDelay", () => {
  it("defaults to 150ms when no delay is given", () => {
    assert.equal(resolveDebounceDelay(), DEFAULT_DEBOUNCE_MS);
    assert.equal(resolveDebounceDelay(undefined), 150);
  });

  it("preserves a caller-supplied positive delay", () => {
    assert.equal(resolveDebounceDelay(300), 300);
    assert.equal(resolveDebounceDelay(1), 1);
  });

  it("preserves 0 — an explicit opt-out of debouncing is not a nonsense value", () => {
    assert.equal(resolveDebounceDelay(0), 0);
  });

  it("floors a fractional delay rather than handing setTimeout a non-integer", () => {
    assert.equal(resolveDebounceDelay(150.9), 150);
    assert.equal(resolveDebounceDelay(0.4), 0);
  });

  it("falls back to the default for NaN, Infinity and negatives", () => {
    // Infinity would stall the settle forever; a negative would fire before
    // the value is read. Neither may reach setTimeout.
    assert.equal(resolveDebounceDelay(Number.NaN), DEFAULT_DEBOUNCE_MS);
    assert.equal(resolveDebounceDelay(Number.POSITIVE_INFINITY), DEFAULT_DEBOUNCE_MS);
    assert.equal(resolveDebounceDelay(Number.NEGATIVE_INFINITY), DEFAULT_DEBOUNCE_MS);
    assert.equal(resolveDebounceDelay(-1), DEFAULT_DEBOUNCE_MS);
    assert.equal(resolveDebounceDelay(-0.5), DEFAULT_DEBOUNCE_MS);
  });

  it("treats -0 as the zero it is, not as a negative", () => {
    assert.equal(resolveDebounceDelay(-0), 0);
  });

  it("is idempotent, so the hook can re-resolve an already-resolved delay", () => {
    for (const input of [undefined, 0, 150, 300, Number.NaN, -1, 12.7]) {
      const once = resolveDebounceDelay(input);
      assert.equal(resolveDebounceDelay(once), once, `not idempotent for ${String(input)}`);
    }
  });
});

describe("isImmediateDelay", () => {
  it("is true only for an explicit zero", () => {
    assert.equal(isImmediateDelay(0), true);
    assert.equal(isImmediateDelay(-0), true);
    assert.equal(isImmediateDelay(0.9), true, "floors to 0");
  });

  it("is false for the defaults and for any real delay", () => {
    assert.equal(isImmediateDelay(), false);
    assert.equal(isImmediateDelay(DEFAULT_DEBOUNCE_MS), false);
    assert.equal(isImmediateDelay(PROFILE_SEARCH_DEBOUNCE_MS), false);
    assert.equal(isImmediateDelay(1), false);
  });

  it("is false for nonsense delays — they fall back to the default, not to immediate", () => {
    assert.equal(isImmediateDelay(Number.NaN), false);
    assert.equal(isImmediateDelay(-5), false);
    assert.equal(isImmediateDelay(Number.POSITIVE_INFINITY), false);
  });
});

describe("commitDebouncedValue", () => {
  it("returns the incoming value when it differs", () => {
    assert.equal(commitDebouncedValue("ab", "abc"), "abc");
    assert.equal(commitDebouncedValue(1, 2), 2);
  });

  it("returns the CURRENT reference when the values are the same, so React bails out", () => {
    const current = { query: "penny" };
    assert.equal(commitDebouncedValue(current, current), current);
  });

  it("keeps a distinct-but-equal object as a real change (identity, not deep equality)", () => {
    // The hook debounces by reference; two structurally equal objects are two
    // values, and collapsing them here would silently swallow a real update.
    const next = { query: "penny" };
    assert.equal(commitDebouncedValue({ query: "penny" }, next), next);
  });

  it("settles NaN once instead of on every tick (Object.is, not ===)", () => {
    assert.ok(Object.is(commitDebouncedValue(Number.NaN, Number.NaN), Number.NaN));
    assert.equal(commitDebouncedValue(Number.NaN, Number.NaN), Number.NaN as never);
  });

  it("distinguishes +0 from -0 the way Object.is does", () => {
    assert.ok(Object.is(commitDebouncedValue(0, -0), -0));
  });

  it("handles undefined and null on both sides without throwing", () => {
    assert.equal(commitDebouncedValue<string | undefined>(undefined, undefined), undefined);
    assert.equal(commitDebouncedValue<string | null>(null, "x"), "x");
    assert.equal(commitDebouncedValue<string | null>("x", null), null);
  });
});

describe("debounce delay constants", () => {
  it("keeps the local default at the 150ms the task specified", () => {
    assert.equal(DEFAULT_DEBOUNCE_MS, 150);
  });

  it("keeps the remote-search delay at the 300ms both call sites hand-rolled", () => {
    assert.equal(PROFILE_SEARCH_DEBOUNCE_MS, 300);
  });

  it("keeps the network delay longer than the local one", () => {
    // A settle here is a Supabase round trip, not an in-memory array pass.
    assert.ok(PROFILE_SEARCH_DEBOUNCE_MS > DEFAULT_DEBOUNCE_MS);
  });
});

describe("debounce-helpers — structure", () => {
  it("stays node-importable (no react, no react-native)", () => {
    const code = stripComments(readHelpersSrc());
    assert.doesNotMatch(code, /from "react"/, "the pure half must stay node-importable");
    assert.doesNotMatch(code, /from "react-native"/, "the pure half must stay node-importable");
  });

  it("schedules nothing itself — every timer lives in the hook", () => {
    const code = stripComments(readHelpersSrc());
    assert.doesNotMatch(code, /setTimeout|setInterval/);
  });
});

describe("useDebouncedValue — structure", () => {
  it("exports the hook and re-exports the pure half so consumers need one import", () => {
    const src = readHookSrc();
    assert.match(src, /export function useDebouncedValue<T>\(\s*value: T,\s*delayMs: number = DEFAULT_DEBOUNCE_MS,?\s*\): T/);
    assert.match(src, /from "@\/lib\/debounce-helpers"/);
    for (const name of [
      "DEFAULT_DEBOUNCE_MS",
      "PROFILE_SEARCH_DEBOUNCE_MS",
      "commitDebouncedValue",
      "isImmediateDelay",
      "resolveDebounceDelay",
    ]) {
      assert.match(stripComments(src).split("export function")[0], new RegExp(`\\b${name}\\b`), `missing re-export of ${name}`);
    }
  });

  it("seeds the settled state with the incoming value so first render is not empty", () => {
    assert.match(readHookSrc(), /useState<T>\(value\)/);
  });

  it("clears the pending timer on every re-run and on unmount", () => {
    // The leak this closes: a settle firing into an unmounted tree, and a
    // stale timer surviving a fast follow-up keystroke.
    assert.match(readHookSrc(), /return \(\) => clearTimeout\(timer\);/);
  });

  it("routes the settle through commitDebouncedValue for reference stability", () => {
    assert.match(
      readHookSrc(),
      /setSettled\(\(current\) => commitDebouncedValue\(current, value\)\)/,
    );
  });

  it("takes the no-timer path for a zero delay instead of setTimeout(fn, 0)", () => {
    const src = readHookSrc();
    assert.match(src, /if \(isImmediateDelay\(delay\)\) \{\s*commit\(\);\s*return;\s*\}/);
  });

  it("does NOT list `settled` as an effect dependency", () => {
    // Listing it re-runs the effect on every settle, restarting the timer
    // forever — the classic way a debounce hook turns into an interval.
    const src = stripComments(readHookSrc());
    const deps = src.match(/\}, \[([^\]]*)\]\);/);
    assert.ok(deps, "effect dep array not found");
    assert.equal(deps[1].trim(), "value, delay");
  });

  it("documents the stable-reference requirement for non-primitive values", () => {
    // An object rebuilt inline each render re-arms the effect forever and
    // never settles — the same trap `useChunkedList` documents for `items`.
    assert.match(readHookSrc(), /STABLE reference/);
  });

  it("is only ever handed primitives by its current consumers", () => {
    for (const file of [["app", "people.tsx"], ["components", "search-overlay.tsx"]]) {
      const call = stripComments(readSrc(...file)).match(/useDebouncedValue\(([^,]+),/);
      assert.ok(call, `useDebouncedValue call not found in ${file.join("/")}`);
      assert.doesNotMatch(call[1], /[{[]/, "a fresh object/array literal would never settle");
    }
  });

  it("stays a pure behaviour hook (no navigation, i18n, design tokens or styles)", () => {
    const code = stripComments(readHookSrc());
    for (const forbidden of [/@\/lib\/design-tokens/, /@\/lib\/i18n-context/, /expo-router/, /StyleSheet/, /react-native/]) {
      assert.doesNotMatch(code, forbidden, `${forbidden} does not belong in a behaviour hook`);
    }
  });
});

describe("useDebouncedValue — adoption", () => {
  const CONSUMERS = [
    { file: ["app", "people.tsx"], limit: 50 },
    { file: ["components", "search-overlay.tsx"], limit: 20 },
  ];

  for (const consumer of CONSUMERS) {
    const label = consumer.file.join("/");

    it(`${label} debounces its searchProfiles round trip through the shared hook`, () => {
      const code = stripComments(readSrc(...consumer.file));
      assert.match(code, /import \{ useDebouncedValue \} from "@\/lib\/use-debounced-value";/);
      assert.match(code, /useDebouncedValue\([\s\S]{0,40}PROFILE_SEARCH_DEBOUNCE_MS\)/);
      assert.match(code, new RegExp(`searchProfiles\\(debouncedQuery, ${consumer.limit}\\)`));
    });

    it(`${label} no longer hand-rolls a debounce timer`, () => {
      const code = stripComments(readSrc(...consumer.file));
      assert.doesNotMatch(code, /setTimeout/, "the debounce timer belongs to the hook now");
      assert.doesNotMatch(code, /clearTimeout/);
    });

    it(`${label} imports the shared delay rather than a literal 300`, () => {
      const code = stripComments(readSrc(...consumer.file));
      assert.match(code, /import \{ PROFILE_SEARCH_DEBOUNCE_MS \} from "@\/lib\/debounce-helpers";/);
      assert.doesNotMatch(code, /,\s*300\)/, "the 300ms literal must live in debounce-helpers only");
    });

    it(`${label} still cancels an in-flight response so a late resolve cannot overwrite a newer one`, () => {
      const code = stripComments(readSrc(...consumer.file));
      assert.match(code, /let cancelled = false;/);
      assert.match(code, /if \(!cancelled\) set\w+\(results\);/);
      assert.match(code, /return \(\) => \{\s*cancelled = true;\s*\};/);
    });

    it(`${label} clears its remote matches when the settled query is empty`, () => {
      const code = stripComments(readSrc(...consumer.file));
      assert.match(code, /if \(!debouncedQuery[\s\S]{0,60}\) \{[\s\S]{0,60}\(\[\]\);\s*return;\s*\}/);
    });
  }

  it("is the only debounce implementation left in the app — no stray keystroke timers", () => {
    // A third hand-rolled copy is exactly the drift this hook exists to stop.
    for (const file of [["app", "people.tsx"], ["components", "search-overlay.tsx"]]) {
      assert.doesNotMatch(stripComments(readSrc(...file)), /setTimeout\([\s\S]{0,80}\},\s*\d+\)/);
    }
  });
});

describe("ItemFilterBar — deliberate non-adoption", () => {
  it("does not debounce the draft query that Apply reads directly", () => {
    // Debouncing `draft` would hand `onChange` a stale query to anyone who
    // taps Apply within the debounce window. The hook belongs on the live
    // filtering path when that path exists; the commit path must stay exact.
    const code = stripComments(readSrc("components", "item-filters.tsx"));
    assert.doesNotMatch(code, /useDebouncedValue/);
    assert.match(code, /onChange\(draft\);/);
  });

  it("records that decision in the hook's own docs so it is not re-litigated", () => {
    const src = readHookSrc();
    assert.match(src, /ItemFilterBar/);
    assert.match(src, /stale query/);
  });
});
