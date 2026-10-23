import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * `app/friends.tsx`, read for the first time.
 *
 * It was named as unread in three suggestion rounds while the people screen,
 * the search sheet and the social provider were read four times between them.
 * Reading it found both of the defects those surfaces had already had fixed —
 * a load flag that could stay set, and a developer tripwire that takes the
 * screen down with nothing recorded — and one the provider owed it: the
 * friends tab counts relationships the provider derives, and those derivations
 * carried profiles an admin had deleted.
 *
 * Source reads rather than a render: this screen reaches expo-router, the chat
 * context, the social context and `SwipeTabs`, and nothing in this tree mounts
 * it. The provider's half IS run — `social-provider-mounted.test.ts` — and
 * each case below names the behaviour it stands in for.
 */
const CODE = stripComments(readRepoFile("app/friends.tsx"));

describe("the skeleton cannot outlive the load it is standing in for", () => {
  // Removing your last friend while its profile fetch was in flight cancelled
  // the `.finally` (the cleanup had already set `active` false) and re-ran the
  // effect into an early `return`, so the flag stayed true: a skeleton with no
  // request behind it, and no empty state to get out of it, on the screen
  // whose empty state is the one that sends you to go and find people.
  it("clears the friends flag on an emptied list, not only on a resolve", () => {
    assert.match(
      CODE,
      /const ids = \[\.\.\.friends, \.\.\.incomingRequestUserIds\];\s*if \(ids\.length === 0\) \{\s*setLoadingFriends\(false\);\s*return;\s*\}/,
    );
  });

  it("clears the following flag the same way, in the same window", () => {
    assert.match(
      CODE,
      /if \(following\.length === 0\) \{\s*setLoadingFollowing\(false\);\s*return;\s*\}/,
    );
  });

  it("still clears both on a resolve and on a reject, behind the cancellation flag", () => {
    // The two paths that already worked, kept honest: a late `.finally` from a
    // superseded run must not clear a flag the current run set.
    assert.equal(
      CODE.split(".finally(() => { if (active) setLoading").length - 1,
      2,
      "one per tab, and neither may lose its `active` guard",
    );
    assert.equal(CODE.split(".catch(() => {})").length - 1, 2);
  });

  it("shows the skeleton only while there is nothing else to show", () => {
    // Rows beat the skeleton, which is the order `app/people.tsx` landed on
    // 2026-10-19: a list that still answers must not be replaced by a
    // skeleton because a refresh is in flight.
    assert.match(
      CODE,
      /loadingFriends && friendProfiles\.length === 0 && requestProfiles\.length === 0 \?/,
    );
    assert.match(CODE, /loadingFollowing && followingProfiles\.length === 0 \?/);
  });
});

describe("the tripwire reports before it fires", () => {
  // `app/people.tsx`' identical `throw` got a `captureException` on 2026-10-19
  // and this one did not. It fires inside an `onAction` during a press: in dev
  // it surfaces loudly, and in production it takes the screen down with
  // nothing recorded anywhere.
  it("captures the follow case before throwing it", () => {
    assert.match(
      CODE,
      /captureException\(new Error\("friends screen has no follow action"\), \{\s*scope: "friends\.runRelationshipAction",\s*extra: \{ action \},\s*\}\);\s*throw new Error\("friends screen has no follow action"\);/,
    );
  });

  it("keeps the throw, because the report is not the point of it", () => {
    // A table edit that gave a tab a button this screen cannot service has to
    // be loud for a developer. The capture is what makes it findable in
    // production too.
    assert.match(CODE, /import \{ captureException \} from "@\/lib\/sentry";/);
    assert.equal(
      CODE.split('throw new Error("friends screen has no follow action")').length - 1,
      1,
      "one throw, reported once — a second of either is a case nobody decided",
    );
    assert.equal(
      CODE.split('captureException(new Error("friends screen has no follow action")').length - 1,
      1,
    );
  });

  it("sends only the closed-set label the allow-list permits", () => {
    // `extra` takes four names, each a member of a union this repo declares —
    // never a value a user or a row supplied. `action` is a
    // `RelationshipActionId`.
    assert.ok(!/extra: \{ (profileId|id|username|email)/.test(CODE), "a user-supplied value in extras");
  });
});

describe("the three lists it renders agree with the counts beside them", () => {
  /**
   * The screen maps ids to profiles and drops what does not resolve, so a
   * tombstoned id is invisible in the LIST and was still counted: the friends
   * tab's "(n)" is `incomingRequestUserIds.length`, and `app/index.tsx` renders
   * `friends.length` and `following.length` as summary numbers. The provider
   * owes the screen lists that cannot contain one — `social-provider-mounted
   * .test.ts` runs that half.
   */
  const PROVIDER = stripComments(readRepoFile("lib/social-context.tsx"));

  it("takes its tab counts from the provider's lists rather than re-deriving", () => {
    assert.match(CODE, /incomingRequestUserIds\.length > 0 \? ` \(\$\{incomingRequestUserIds\.length\}\)` : ""/);
    assert.match(CODE, /dotHighlight=\{incomingRequestUserIds\.length > 0 \? "friends" : undefined\}/);
  });

  it("the provider drops a pair naming a deleted profile before it derives anything", () => {
    assert.match(
      PROVIDER,
      /const pairs = friendRequests\.filter\(\s*\(request\) =>\s*!isProfileDeleted\(request\.fromUserId\) && !isProfileDeleted\(request\.toUserId\),\s*\);/,
    );
    assert.equal(
      PROVIDER.split("for (const request of pairs)").length - 1,
      2,
      "both passes read the filtered list, or `mutual` and `incoming` disagree",
    );
  });

  it("the provider's follow list is filtered on the way out and whole on disk", () => {
    assert.match(
      PROVIDER,
      /const visibleFollowing = useMemo\(\s*\(\) => following\.filter\(\(id\) => !isProfileDeleted\(id\)\),/,
    );
    assert.match(PROVIDER, /following: visibleFollowing,/);
    assert.match(
      PROVIDER,
      /JSON\.stringify\(\{ following, myProfile: myProfileOverride \}\)|JSON\.stringify\(\{\s*following,/,
      "the persisted blob must write the stored list, not the filtered view",
    );
  });

  it("states the rule once rather than in every list that depends on it", () => {
    // `visibleSocialCollections` carried its own tombstone term until both
    // sets stopped being able to hold one. Three statements of one rule is how
    // two of them come to disagree.
    assert.match(
      PROVIDER,
      /followingIds\.has\(collection\.ownerUserId\) \|\| friendIds\.has\(collection\.ownerUserId\)/,
    );
    assert.equal(
      PROVIDER.split("isProfileDeleted(collection.ownerUserId)").length - 1,
      0,
      "the social-collection filter re-states a rule its inputs already carry",
    );
  });
});

describe("an unreadable list is not an empty one", () => {
  // Each list maps ids through `getProfileById` and drops what does not
  // answer, so a mount that could not reach the profiles table left every list
  // empty while `friends` and `following` still held their ids. The tabs then
  // rendered "you have no friends yet" and a CTA to go and find people — a
  // conclusion drawn from missing evidence, to a user who has friends, on the
  // screen whose whole job is telling them about them.
  it("reads the condition off the id list, not off a caught error", () => {
    // `ensureProfilesLoaded` rejecting is swallowed by `.catch(() => {})` and
    // has to be — the flag must clear or the skeleton stands forever. An empty
    // list for a non-empty set of ids is the state the user is looking at,
    // however it came about: a rejected fetch, a partial response, a row an
    // admin tombstoned between two loads.
    assert.match(
      CODE,
      /const friendsUnresolved = !loadingFriends && friends\.length > 0 && friendProfiles\.length === 0;/,
    );
    assert.match(
      CODE,
      /const followingUnresolved =\s*!loadingFollowing && following\.length > 0 && followingProfiles\.length === 0;/,
    );
  });

  it("waits for the load to finish before concluding anything", () => {
    // Both readings begin with the flag: a list that is empty because the
    // fetch is still in flight is the skeleton's case, and reporting it as
    // unreadable would flash an error on every cold open.
    for (const guard of ["!loadingFriends &&", "!loadingFollowing &&"]) {
      assert.ok(CODE.includes(guard), `${guard} is how the skeleton keeps its turn`);
    }
  });

  it("offers a way out rather than a nicer dead end", () => {
    assert.match(CODE, /actionLabel=\{t\("tryAgain"\)\}\s*onAction=\{retryProfiles\}/);
    assert.match(CODE, /function retryProfiles\(\) \{\s*setProfileReloads\(\(n\) => n \+ 1\);\s*\}/);
  });

  it("re-fetches on a second press, which a boolean could not", () => {
    // A flag would be set by the first press and the second would re-run
    // nothing — on a screen whose failure mode is a connection that comes
    // back while you are looking at it.
    assert.match(CODE, /const \[profileReloads, setProfileReloads\] = useState\(0\);/);
    assert.match(
      CODE,
      /\}, \[friends, incomingRequestUserIds, ensureProfilesLoaded, profileReloads\]\);/,
    );
    assert.match(CODE, /\}, \[following, ensureProfilesLoaded, profileReloads\]\);/);
  });

  it("puts the notice ahead of the empty state in both tabs", () => {
    // Order is the whole fix: `friendProfiles.length === 0` is true in both
    // states, so whichever branch comes first decides what the user is told.
    const friendsChain = CODE.indexOf('title={t("profilesUnavailableTitle")}');
    const friendsEmpty = CODE.indexOf('title={t("emptyFriendsTabTitle")}');
    assert.ok(friendsChain > 0 && friendsEmpty > friendsChain, "the 👋 empty state answers first");

    const followingNotice = CODE.indexOf('title={t("profilesUnavailableTitle")}', friendsEmpty);
    const followingEmpty = CODE.indexOf('title={t("emptyFollowingTabTitle")}');
    assert.ok(
      followingNotice > 0 && followingEmpty > followingNotice,
      "the following tab still concludes emptiness from no profiles",
    );
  });

  it("says it under a pending request too, rather than falling silent", () => {
    // The friends half being unreadable is worth saying whether or not a
    // request renders above it; silence there was the same missing-evidence
    // reading in a quieter form.
    assert.match(
      CODE,
      /\) : friendsUnresolved \? \(/,
      "the unresolved branch sits ahead of the request check",
    );
  });
});
