import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchSettled, fetchSettledRows } from "@/lib/fan-out";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * Six fan-outs, and one failed request used to discard the other five.
 *
 * `Promise.all(list.map(fetchOne))` rejects on the FIRST rejection, so a
 * collection deleted between the list and the fetch, a permissions change, or
 * one dropped connection on request nine of ten threw away the nine answers
 * that had arrived. Every call site wrapped that in a `catch` that swallowed
 * the error, so what the user saw was a screen of zeros — and the app had the
 * real numbers in hand when it dropped them.
 *
 * Partial is right here because every caller is a cache fill: the app reads
 * from AsyncStorage and these fetches top it up, so nine collections' items
 * beat none and the tenth arrives on the next refresh.
 */

const fail = (message: string) => Promise.reject(new Error(message));

describe("fetchSettled", () => {
  it("returns every answer when nothing fails", async () => {
    const results = await fetchSettled([1, 2, 3], async (n) => n * 10);

    assert.deepEqual(results, [10, 20, 30]);
  });

  it("keeps the answers that arrived when one request rejects", async () => {
    // The whole point. `Promise.all` would have thrown away 1 and 3.
    const results = await fetchSettled([1, 2, 3], async (n) =>
      n === 2 ? fail("boom") : n * 10,
    );

    assert.deepEqual(results, [10, 30]);
  });

  it("does not reject, even when every request does", async () => {
    // A caller's `.catch(() => {})` was doing the work of hiding a total loss.
    // There is no total loss to hide, so this resolves empty rather than
    // throwing into a catch that would look like it handled something.
    const results = await fetchSettled([1, 2], () => fail("boom"));

    assert.deepEqual(results, []);
  });

  it("preserves input order regardless of which request settles first", async () => {
    // The results are pushed in the order `allSettled` reports them, which is
    // input order — not completion order. A caller indexing the result against
    // its input list (as the item fan-outs do) depends on this.
    const delays = new Map([[1, 20], [2, 0], [3, 10]]);
    const results = await fetchSettled([1, 2, 3], async (n) => {
      await new Promise((resolve) => setTimeout(resolve, delays.get(n)));
      return n;
    });

    assert.deepEqual(results, [1, 2, 3]);
  });

  it("answers an empty input with an empty result and no requests", async () => {
    let calls = 0;
    const results = await fetchSettled([], async () => { calls += 1; return 1; });

    assert.deepEqual(results, []);
    assert.equal(calls, 0);
  });

  it("hands the fetcher only the input, never the index", async () => {
    // `inputs.map(fetchOne)` would pass (value, index, array). A `fetchOne`
    // whose second parameter is an options object would silently be handed a
    // number, which is the kind of bug that works fine on the first element.
    const seen: unknown[][] = [];
    await fetchSettled(["a", "b"], async (...args: unknown[]) => {
      seen.push(args);
      return null;
    });

    assert.deepEqual(seen, [["a"], ["b"]]);
  });

  it("starts every request before awaiting, rather than serialising them", async () => {
    // `map` then one await: the requests overlap. A `for … await` rewrite would
    // pass every case above and turn ten parallel fetches into ten round trips
    // one after another.
    let running = 0;
    let peak = 0;
    await fetchSettled([1, 2, 3, 4], async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return null;
    });

    assert.equal(peak, 4);
  });
});

describe("fetchSettledRows", () => {
  it("flattens each answer's list into one", async () => {
    const rows = await fetchSettledRows([1, 2], async (n) => [n, n * 100]);

    assert.deepEqual(rows, [1, 100, 2, 200]);
  });

  it("drops a failed request's rows and keeps the rest", async () => {
    const rows = await fetchSettledRows(["a", "b", "c"], async (k) =>
      k === "b" ? fail("boom") : [k],
    );

    assert.deepEqual(rows, ["a", "c"]);
  });

  it("flattens exactly one level", async () => {
    // The callers fetch lists of rows, not lists of lists. A deep flatten would
    // quietly change what a nested payload turns into.
    const rows = await fetchSettledRows([1], async () => [[1, 2], [3]]);

    assert.deepEqual(rows, [[1, 2], [3]]);
  });

  it("skips an empty answer without leaving a hole", async () => {
    const rows = await fetchSettledRows([1, 2, 3], async (n) => (n === 2 ? [] : [n]));

    assert.deepEqual(rows, [1, 3]);
  });
});

describe("every fan-out in the app goes through it", () => {
  const CONTEXT = stripComments(readRepoFile("lib/collections-context.tsx"));
  const PROFILE = stripComments(readRepoFile("app/profile/[id].tsx"));

  it("the provider's six fan-outs are settled ones", () => {
    const settled = CONTEXT.match(/fetchSettled(Rows)?\(/g) ?? [];
    assert.equal(
      settled.length,
      6,
      "the hydrate bootstrap, the subscribed collections and their items, the friends' collections and their items, and the shared-with-me items",
    );
  });

  it("no fan-out over a collection list is a Promise.all any more", () => {
    // `Promise.all` survives in the provider over FIXED tuples — three storage
    // reads, a cursor pair — where there is nothing to partially lose and the
    // caller genuinely needs all of them. What is gone is the shape that maps
    // a list of rows to a request each.
    assert.doesNotMatch(CONTEXT, /Promise\.all\(\s*\w+\.map\(/);
    assert.doesNotMatch(PROFILE, /Promise\.all\(\s*\w+\.map\(/);
  });

  it("the profile screen's counts survive one collection failing", () => {
    assert.match(PROFILE, /const results = await fetchSettled\(cols, \(c\) =>/);
  });

  it("the profile screen's pull-to-refresh checks it is still mounted", () => {
    // `loadItemCounts` takes an `isActive` and the refresh path took the
    // `() => true` default, so a slow refresh wrote state onto a screen the
    // user had left. The focus effect passes its own `active` flag.
    assert.match(PROFILE, /await loadItemCounts\(cols, \(\) => mountedRef\.current\);/);
    assert.match(PROFILE, /return \(\) => \{ mountedRef\.current = false; \};/);
  });
});
