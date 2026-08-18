import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Rationale pins for the drag-corruption gate in `app/collection/[id].tsx`.
 *
 * `collection-detail-sort-gate.test.ts` pins the CONDITION
 * (`isOwner && !selectionMode && reorderMode && itemFilters.sort === "default"`).
 * This file pins the EXPLANATION next to it.
 *
 * Why that deserves its own guard: read cold, the sort half of the gate looks
 * like a stylistic choice — "owners can only drag an unsorted list" reads as a
 * product decision a refactor is free to relax. It is not. `onDragEnd` re-writes
 * every item's `sortOrder` from the VISIBLE order, so dragging one row while the
 * list is alphabetically sorted rewrites the user's whole manual ordering into
 * alphabetical order, permanently and with no undo. A contributor who strips the
 * clause as dead code ships silent data loss.
 *
 * A comment is the only thing standing between the two readings, so the comment
 * is load-bearing and gets a test. The assertions check for the CONCEPTS
 * (`sortOrder`, corruption, visible-order) rather than an exact sentence, so
 * rewording stays free while deleting the warning fails.
 */

const SRC = read("app/collection/[id].tsx");

/**
 * Returns the contiguous run of `//` comment lines immediately above the line
 * containing `anchor`. Empty string when the anchor is not preceded by one —
 * which is exactly the regression this file exists to catch.
 */
function commentBlockAbove(src: string, anchor: string | RegExp): string {
  const idx = typeof anchor === "string" ? src.indexOf(anchor) : src.search(anchor);
  assert.ok(idx > 0, `anchor not found in source: ${anchor}`);
  const linesBefore = src.slice(0, idx).split("\n");
  // The anchor's own (partial) line is the last element — drop it.
  linesBefore.pop();
  const block: string[] = [];
  for (let i = linesBefore.length - 1; i >= 0; i -= 1) {
    const line = linesBefore[i].trim();
    if (line.startsWith("//")) {
      block.unshift(line.replace(/^\/\/\s?/, ""));
      continue;
    }
    break;
  }
  return block.join("\n");
}

/** The comment must name the field that gets rewritten. */
const MENTIONS_SORT_ORDER = /sortOrder/;
/** …and the consequence: the manual order is destroyed, not merely ignored. */
const MENTIONS_CORRUPTION = /corrupt|destroy|overwrit|clobber|data loss/i;
/** …and the mechanism: the rewrite reads the order currently on screen. */
const MENTIONS_VISIBLE_ORDER = /visible|alphabetical|on-screen|displayed/i;

function assertExplainsCorruption(block: string, where: string): void {
  assert.ok(block.length > 0, `${where}: no explanatory comment found directly above it`);
  assert.match(block, MENTIONS_SORT_ORDER, `${where}: comment never names \`sortOrder\``);
  assert.match(block, MENTIONS_CORRUPTION, `${where}: comment never states the order is corrupted`);
  assert.match(
    block,
    MENTIONS_VISIBLE_ORDER,
    `${where}: comment never explains the rewrite reads the VISIBLE order`,
  );
}

describe("app/collection/[id].tsx — the drag-corruption gate is explained, not just enforced", () => {
  it("the isDragBranch derivation is preceded by a comment naming sortOrder, corruption and the visible order", () => {
    // The derivation is the line a refactor is most likely to "simplify":
    // four `&&` clauses, one of which (the sort check) has no local evidence
    // for why it is there. The comment above it is that evidence.
    const block = commentBlockAbove(SRC, /const\s+isDragBranch\s*=/);
    assertExplainsCorruption(block, "isDragBranch derivation");
  });

  it("the isDragBranch JSX branch carries its own inline reminder", () => {
    // The derivation and its consumer are ~200 lines apart, so a contributor
    // editing the render tree may never scroll past the derivation's comment.
    // The branch repeats the warning at the point of use.
    const branchIdx = SRC.search(/\)\s*:\s*isDragBranch\s*\?\s*\(/);
    assert.ok(branchIdx > 0, "isDragBranch render branch missing");
    const afterBranch = SRC.slice(branchIdx);
    const inlineComment = afterBranch
      .split("\n")
      .slice(1)
      .reduce<string[]>((acc, line) => {
        const trimmed = line.trim();
        // Stop at the first non-comment line — the comment must sit directly
        // under the branch opener, not somewhere later in the subtree.
        if (acc.length > 0 && !trimmed.startsWith("//")) return acc;
        if (trimmed.startsWith("//")) acc.push(trimmed.replace(/^\/\/\s?/, ""));
        else if (acc.length === 0) acc.push("");
        return acc;
      }, [])
      .join("\n");
    assertExplainsCorruption(inlineComment, "isDragBranch render branch");
  });

  it("the onDragEnd handler explains why the unrendered tail is appended", () => {
    // Second corruption class, same handler: the drag operates on the paginated
    // WINDOW, so writing back only `data` would renumber the visible slice to
    // 0..N-1 and shuffle it past everything below the page boundary.
    const block = commentBlockAbove(SRC, /const\s+visibleIds\s*=\s*new\s+Set\(/);
    assert.ok(block.length > 0, "onDragEnd tail-append has no explanatory comment");
    assert.match(
      block,
      /tail|unrendered|below the page|boundary/i,
      "onDragEnd comment never explains the unrendered tail",
    );
    assert.match(
      block,
      MENTIONS_SORT_ORDER,
      "onDragEnd comment never names the `sortOrder` renumbering",
    );
  });

  it("the reorderBlockedBySort notice explains that it mirrors the gate", () => {
    // The user-facing half of the same rule. Its comment is what stops someone
    // from "fixing" the notice by making reorder mode work while sorted.
    const block = commentBlockAbove(SRC, /const\s+reorderBlockedBySort\s*=/);
    assert.ok(block.length > 0, "reorderBlockedBySort has no explanatory comment");
    assert.match(
      block,
      /isDragBranch/,
      "reorderBlockedBySort comment never points at the `isDragBranch` gate it mirrors",
    );
    assert.match(block, MENTIONS_SORT_ORDER, "reorderBlockedBySort comment never names `sortOrder`");
    assert.match(
      block,
      MENTIONS_CORRUPTION,
      "reorderBlockedBySort comment never states the manual order would be corrupted",
    );
  });

  it("every mention of the gate is a real comment, never a bare string literal", () => {
    // Guards against a lazy 'fix' to this suite: pasting the keywords into a
    // string or a JSX label to make the greps pass. Each `sortOrder` mention in
    // a corruption sentence must live on a `//` line.
    const offending = SRC.split("\n")
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(
        ({ line }) =>
          MENTIONS_CORRUPTION.test(line) && !line.startsWith("//") && !line.startsWith("*"),
      );
    assert.deepEqual(
      offending,
      [],
      `corruption wording found outside a comment: ${offending.map((o) => `L${o.no}`).join(", ")}`,
    );
  });
});
