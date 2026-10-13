/**
 * The profile screen's half of the draft rule, pinned structurally.
 *
 * `lib/profile-draft-sync.ts` holds the decision and
 * `profile-draft-sync.test.ts` runs it. What a pure module cannot say is that
 * the SCREEN uses it — and the bug was entirely in how the screen wrote the
 * two drafts, so a rule it stopped calling would put the bug straight back
 * with every case still green.
 *
 * Structural, because mounting this screen means React Native peers and a
 * router; the repository's other screen-level pins are the same shape and for
 * the same reason.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRepoFile } from "./helpers/repo-file";

describe("app/profile/[id].tsx — the drafts a refresh must not overwrite", () => {
  const src = readRepoFile("app/profile/[id].tsx");

  it("asks syncDrafts before writing either draft", () => {
    assert.match(src, /const sync = syncDrafts\(seededDraftsRef\.current, activeProfile\.id\);/);
    assert.match(src, /if \(sync\.kind === "reseed"\) \{/);
  });

  it("writes both drafts through nextDraft on the follow path", () => {
    // The unguarded `setBioDraft(...)` / `setProfileIdDraft(...)` pair this
    // replaced is the bug: it ran on every change to the profile or the
    // language and took whatever the user had typed with it.
    assert.match(src, /setBioDraft\(\(draft\) => nextDraft\(draft, sync\.seeded\.bio, bio\)\);/);
    assert.match(src, /setProfileIdDraft\(\(draft\) => nextDraft\(draft, sync\.seeded\.username, username\)\);/);
  });

  it("records the seed it just applied, keyed by profile id", () => {
    // Without the id the untouched test would compare against another
    // person's bio; without the write, every run would look like the first.
    assert.match(src, /const seededDraftsRef = useRef<ProfileDraftSeed \| null>\(null\);/);
    assert.match(src, /seededDraftsRef\.current = \{ id: activeProfile\.id, bio, username \};/);
  });

  it("saves the bio through draftToSave, against the STORED value", () => {
    // `bioDraft.trim() || localizedBio` got two things wrong for one reason:
    // it could not tell an emptied draft from an unseeded one, and it saved
    // what the screen was showing rather than what is on the row — so an
    // untouched save replaced the `DEFAULT_EN_PROFILE_BIO` sentinel with its
    // translation. `activeProfile.bio` is the third argument for that reason
    // and `localizedBio` must not be.
    assert.match(
      src,
      /bio: draftToSave\(bioDraft, seededDraftsRef\.current\?\.bio \?\? null, activeProfile\.bio\),/,
    );
    assert.ok(
      !src.includes("bio: bioDraft.trim() || localizedBio"),
      "the fallback that undid a deliberate clear must not come back",
    );
  });

  it("computes the localized bio once and lets the effect read it", () => {
    // The same expression was written above the effect and again inside it,
    // and both of this screen's draft fixes read it. The dependency list is
    // now exactly what the body reads, which is also why `t` left it.
    assert.match(src, /const bio = localizedBio;/);
    assert.equal(
      src.split("localizedProfileBio(activeProfile.bio, t)").length - 1,
      1,
      "the sentinel comparison belongs in one place",
    );
  });

  it("keeps the handle's own fallback, which is a different answer on purpose", () => {
    // A profile with no handle is not a state this app has — `publicId` and
    // every link are built from one — so an emptied handle draft is a mistake
    // to refuse. The two fields next to each other with opposite rules is the
    // thing a reader will want to have been deliberate.
    assert.match(src, /username: profileIdDraft\.trim\(\) \|\| activeProfile\.username,/);
  });

  it("commits each draft after its own save, with the draft as it stands", () => {
    // The save half of the dirty-draft rule. `updateMyProfile` normalises
    // before it writes — `ensureUniqueUsername` turns "Ada Lovelace" into
    // `ada_lovelace` and an all-Cyrillic handle into the anonymous `user_…`
    // seed — so without this the header showed the stored handle while the
    // editor behind it still held the rejected text, and pressing OK again
    // re-slugified that. The third argument is the DRAFT and not what was
    // sent, because the untouched test is `draft === seeded`.
    assert.match(
      src,
      /seededDraftsRef\.current = commitDraft\(seededDraftsRef\.current, "bio", bioDraft\);/,
    );
    assert.match(
      src,
      /seededDraftsRef\.current = commitDraft\(seededDraftsRef\.current, "username", profileIdDraft\);/,
    );
  });

  it("commits the handle draft before it closes the editor", () => {
    // Order matters only in that both must happen; the editor closing on a
    // stale draft is what the reopened field used to show.
    const commit = src.indexOf('commitDraft(seededDraftsRef.current, "username"');
    const close = src.indexOf("setEditingHandle(false);");
    assert.ok(commit !== -1 && close !== -1);
    assert.ok(commit < close, "the handle draft is committed by the save that closed the editor");
  });

  it("confirms each save, because neither one changes anything visible", () => {
    // The bio save moved nothing on screen at all: the button does not move,
    // and an untouched or a cleared save leaves the text identical. The
    // handle save closes the editor, which is visible but says the wrong
    // thing — `ensureUniqueUsername` normalises, so what the header shows
    // next may be a handle the user did not choose, and with no
    // confirmation that reads as the field having been ignored.
    assert.match(src, /toast\.success\(t\("profileDescriptionSaved"\)\);/);
    assert.match(src, /toast\.success\(t\("profileIdSaved"\)\);/);
  });

  it("confirms the save AFTER it has landed and the draft is committed", () => {
    // A toast fired before the await would be a promise, not a result.
    const bioCommit = src.indexOf('commitDraft(seededDraftsRef.current, "bio"');
    const bioToast = src.indexOf('t("profileDescriptionSaved")');
    const idCommit = src.indexOf('commitDraft(seededDraftsRef.current, "username"');
    const idToast = src.indexOf('t("profileIdSaved")');
    assert.ok(bioCommit !== -1 && bioToast !== -1 && idCommit !== -1 && idToast !== -1);
    assert.ok(bioCommit < bioToast, "the bio is confirmed after its draft is committed");
    assert.ok(idCommit < idToast, "the handle is confirmed after its draft is committed");
  });

  it("keeps the profile id in the effect's dependency list and the drafts out of it", () => {
    // The id joined the deps with this change — the effect reads
    // `activeProfile.id` now and a profile switch has to re-run it. The drafts
    // stay out, which is what the updater form is for: a draft in the deps of
    // the effect that sets it is the self-feeding shape the triage registry
    // names as the one real loop it found.
    assert.match(src, /\}, \[activeProfile\?\.id, activeProfile\?\.username, localizedBio\]\);/);
    assert.ok(
      !/\}, \[[^\]]*\bbioDraft\b[^\]]*\]\);/.test(src),
      "bioDraft must not be in the dependency list of the effect that sets it",
    );
    assert.ok(
      !/\}, \[[^\]]*\bprofileIdDraft\b[^\]]*\]\);/.test(src),
      "profileIdDraft must not be in the dependency list of the effect that sets it",
    );
  });
});
