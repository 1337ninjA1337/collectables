import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_METHOD,
  relationshipActions,
  SURFACE_RELATIONSHIPS,
  type ProfileSurface,
  type RelationshipActionId,
} from "@/lib/relationship-actions";
import { stripComments } from "@/lib/strip-comments";
import type { ProfileRelationship } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The relationship-action table.
 *
 * It was written out THREE times — five ternary branches in
 * `app/profile/[id].tsx`, five more in `app/people.tsx`, and three in
 * `app/friends.tsx` keyed on the tab rather than on a relationship. Nothing
 * could compare the copies except a person reading all of them, which is why
 * every place they differ had gone unrecorded as deliberate. Each difference
 * turned out to be defensible; each is now an entry.
 */

const RELATIONSHIPS: readonly ProfileRelationship[] = [
  "self",
  "friend",
  "following",
  "request_sent",
  "request_received",
  "none",
];

const SURFACES: readonly ProfileSurface[] = ["detail", "row", "tab"];

describe("relationshipActions", () => {
  it("answers for every relationship on every surface", () => {
    // Exhaustive rather than spot-checked: a missing key in the table is a
    // runtime `undefined.filter` on a screen, not a type error, because the
    // union is what indexes it.
    for (const relationship of RELATIONSHIPS) {
      for (const surface of SURFACES) {
        assert.ok(
          Array.isArray(relationshipActions(relationship, surface)),
          `no answer for ${relationship} on ${surface}`,
        );
      }
    }
  });

  it("offers nothing on your own profile", () => {
    // Empty rather than absent, which is what lets a screen render the block
    // unconditionally instead of guarding it — the own-profile branch shows
    // editing controls somewhere else entirely.
    for (const surface of SURFACES) {
      assert.deepEqual(relationshipActions("self", surface), []);
    }
  });

  it("gives a stranger exactly add-friend and follow, in that order", () => {
    assert.deepEqual(
      relationshipActions("none", "detail").map((a) => a.id),
      ["add_friend", "follow"],
    );
  });

  it("does not offer follow to somebody already followed", () => {
    // The pair that is easiest to get backwards, and the symptom is a button
    // that does nothing.
    const following = relationshipActions("following", "detail").map((a) => a.id);
    assert.ok(!following.includes("follow"));
    assert.ok(following.includes("unfollow"));
  });

  it("records the one place the two surfaces genuinely differ", () => {
    // This is the finding the extraction produced. A friend's DETAIL screen
    // offers chat, unfriend and unfollow; a friend's ROW offers unfriend
    // alone. Stated as a case because it was previously the difference between
    // two blocks of JSX nobody had compared, and either reading — "the row is
    // missing two buttons" or "the detail screen has two extra" — was
    // available to whoever looked next.
    assert.deepEqual(
      relationshipActions("friend", "detail").map((a) => a.id),
      ["chat", "remove_friend", "unfollow"],
    );
    assert.deepEqual(
      relationshipActions("friend", "row").map((a) => a.id),
      ["remove_friend"],
    );
  });

  it("agrees on every other relationship, which is the rest of the claim", () => {
    // The complement of the case above, and still about detail-vs-row only:
    // `friend` is the ONLY divergence between the two BROWSING surfaces. A
    // second one appearing is a decision somebody should make on purpose.
    // `tab` is excluded deliberately — it diverges from both on purpose and
    // has its own cases below.
    const diverging = RELATIONSHIPS.filter((relationship) => {
      const detail = relationshipActions(relationship, "detail").map((a) => a.id);
      const row = relationshipActions(relationship, "row").map((a) => a.id);
      return JSON.stringify(detail) !== JSON.stringify(row);
    });
    assert.deepEqual(diverging, ["friend"]);
  });

  it("gives the friends screen's three tabs exactly the buttons they had", () => {
    // `app/friends.tsx` was a third copy of this decision, written as a
    // ternary on the TAB rather than on a relationship. Encoding it changed no
    // button, and these three lists are what "changed no button" means — they
    // are the JSX that was deleted, read back out of the table.
    assert.deepEqual(
      relationshipActions("friend", "tab").map((a) => a.id),
      ["chat", "remove_friend"],
    );
    assert.deepEqual(
      relationshipActions("request_received", "tab").map((a) => a.id),
      ["accept_request", "reject_request"],
    );
    assert.deepEqual(
      relationshipActions("following", "tab").map((a) => a.id),
      ["unfollow"],
    );
  });

  it("drops exactly the buttons the tab itself already answers", () => {
    // The interesting half: every omission is the tab restating its own
    // heading. A friend under "Friends" is not there to be unfollowed, and
    // someone under "Following" is not there to be friended. Stated as a
    // difference against `detail`, so re-adding one of them shows up here as
    // an empty set rather than as a passing test nobody re-read.
    const droppedFrom = (relationship: ProfileRelationship) => {
      const tab = new Set(relationshipActions(relationship, "tab").map((a) => a.id));
      return relationshipActions(relationship, "detail")
        .map((a) => a.id)
        .filter((id) => !tab.has(id));
    };
    assert.deepEqual(droppedFrom("friend"), ["unfollow"]);
    assert.deepEqual(droppedFrom("following"), ["add_friend"]);
    assert.deepEqual(droppedFrom("request_received"), []);
  });

  it("says which relationships each surface is ever asked about, and means it", () => {
    // `SURFACE_RELATIONSHIPS` is the claim that a surface's shorter list is
    // shorter because it serves fewer relationships, not because buttons went
    // missing. Both directions are checked: a relationship a surface names
    // must have something to render, and one it does not name must render
    // nothing — otherwise `tab` could quietly grow a `request_sent` row that
    // the friends screen has no list to put it in.
    for (const surface of SURFACES) {
      const named = new Set(SURFACE_RELATIONSHIPS[surface]);
      for (const relationship of RELATIONSHIPS) {
        const actions = relationshipActions(relationship, surface);
        if (named.has(relationship)) {
          assert.ok(actions.length > 0, `${surface} names ${relationship} but renders nothing`);
        } else {
          assert.deepEqual(
            actions.map((a) => a.id),
            [],
            `${surface} renders ${relationship} without naming it`,
          );
        }
      }
    }
  });

  it("never names self as a surface's relationship", () => {
    // The own-profile branch renders editing controls, so `self` reaching a
    // surface at all would be the bug the empty list exists to make harmless.
    for (const surface of SURFACES) {
      assert.ok(!SURFACE_RELATIONSHIPS[surface].includes("self"), `${surface} names self`);
    }
  });

  it("shows the pending badge with its cancel button, not instead of it", () => {
    // `request_sent` is the only entry with a non-button, and the badge and
    // the button share an intent while differing in kind — the shape most
    // likely to be 'simplified' into one.
    const sent = relationshipActions("request_sent", "row");
    assert.deepEqual(
      sent.map((a) => [a.kind, a.labelKey]),
      [
        ["badge", "requestSent"],
        ["secondary", "cancelInvitation"],
      ],
    );
  });

  it("gives each surface at most one primary action", () => {
    // Two primaries in a row is a visual bug rather than a logic one, so
    // nothing else in the tree would catch it.
    for (const relationship of RELATIONSHIPS) {
      for (const surface of SURFACES) {
        const primaries = relationshipActions(relationship, surface).filter(
          (a) => a.kind === "primary",
        );
        assert.ok(
          primaries.length <= 1,
          `${relationship} on ${surface} has ${primaries.length} primary actions`,
        );
      }
    }
  });

  it("never returns an action that does not name a surface it was asked for", () => {
    for (const relationship of RELATIONSHIPS) {
      for (const surface of SURFACES) {
        for (const action of relationshipActions(relationship, surface)) {
          assert.ok(
            action.surfaces.includes(surface),
            `${action.id} leaked into ${surface}`,
          );
        }
      }
    }
  });
});

describe("ACTION_METHOD", () => {
  it("maps every intent", () => {
    const ids = new Set<RelationshipActionId>();
    for (const relationship of RELATIONSHIPS) {
      for (const surface of SURFACES) {
        for (const action of relationshipActions(relationship, surface)) ids.add(action.id);
      }
    }
    for (const id of ids) {
      assert.ok(ACTION_METHOD[id], `no method for intent '${id}'`);
    }
  });

  it("sends all three removals to one method, which is why they are three intents", () => {
    // The social graph has one edge-removal operation and three things a
    // person can mean by it. Naming them separately is what lets the labels
    // differ without three call sites deciding independently which function
    // that implies — and asserting it here is what stops somebody 'noticing
    // the duplication' and collapsing the intents.
    assert.equal(ACTION_METHOD.reject_request, "removeFriend");
    assert.equal(ACTION_METHOD.cancel_request, "removeFriend");
    assert.equal(ACTION_METHOD.remove_friend, "removeFriend");
  });

  it("accepts a request by ADDING a friend, not by a method of its own", () => {
    assert.equal(ACTION_METHOD.accept_request, "addFriend");
    assert.equal(ACTION_METHOD.add_friend, "addFriend");
  });

  it("keeps chat as its own method, because it is navigation not a graph edit", () => {
    assert.equal(ACTION_METHOD.chat, "chat");
  });
});

describe("all three screens render from the table", () => {
  const profile = readRepoFile("app/profile/[id].tsx");
  const people = readRepoFile("app/people.tsx");
  const friends = readRepoFile("app/friends.tsx");

  /** Every surface, paired with the file that renders it. */
  const SCREENS = [
    ["app/profile/[id].tsx", profile],
    ["app/people.tsx", people],
    ["app/friends.tsx", friends],
  ] as const;

  it("declares the surface each one is, and reads the table only through the row", () => {
    // The screens stopped calling `relationshipActions` directly when
    // `<RelationshipActionRow>` took the rendering — they now name their
    // surface and the component asks the table. Asserting they do NOT call it
    // is the half that matters: a screen that went back to mapping the list
    // itself would re-open the presentation duplication this extraction closed
    // while still passing the `surface=` half of this case.
    assert.match(profile, /surface="detail"/);
    assert.match(people, /surface="row"/);
    assert.match(friends, /surface="tab"/);
    for (const [name, src] of SCREENS) {
      assert.doesNotMatch(
        src,
        /relationshipActions\(/,
        `${name} reads the table directly instead of rendering <RelationshipActionRow>`,
      );
    }
  });

  it("leaves no hand-written relationship branch behind", () => {
    // The specific shape that was extracted. A single remaining ternary would
    // mean one screen still answers for itself, which is the whole problem.
    for (const [name, src] of SCREENS) {
      assert.doesNotMatch(
        src,
        /relationship === "request_sent"/,
        `${name} still branches on the relationship by hand`,
      );
      assert.doesNotMatch(src, /relationship === "following"/, `${name} still branches by hand`);
    }
  });

  it("dispatches through ACTION_METHOD rather than on the intent", () => {
    // Switching on the intent id would put the three-removals-one-method fact
    // in two screens instead of in the table.
    for (const [name, src] of SCREENS) {
      assert.match(
        src,
        /switch \(ACTION_METHOD\[id\]\)/,
        `${name} does not dispatch through the method map`,
      );
    }
  });

  it("keeps each dispatcher honest about the intent it cannot service", () => {
    // Two screens can be handed an intent the table never sends them, and both
    // throw rather than falling through: a silent no-op is how a table edit
    // that gave a surface an unreachable button would go unnoticed. `chat`
    // never reaches the people row; `follow` never reaches the friends screen,
    // whose every list is of people the user already has an edge to.
    assert.match(people, /throw new Error\("people list has no chat action"\)/);
    assert.match(friends, /throw new Error\("friends screen has no follow action"\)/);
  });

  it("reads the friends tab from the LIST, not from getRelationship", () => {
    // Load-bearing, and the reason this screen maps `kind` rather than asking
    // the context: `getRelationship` answers `friend` before `following`, so a
    // friend the user also follows would render the friends buttons on the
    // following tab. Passing `getRelationship(profile.id)` here would compile,
    // pass every other case in this file, and change what that tab shows.
    assert.match(friends, /RELATIONSHIP_BY_TAB\[kind\]/);
    // Comments stripped: the map's own doc block names `getRelationship` to
    // say why it is NOT called, and a rule that fires on prose about itself is
    // a rule that gets exempted rather than fixed.
    assert.doesNotMatch(stripComments(friends), /getRelationship/);
  });
});
