import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/strip-comments";
import {
  CHUNK_PAGE_SIZE_CARDS,
  CHUNK_PAGE_SIZE_ROWS,
  clampCount,
  DEFAULT_CHUNK_PAGE_SIZE,
} from "@/lib/use-chunked-list";

import { readRepoFile } from "./helpers/repo-file";

/**
 * Page size is a property of the ROW, not of the hook.
 *
 * All five windows took the default 20 for as long as the hook existed,
 * across rows that differ by an order of magnitude in what they mount: a
 * collection card with a full-bleed remote cover against an archive row with a
 * 56px thumbnail and two lines of text. One number was doing five jobs, and
 * `DEFAULT_CHUNK_PAGE_SIZE` existed to be overridden with nothing overriding
 * it — carried as a suggestion since the load-more rounds.
 *
 * **The numbers are argued, not measured, and the cases say so.** Nobody has
 * profiled either row on a device; 12 and 40 come from what the rows CONTAIN.
 * What is defensible is the split — one number could not be right for both —
 * and the shape that makes a measured answer possible later.
 */

/** Every call site, and which of the two shapes its rows are. */
const WINDOWS: ReadonlyArray<{ file: string; call: RegExp; size: string }> = [
  {
    file: "app/collection/[id].tsx",
    call: /useChunkedList\(items, CHUNK_PAGE_SIZE_CARDS\)/,
    size: "CHUNK_PAGE_SIZE_CARDS",
  },
  {
    file: "app/index.tsx",
    call: /useChunkedList\(friendCollections, CHUNK_PAGE_SIZE_CARDS\)/,
    size: "CHUNK_PAGE_SIZE_CARDS",
  },
  {
    file: "app/index.tsx",
    call: /useChunkedList\(subscribedCollections, CHUNK_PAGE_SIZE_CARDS\)/,
    size: "CHUNK_PAGE_SIZE_CARDS",
  },
  {
    file: "app/wishlist.tsx",
    call: /useChunkedList\(wishlistItems, CHUNK_PAGE_SIZE_ROWS\)/,
    size: "CHUNK_PAGE_SIZE_ROWS",
  },
  {
    file: "app/archive.tsx",
    call: /useChunkedList\(archivedItems, CHUNK_PAGE_SIZE_ROWS\)/,
    size: "CHUNK_PAGE_SIZE_ROWS",
  },
];

describe("the two sizes", () => {
  it("are ordered by what the row mounts", () => {
    // A card page has to be smaller than a row page or the split says nothing:
    // the whole claim is that a remote cover costs more than a 56px thumb.
    assert.ok(
      CHUNK_PAGE_SIZE_CARDS < CHUNK_PAGE_SIZE_ROWS,
      "the expensive row has the larger page, which inverts the argument",
    );
  });

  it("are both whole pages the hook will accept", () => {
    // `resolvePageSize` falls back to the default for a non-positive or
    // non-integer size, which would silently undo the split.
    for (const size of [CHUNK_PAGE_SIZE_CARDS, CHUNK_PAGE_SIZE_ROWS]) {
      assert.ok(Number.isInteger(size) && size > 0);
      assert.equal(clampCount(size, size, size * 2), size);
    }
  });

  it("leave the shared default alone", () => {
    // It is still the hook's own fallback and still exported, because a sixth
    // window whose row shape nobody has decided about should get a working
    // default rather than a guess dressed as a decision.
    assert.equal(DEFAULT_CHUNK_PAGE_SIZE, 20);
  });

  it("bracket it, which is what says one number could not be right", () => {
    assert.ok(CHUNK_PAGE_SIZE_CARDS < DEFAULT_CHUNK_PAGE_SIZE);
    assert.ok(CHUNK_PAGE_SIZE_ROWS > DEFAULT_CHUNK_PAGE_SIZE);
  });
});

describe("every window names its size", () => {
  for (const { file, call, size } of WINDOWS) {
    it(`${file} passes ${size}`, () => {
      assert.match(stripComments(readRepoFile(file)), call);
    });
  }

  it("no window takes the bare default any more", () => {
    // The export existed to be overridden and nothing overrode it for as long
    // as the hook existed. This is the case that keeps the sixth call site
    // from quietly re-establishing that.
    for (const file of new Set(WINDOWS.map((w) => w.file))) {
      const SRC = stripComments(readRepoFile(file));
      const bare = SRC.match(/useChunkedList\([A-Za-z]+\)/g) ?? [];
      assert.deepEqual(bare, [], `${file} still has a window with no page size: ${bare.join(", ")}`);
    }
  });
});

describe("the hook still documents what the sizes are for", () => {
  const SRC = readRepoFile("lib/use-chunked-list.ts");

  it("says the numbers are argued rather than measured", () => {
    // The honest half. A reader who takes 12 and 40 for profiler output would
    // be reluctant to change them, which is the opposite of what this split
    // is for.
    assert.match(SRC, /argued from what the rows CONTAIN/);
    assert.match(SRC, /not from a\n \* stopwatch/);
  });

  it("names the rows each size is about", () => {
    assert.match(SRC, /remote cover/);
    assert.match(SRC, /56px thumbnail/);
  });
});
