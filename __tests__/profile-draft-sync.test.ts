/**
 * The rule that decides whether a profile refresh may overwrite what somebody
 * is typing.
 *
 * `app/profile/[id].tsx` kept two edit drafts in step with the loaded profile
 * by setting both on every change, and the three things that change it are all
 * ordinary: `ensureProfilesLoaded` from the focus effect, a pull-to-refresh,
 * and a language switch moving the default bio. So a bio somebody had spent
 * thirty seconds writing was replaced by the stored one, silently, with
 * nothing to undo it. The triage registry carried it as `open` for two weeks
 * with a `why` that stated the defect in the present tense.
 *
 * The decision is in `lib/profile-draft-sync.ts`' header: what the user just
 * typed wins. These cases are the two halves of it — a draft nobody touched
 * still follows the profile, because that is the only reason the sync exists —
 * and the one that is easy to get wrong, which is a NEW profile arriving in the
 * same mount.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { draftToSave, nextDraft, type ProfileDraftSeed, syncDrafts } from "@/lib/profile-draft-sync";

const ANNA: ProfileDraftSeed = { id: "u-anna", bio: "collects tin robots", username: "anna" };

describe("syncDrafts", () => {
  it("reseeds the first profile the screen sees", () => {
    const sync = syncDrafts(null, ANNA.id);
    assert.equal(sync.kind, "reseed");
    // The mirror field, so a caller can ask either question un-narrowed.
    assert.equal(sync.seeded, undefined);
  });

  it("reseeds when a DIFFERENT profile arrives in the same mount", () => {
    // The one that is easy to get wrong. expo-router serves a new `[id]` with
    // the same component, so a dirty-draft rule with no id in it would carry
    // one person's half-typed bio onto the next person's screen.
    const sync = syncDrafts(ANNA, "u-boris");
    assert.equal(sync.kind, "reseed");
  });

  it("follows the same profile, carrying the seed the caller needs", () => {
    const sync = syncDrafts(ANNA, ANNA.id);
    assert.equal(sync.kind, "follow");
    // Carried rather than re-read: the caller overwrites its ref on the next
    // line, so a second read would be of the value that just replaced this one.
    assert.deepEqual(sync.seeded, ANNA);
  });
});

describe("nextDraft", () => {
  it("takes the incoming value when the draft is untouched", () => {
    // Not "never sync". A draft nobody typed in SHOULD show a profile that
    // moved underneath it, which is the whole reason the effect exists.
    assert.equal(nextDraft("collects tin robots", "collects tin robots", "collects tin cars"), "collects tin cars");
  });

  it("keeps what the user wrote when the draft has moved", () => {
    // The decision. Losing a remote bio edit costs a refresh; losing a
    // half-typed one cannot be recovered, and whoever lost it watched it go.
    assert.equal(nextDraft("collects tin rob", "collects tin robots", "collects tin cars"), "collects tin rob");
  });

  it("treats a typed-then-deleted draft as untouched again", () => {
    // Why this is an equality and not a `hasTyped` flag: a flag would call
    // this dirty forever and strand the field on a stale value.
    assert.equal(nextDraft("collects tin robots", "collects tin robots", "updated remotely"), "updated remotely");
  });

  it("returns the draft reference itself so React can bail out", () => {
    // What makes the common path — a refresh that found the same profile —
    // render nothing at all: an updater returning the value it was given.
    const draft = "typed by hand";
    assert.equal(nextDraft(draft, "seeded", "incoming"), draft);
    // And the no-change case on the untouched side, which is every refresh
    // that found nothing new.
    assert.equal(nextDraft("same", "same", "same"), "same");
  });

  it("lets an empty draft be seeded, which is the screen's initial state", () => {
    // `useState("")` then a reseed: the untouched test has to hold for "" or
    // the first profile would never reach the field.
    assert.equal(nextDraft("", "", "collects tin robots"), "collects tin robots");
  });
});

describe("draftToSave", () => {
  it("saves what the user wrote, trimmed", () => {
    assert.equal(draftToSave("  collects tin cars  ", ANNA, "fallback"), "collects tin cars");
  });

  it("saves an empty bio the user emptied on purpose", () => {
    // The bug: `bioDraft.trim() || localizedBio` handed back the stored bio,
    // so clearing a bio and saving it was a no-op that looked like a save.
    assert.equal(draftToSave("", ANNA, "collects tin robots"), "");
    // Whitespace is not content — three spaces is a bio cleared with the
    // keyboard still open.
    assert.equal(draftToSave("   ", ANNA, "collects tin robots"), "");
  });

  it("falls back only when no seed exists, which is before anything was shown", () => {
    // The one case the `||` was right about, kept: a null seed means the sync
    // effect has not run, so the empty draft is `useState("")` rather than an
    // answer, and saving it would wipe a real bio.
    assert.equal(draftToSave("", null, "collects tin robots"), "collects tin robots");
    // And a typed draft still wins even then, because somebody typed it.
    assert.equal(draftToSave("typed first", null, "collects tin robots"), "typed first");
  });
});
