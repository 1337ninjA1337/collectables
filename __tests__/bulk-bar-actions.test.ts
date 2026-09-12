import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BulkBarProps } from "@/components/bulk-bar";
import { readRepoFile } from "./helpers/repo-file";

/**
 * `<BulkBar>`'s four actions became optional when the archive screen mounted
 * the second copy of it, and that is what makes the bar's contract statable
 * by omission — Restore and nothing else, deliberately no "delete all". It
 * also made `<BulkBar count={n} onCancel={f} />` a legal call: a selection
 * count floating over a row that holds only Cancel, which is a selection mode
 * a user can enter and cannot resolve.
 *
 * The cases below are in two halves, and the halves catch different things.
 * The TYPE half is the enforcement: each `@ts-expect-error` is an assertion
 * the compiler makes on every `npm run typecheck`, and it goes red in BOTH
 * directions — if the union ever stops rejecting an action-less bar, the
 * suppression becomes unused and tsc fails on the comment itself. The SOURCE
 * half sweeps the real call sites, because a type says what is expressible
 * and not what the two screens actually pass.
 */

const noop = () => {};

// tsc checks this file (tsconfig includes `**/*.ts`), so the declarations
// below are the cases — the runtime assertions only keep the bindings used.
describe("BulkBar — at least one action", () => {
  it("rejects a bar with a count, a cancel and nothing to do", () => {
    // @ts-expect-error — a bar with no action is a count over an empty button row.
    const actionless: BulkBarProps = { count: 3, onCancel: noop };
    assert.equal(actionless.count, 3);
  });

  it("rejects a bar whose only action is explicitly undefined", () => {
    // The shape a screen reaches by spreading a half-built props object, and
    // the one an `onRestore?: () => void` alone would have accepted.
    // @ts-expect-error — an absent action and an undefined one are the same bar.
    const undefinedAction: BulkBarProps = { count: 3, onRestore: undefined, onCancel: noop };
    assert.equal(undefinedAction.count, 3);
  });

  it("accepts each of the four actions on its own", () => {
    const restore: BulkBarProps = { count: 1, onRestore: noop, onCancel: noop };
    const move: BulkBarProps = { count: 1, onMove: noop, onCancel: noop };
    const archive: BulkBarProps = { count: 1, onArchive: noop, onCancel: noop };
    const remove: BulkBarProps = { count: 1, onDelete: noop, onCancel: noop };
    // Each of the four is a union member in its own right, so the check does
    // not quietly become "Restore or bust".
    assert.deepEqual([restore.count, move.count, archive.count, remove.count], [1, 1, 1, 1]);
  });

  it("accepts the combinations the two screens use, and all four together", () => {
    const archiveScreen: BulkBarProps = { count: 2, onRestore: noop, onCancel: noop };
    const collectionScreen: BulkBarProps = {
      count: 2,
      onMove: noop,
      onArchive: noop,
      onDelete: noop,
      onCancel: noop,
    };
    const everything: BulkBarProps = {
      count: 2,
      onRestore: noop,
      onMove: noop,
      onArchive: noop,
      onDelete: noop,
      onCancel: noop,
    };
    assert.deepEqual([archiveScreen.count, collectionScreen.count, everything.count], [2, 2, 2]);
  });

  it("still requires onCancel, which is the way out of selection mode", () => {
    // @ts-expect-error — a bar you cannot leave.
    const uncancellable: BulkBarProps = { count: 3, onDelete: noop };
    assert.equal(uncancellable.count, 3);
  });

  it("the props type is exported under a name, so call sites can be typed", () => {
    const src = readRepoFile("components/bulk-bar.tsx");
    assert.match(src, /export\s+type\s+BulkBarProps\s*=/);
    assert.doesNotMatch(
      src,
      /\btype\s+Props\s*=/,
      "the old unexported `Props` must be gone: a local name cannot be asserted against from a suite",
    );
    assert.match(src, /}\s*:\s*BulkBarProps\s*\)/, "the component must annotate with the exported type");
  });

  it("the requirement is a union over the actions rather than four hand-written variants", () => {
    const src = readRepoFile("components/bulk-bar.tsx");
    // A mapped union names no screen, so a third one offering Move and
    // Archive costs nothing here. Four written-out members would have to be
    // edited by whoever adds a fifth action.
    assert.match(src, /type\s+AtLeastOneAction\s*=\s*\{[\s\S]*?\[K in keyof BulkBarActions\]-\?:/);
    assert.match(src, /\}\[keyof BulkBarActions\];/);
  });

  it("every call site in the tree passes at least one action", () => {
    // The type half covers callers tsc reads; this one is the sweep, and it
    // is what says the two screens agree with the contract today.
    const screens = ["app/archive.tsx", "app/collection/[id].tsx"];
    const sites = screens.flatMap((path) => {
      const src = readRepoFile(path);
      // `count=` anchors the match to a real call site: both files also name
      // `<BulkBar>` in prose, and a bare tag match runs from a comment to
      // whatever self-closing tag comes next.
      return [...src.matchAll(/<BulkBar\s+count=[\s\S]*?\/>/g)].map((m) => ({ path, site: m[0] }));
    });
    assert.equal(sites.length, 2, "expected exactly the two <BulkBar> call sites");
    for (const { path, site } of sites) {
      const actions = ["onRestore", "onMove", "onArchive", "onDelete"].filter((name) =>
        site.includes(`${name}=`),
      );
      assert.ok(actions.length > 0, `${path} mounts <BulkBar> with no action`);
      assert.match(site, /onCancel=/, `${path} mounts <BulkBar> with no way out`);
    }
  });

  it("the doc block says the bar refuses to be handed none", () => {
    // The paragraph said "every action is optional" for as long as that was
    // the whole truth, and a reader who stops at it would write the call the
    // union now rejects.
    const src = readRepoFile("components/bulk-bar.tsx");
    const block = src.slice(0, src.indexOf("type BulkBarActions"));
    assert.match(block, /at least one is not/);
  });
});
