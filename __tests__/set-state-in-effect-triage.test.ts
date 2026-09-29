/**
 * The triage, held against the tree it describes.
 *
 * A list of "sites I looked at" is the kind of document that is true on the
 * day it is written and quietly false a week later: a line moves, a file is
 * rewritten, a verdict goes on describing code nobody has. `lib/set-state-in-
 * effect-triage.ts` keys every entry to the CALL as the file spells it rather
 * than to a line number, and these cases are what makes that key worth having.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SET_STATE_IN_EFFECT_SITES,
  SET_STATE_IN_EFFECT_TOTAL,
  triageProblems,
  verdictCounts,
} from "@/lib/set-state-in-effect-triage";

import { readRepoFile } from "./helpers/repo-file";

describe("the set-state-in-effect triage", () => {
  it("still describes lines that are in the tree", () => {
    // The whole point of the registry. A `gone` here is not a broken test, it
    // is a verdict that has stopped being about anything — re-read the site
    // and re-decide, do not re-word the entry.
    assert.deepEqual(
      triageProblems(readRepoFile).map((p) => p.message),
      [],
    );
  });

  it("covers every finding the linter reported, once each", () => {
    assert.equal(SET_STATE_IN_EFFECT_SITES.length, SET_STATE_IN_EFFECT_TOTAL);
    const keys = SET_STATE_IN_EFFECT_SITES.map((s) => `${s.file}::${s.call}`);
    assert.equal(new Set(keys).size, keys.length, "no site may be registered twice");
  });

  it("decided all 31: 27 keep, 3 open, 1 fixed", () => {
    // The numbers are in the module header and in `.tasks/.tasks.md`, so they
    // are asserted rather than restated. A verdict that moves without the
    // sentences moving is the drift this catches — and one has moved:
    // use-chunked-list's page reset went from open to keep on 2026-09-29 when
    // `lint:chunked-items` started holding its callers to the contract the
    // effect depends on.
    assert.deepEqual(verdictCounts(), { keep: 27, open: 3, fixed: 1 });
  });

  it("gives every site a reason of its own", () => {
    // A registry where half the entries say "same as above" is a list of
    // filenames. Each `why` is the sentence that would be written in a review.
    for (const site of SET_STATE_IN_EFFECT_SITES) {
      assert.ok(site.why.length > 40, `${site.file} (${site.call}) needs a real reason`);
      assert.ok(site.call.length > 0);
    }
  });

  it("names an occurrence exactly where the call is not unique", () => {
    // Six entries carry one and twenty-five do not, and the split is not a
    // style choice: an index on a call that appears once is noise that will
    // be wrong the first time an unrelated line is added above it, and a
    // missing index on a call that appears twice is the entry matching
    // whichever one comes first.
    const indexed = SET_STATE_IN_EFFECT_SITES.filter((s) => s.occurrence !== undefined);
    assert.equal(indexed.length, 6);
    for (const site of indexed) {
      const hits = readRepoFile(site.file).split(site.call).length - 1;
      assert.ok(hits > 1, `${site.file} spells \`${site.call}\` once — the occurrence index is noise`);
    }
    for (const site of SET_STATE_IN_EFFECT_SITES) {
      if (site.occurrence !== undefined) continue;
      const hits = readRepoFile(site.file).split(site.call).length - 1;
      assert.equal(hits, 1, `${site.file} spells \`${site.call}\` ${hits} times — it needs an occurrence`);
    }
  });

  it("names the one that was a bug, and it is the one with the self-feeding dependency", () => {
    const fixed = SET_STATE_IN_EFFECT_SITES.filter((s) => s.verdict === "fixed");
    assert.equal(fixed.length, 1);
    assert.equal(fixed[0].file, "app/listing/[id].tsx");
    assert.equal(fixed[0].shape, "self-feeding-dep");
    assert.equal(
      SET_STATE_IN_EFFECT_SITES.filter((s) => s.shape === "self-feeding-dep").length,
      1,
      "a second self-feeding dependency is a second bug, not a second entry",
    );
  });

  it("does not call anything `keep` that feeds its own dependency list", () => {
    // The rule the reading actually produced: a loading flag is fine, and a
    // loading flag in the deps of the effect that sets it is the loop. This
    // holds the registry to that rather than to a filename list.
    for (const site of SET_STATE_IN_EFFECT_SITES) {
      if (site.shape === "self-feeding-dep") assert.notEqual(site.verdict, "keep");
    }
  });
});

describe("the bug the triage found", () => {
  const src = readRepoFile("app/listing/[id].tsx");

  it("asks the cloud once per listing id, not once per render", () => {
    // The loop: guarded on `fetchingRemote`, with `fetchingRemote` in the
    // effect's dependency list. Set true → re-run → bail; the fetch resolves
    // `null` for a listing that does not exist → set false → re-run → still
    // missing → ask again. One network round trip per turn, forever, on any
    // shared link to something since deleted.
    assert.match(src, /askedForRef\.current === listingId\) return;/);
    assert.match(src, /askedForRef\.current = listingId;/);
    assert.match(
      src,
      /\}, \[listing, listingId, fetchListingById\]\);/,
      "the flag must be out of the dependency list of the effect that sets it",
    );
  });

  it("keys the guard by id so a second listing in the same mount still loads", () => {
    // A boolean "already asked" would strand the screen on an empty state
    // after an in-place navigation, which is the obvious wrong fix.
    assert.match(src, /const askedForRef = useRef<string \| null>\(null\);/);
  });

  it("calls every hook before the screen can return early", () => {
    // Found in the same read and a separate bug: `priceHistory` and
    // `performClaim` sat BELOW `if (!listing)`, so the render after a
    // deep-linked fetch landed ran two more hooks than the render before it.
    // React throws on that. The early return stays; the hooks moved above it.
    const guard = src.indexOf("  if (!listing) {");
    assert.ok(guard > 0, "the early return must still be there");
    const after = src.slice(guard);
    for (const hook of ["useMemo(", "useCallback(", "useState(", "useRef(", "useEffect("]) {
      assert.ok(!after.includes(hook), `no ${hook} may be called after the early return`);
    }
  });
});
