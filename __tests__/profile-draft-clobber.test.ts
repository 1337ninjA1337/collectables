/**
 * The wiring half of the draft rule, pinned structurally.
 *
 * `lib/profile-draft-sync.ts` holds the decision and
 * `profile-draft-sync.test.ts` runs it. What a pure module cannot say is that
 * anything USES it — and the bug was entirely in how the drafts were written,
 * so a rule nobody called would put it straight back with every case still
 * green.
 *
 * Structural, because the wiring is a hook and running one means a renderer;
 * the repository's other hook- and screen-level pins are the same shape and
 * for the same reason. What the cases read moved on 2026-10-13: the session
 * left `app/profile/[id].tsx` for `lib/use-profile-drafts.ts`, so the rule's
 * callers are pinned in the hook and the screen is pinned to going through it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRepoFile } from "./helpers/repo-file";

describe("lib/use-profile-drafts.ts — the drafts a refresh must not overwrite", () => {
  const src = readRepoFile("lib/use-profile-drafts.ts");

  it("asks syncDrafts before writing either draft", () => {
    assert.match(src, /const sync = syncDrafts\(seededDraftsRef\.current, profile\.id\);/);
    assert.match(src, /if \(sync\.kind === "reseed"\) \{/);
  });

  it("writes both drafts through nextDraft on the follow path", () => {
    // The unguarded `setBioDraft(...)` / `setProfileIdDraft(...)` pair this
    // replaced is the bug: it ran on every change to the profile or the
    // language and took whatever the user had typed with it.
    assert.match(src, /setBioDraft\(\(draft\) => nextDraft\(draft, sync\.seeded\.bio, bio\)\);/);
    assert.match(
      src,
      /setProfileIdDraft\(\(draft\) => nextDraft\(draft, sync\.seeded\.username, username\)\);/,
    );
  });

  it("records the seed it just applied, keyed by profile id", () => {
    // Without the id the untouched test would compare against another
    // person's bio; without the write, every run would look like the first.
    assert.match(src, /const seededDraftsRef = useRef<ProfileDraftSeed \| null>\(null\);/);
    assert.match(src, /seededDraftsRef\.current = \{ id: profile\.id, bio, username \};/);
  });

  it("saves the bio through draftToSave, against the STORED value", () => {
    // `bioDraft.trim() || localizedBio` got two things wrong for one reason:
    // it could not tell an emptied draft from an unseeded one, and it saved
    // what the screen was showing rather than what is on the row — so an
    // untouched save replaced the `DEFAULT_EN_PROFILE_BIO` sentinel with its
    // translation. `profile.bio` is the third argument for that reason and
    // `localizedBio` must not be.
    assert.match(
      src,
      /draftToSave\(bioDraft, seededDraftsRef\.current\?\.bio \?\? null, profile\.bio\)/,
    );
    assert.ok(
      !/draftToSave\(bioDraft, [^)]*localizedBio\)/.test(src),
      "an untouched save must write the stored sentinel, not the translation on screen",
    );
    assert.ok(
      !src.includes("bioDraft.trim() ||"),
      "the fallback that undid a deliberate clear must not come back",
    );
  });

  it("computes the localized bio once and lets the effect read it", () => {
    // The same expression was written above the effect and again inside it,
    // and both of this session's draft fixes read it. The dependency list is
    // now exactly what the body reads, which is also why `t` left it.
    assert.match(src, /const bio = localizedBio;/);
    assert.equal(
      src.split("localizedProfileBio(profile.bio, t)").length - 1,
      1,
      "the sentinel comparison belongs in one place",
    );
  });

  it("keeps the handle's own fallback, which is a different answer on purpose", () => {
    // A profile with no handle is not a state this app has — `publicId` and
    // every link are built from one — so an emptied handle draft is a mistake
    // to refuse. The two fields next to each other with opposite rules is the
    // thing a reader will want to have been deliberate.
    assert.match(src, /profileIdDraft\.trim\(\) \|\| profile\.username/);
  });

  it("commits each draft after its own write, with the draft as it stands", () => {
    // The save half of the dirty-draft rule. `updateMyProfile` normalises
    // before it writes — `ensureUniqueUsername` turns "Ada Lovelace" into
    // `ada_lovelace` and an all-Cyrillic handle into the anonymous `user_…`
    // seed — so without this the header showed the stored handle while the
    // editor behind it still held the rejected text, and pressing OK again
    // re-slugified that. The third argument is the DRAFT and not what was
    // written, because the untouched test is `draft === seeded`.
    assert.match(
      src,
      /seededDraftsRef\.current = commitDraft\(seededDraftsRef\.current, "bio", bioDraft\);/,
    );
    assert.match(
      src,
      /seededDraftsRef\.current = commitDraft\(seededDraftsRef\.current, "username", profileIdDraft\);/,
    );
    for (const [field, draft] of [["bio", "bioDraft"], ["username", "profileIdDraft"]]) {
      const write = src.indexOf("await write(");
      const commit = src.indexOf(`commitDraft(seededDraftsRef.current, "${field}", ${draft})`);
      assert.ok(write !== -1 && commit !== -1);
      assert.ok(write < commit, `${field} is committed after the write, not before it`);
    }
  });

  it("keeps the profile id in the effect's dependency list and the drafts out of it", () => {
    // The id joined the deps when the effect stopped overwriting a draft the
    // user had typed in. The drafts stay out, which is what the updater form
    // is for: a draft in the deps of the effect that sets it is the
    // self-feeding shape the triage registry names as the one real loop its
    // reading found.
    assert.match(src, /\}, \[profile\?\.id, profile\?\.username, localizedBio\]\);/);
    assert.ok(
      !/\}, \[[^\]]*\bbioDraft\b[^\]]*\]\);/.test(src),
      "bioDraft must not be in the dependency list of the effect that sets it",
    );
    assert.ok(
      !/\}, \[[^\]]*\bprofileIdDraft\b[^\]]*\]\);/.test(src),
      "profileIdDraft must not be in the dependency list of the effect that sets it",
    );
  });

  it("refuses both saves without a profile, so the caller needs no guard", () => {
    // `false` rather than a throw: the screen's two handlers read it as "stop"
    // and the toast is what would otherwise lie.
    assert.equal(src.split("if (!profile) return false;").length - 1, 2);
  });
});

describe("app/profile/[id].tsx — the screen goes through the session", () => {
  const src = readRepoFile("app/profile/[id].tsx");

  it("takes the whole session from one call", () => {
    // Five pieces of one feature — two drafts, the editor flag, the seed ref
    // and the effect — were spread over 150 lines of an 800-line screen, and
    // every bug found in them was found by reading code a long way from the
    // handler it broke.
    assert.match(src, /import \{ useProfileDrafts \} from "@\/lib\/use-profile-drafts";/);
    assert.match(src, /\} = useProfileDrafts\(activeProfile \?\? null, t\);/);
  });

  it("keeps none of the session's own state", () => {
    for (const declaration of [
      /const \[bioDraft, setBioDraft\] = useState/,
      /const \[profileIdDraft, setProfileIdDraft\] = useState/,
      /const \[editingHandle, setEditingHandle\] = useState/,
      /useRef<ProfileDraftSeed \| null>/,
    ]) {
      assert.doesNotMatch(src, declaration, "the session is back on the screen");
    }
  });

  it("owns the writing and nothing else about the save", () => {
    // The split: the hook decides what to write and when the draft is clean,
    // the screen owns `updateMyProfile` because it owns the context.
    assert.match(src, /await saveBio\(\(bio\) => updateMyProfile\(\{ bio \}\)\)/);
    assert.match(src, /await saveHandle\(\(username\) => updateMyProfile\(\{ username \}\)\)/);
    assert.doesNotMatch(src, /draftToSave\(/, "the screen decides what to save again");
    assert.doesNotMatch(src, /commitDraft\(/, "the screen commits the drafts again");
  });

  it("confirms each save, because neither one changes anything visible", () => {
    // The bio save moved nothing on screen at all: the button does not move,
    // and an untouched or a cleared save leaves the text identical, so
    // pressing Save read as "nothing happened". The handle save closes the
    // editor, which is visible but says the wrong thing — the save normalises
    // what was typed, so the header may show a handle the user did not choose.
    assert.match(src, /toast\.success\(t\("profileDescriptionSaved"\)\);/);
    assert.match(src, /toast\.success\(t\("profileIdSaved"\)\);/);
  });

  it("confirms neither save when there was no profile to save to", () => {
    // The guard the hook's `false` is for: a toast after a write that never
    // happened is the one lie this screen can tell.
    const guards = src.match(/if \(!\(await save(Bio|Handle)\([\s\S]{0,60}?\)\)\) return;/g);
    assert.equal(guards?.length, 2);
  });
});
