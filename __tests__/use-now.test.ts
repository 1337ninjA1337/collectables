import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveInterval, USE_NOW_DEFAULT_TICK_MS } from "@/lib/use-now";

/**
 * `useNow` exposes a `Date.now()` snapshot that re-emits on a fixed cadence
 * so relative-time labels like "1 minute ago" automatically tick over to
 * "2 minutes ago" without a parent re-render. The hook itself uses React's
 * `useState` + `useEffect` and can't run under node-tests (no React
 * renderer wired in this repo); we cover the pure `resolveInterval` clamp
 * behaviourally and the hook structurally.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("resolveInterval (pure clamp)", () => {
  it("returns the input when it's a positive finite number", () => {
    assert.equal(resolveInterval(1000), 1000);
    assert.equal(resolveInterval(30_000), 30_000);
  });

  it("falls back to the default tick for non-finite / non-positive overrides", () => {
    // A caller passing Infinity / NaN / 0 / negative would otherwise either
    // crash setInterval (Infinity), spin the event loop (0), or behave
    // unpredictably (NaN). The clamp returns the default in every case.
    assert.equal(resolveInterval(Number.POSITIVE_INFINITY), USE_NOW_DEFAULT_TICK_MS);
    assert.equal(resolveInterval(Number.NaN), USE_NOW_DEFAULT_TICK_MS);
    assert.equal(resolveInterval(0), USE_NOW_DEFAULT_TICK_MS);
    assert.equal(resolveInterval(-1), USE_NOW_DEFAULT_TICK_MS);
  });

  it("the default tick is 60 seconds (once per minute)", () => {
    // A relative-time label only changes at minute boundaries (under an
    // hour) so 60s is the natural cadence. Faster ticks waste CPU; slower
    // makes the label visibly stale.
    assert.equal(USE_NOW_DEFAULT_TICK_MS, 60_000);
  });
});

describe("useNow hook contract (structural)", () => {
  const src = read("lib/use-now.ts");

  it("uses useState + useEffect from react", () => {
    assert.match(src, /import\s*\{[^}]*\buseEffect\b[^}]*\buseState\b[^}]*\}\s*from\s*"react"/);
  });

  it("seeds the state with Date.now() lazily (function form, not eager)", () => {
    // The lazy initializer matters: `useState(Date.now())` evaluates
    // `Date.now()` on every render even though only the first is used.
    // `useState(() => Date.now())` runs the initializer once.
    assert.match(src, /useState<number>\(\s*\(\s*\)\s*=>\s*Date\.now\(\)\s*\)/);
  });

  it("registers setInterval inside useEffect with a clearInterval cleanup", () => {
    assert.match(
      src,
      /useEffect\([\s\S]*?setInterval\([\s\S]*?\)\s*;\s*\n\s*return\s*\(\s*\)\s*=>\s*clearInterval/,
    );
  });

  it("passes the resolved interval (via resolveInterval) into setInterval", () => {
    // Otherwise a caller passing Infinity / 0 would crash or spin the
    // event loop — the whole point of the clamp.
    assert.match(src, /setInterval\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\},\s*safeInterval\s*\)/);
    assert.match(src, /resolveInterval\(intervalMs\)/);
  });

  it("re-creates the interval when the caller changes intervalMs (dep array)", () => {
    assert.match(
      src,
      /useEffect\([\s\S]*?\},\s*\[\s*intervalMs\s*\]\s*\)/,
    );
  });
});
