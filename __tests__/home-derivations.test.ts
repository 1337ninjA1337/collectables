import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * What the home screen rebuilds on every render, and what it stopped
 * rebuilding.
 *
 * `ownedCollections` was memoised on 2026-09-10 because a ref had to point at
 * a stable array; the three derivations beside it were flagged in the same
 * round and left alone, since none of them was blocking anything. That is the
 * shape of a performance note that never gets done — it is nobody's bug until
 * somebody's list is long.
 *
 * The one that is actually worth a hook is `friendCollections`. It built a
 * `Set` AND filtered the whole collection list, and inside that filter it
 * scanned `friends` with `.includes` once per row: the cost was friends ×
 * collections, on a screen that re-renders on every tab swipe, every pull to
 * refresh, and every keystroke anywhere in the provider tree above it.
 *
 * `myProfile` is deliberately NOT memoised and the comment beside it says why,
 * which is what this file pins: `getMyProfile` is built inside the context
 * value object, so a memo keyed on it would recompute on exactly the renders
 * it already does. A rule that just counted un-memoised derivations would
 * demand that one too, and be wrong.
 *
 * Structural, because `app/index.tsx` pulls expo-router and react-native —
 * the same shape `keyboard-reorder-actions.test.ts` uses for this screen.
 */

const SRC = readRepoFile("app/index.tsx");
const CODE = stripComments(SRC);

/**
 * The dep array of a named `useMemo`, as a SET of names.
 *
 * The first version of this file matched `}, [collections,
 * sharedWithMeCollections, friends]);` as a literal, which asks a question
 * about formatting: reordering the deps is a no-op for React and turned the
 * suite red, while adding a fourth dep passed silently if it happened to land
 * elsewhere in the file. What matters is WHICH names the memo re-runs on, so
 * that is what this reads.
 */
function depsOf(name: string): Set<string> {
  const start = CODE.indexOf(`const ${name} = useMemo(`);
  assert.ok(start > 0, `${name} must be a useMemo in app/index.tsx`);
  const close = CODE.indexOf("}, [", start);
  assert.ok(close > start, `${name}'s dep array must follow its body`);
  const end = CODE.indexOf("]", close);
  return new Set(
    CODE.slice(close + "}, [".length, end)
      .split(",")
      .map((dep) => dep.trim())
      .filter(Boolean),
  );
}

describe("the home screen's friend-collection list", () => {
  it("is derived once per input rather than once per render", () => {
    assert.match(CODE, /const friendCollections = useMemo\(/);
  });

  it("depends on exactly the three lists it reads", () => {
    assert.deepEqual(
      depsOf("friendCollections"),
      new Set(["collections", "sharedWithMeCollections", "friendIds"]),
    );
  });

  it("is declared above the early return, or it is a conditional hook", () => {
    // `if (!ready)` returns a skeleton, and a hook below it runs on some
    // renders and not others — which React treats as a different component.
    const memo = CODE.indexOf("const friendCollections = useMemo(");
    const early = CODE.indexOf("if (!ready)");
    assert.ok(memo > 0 && early > 0, "both anchors must be present");
    assert.ok(memo < early, "the memo must be declared above the early return");
  });

  it("asks a Set whether somebody is a friend, not an array", () => {
    // `friends.includes(collection.ownerUserId)` ran once per collection. A
    // user with forty friends and two hundred visible collections paid eight
    // thousand string comparisons for one render of a list that changes when
    // somebody accepts a friend request.
    assert.match(CODE, /friendIds\.has\(collection\.ownerUserId\)/);
    assert.doesNotMatch(CODE, /friends\.includes\(/);
  });

  it("takes the Set from the context rather than building its own", () => {
    // The screen used to do `new Set(friends)` inside the memo, and so did
    // every other consumer that noticed the scan. One Set per caller of a list
    // that changes when somebody accepts a friend request is the thing
    // `friendIds` retires; a local rebuild here would quietly bring it back.
    assert.match(CODE, /const \{[^}]*\bfriendIds\b[^}]*\} = useSocial\(\);/);
    assert.doesNotMatch(CODE, /new Set\(friends\)/);
  });

  it("keeps the shared-with-me ids inside the memo that is its only reader", () => {
    // It was a screen-level `const` with one consumer, rebuilt every render
    // beside the filter that used it.
    const memo = CODE.slice(CODE.indexOf("const friendCollections = useMemo("));
    assert.match(
      memo.slice(0, memo.indexOf("}, [")),
      /const sharedWithMeIds = new Set\(/,
    );
  });
});

describe("the home screen's profile lookup", () => {
  it("is left un-memoised on purpose, and says so", () => {
    // The honest half of the sweep. `getMyProfile` is rebuilt with the context
    // value, so a memo keyed on it recomputes whenever that value changes —
    // which is every render this screen was doing the work on anyway.
    assert.match(CODE, /const myProfile = getMyProfile\(\);/);
    assert.doesNotMatch(CODE, /myProfile = useMemo\(/);
    assert.match(
      SRC,
      /Not memoised, deliberately/,
      "an un-memoised derivation beside two memoised ones needs a reason written down",
    );
  });
});
