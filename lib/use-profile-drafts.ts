/**
 * The profile screen's edit session, behind one call.
 *
 * `app/profile/[id].tsx` is 800-plus lines and eleven `useState`s, five of
 * which were one feature: the bio draft, the handle draft, whether the handle
 * editor is open, the ref remembering what the profile last seeded, and the
 * effect keeping the first two in step with a profile that moves underneath
 * them. Three bugs came out of eleven of those lines on 2026-10-11 and two
 * more on 2026-10-13, and every one of them was found by reading code a
 * hundred lines away from the handler it broke. The suggestion to put the
 * session behind one call was carried for five days; the sentinel moving to
 * `lib/profile-draft-sync.ts` is what made it possible, because the localized
 * bio can be computed here instead of being passed in.
 *
 * ## What this holds and what it does not
 *
 * The RULE is in `lib/profile-draft-sync.ts` and stays there: pure, React-free
 * and the half worth testing on its own. This is the wiring — the states, the
 * ref, the effect and the order a save happens in — which is the half that
 * needs React and does not need a screen.
 *
 * Writing is the caller's, through the `write` callback each save takes. The
 * screen owns `updateMyProfile`, the toast and the editor's open state in the
 * UI sense; this owns what to write and what to do once it has landed. That
 * split is why {@link useProfileDrafts} can be read without knowing what a
 * social context is.
 */

import { useEffect, useRef, useState } from "react";

import {
  commitDraft,
  draftToSave,
  localizedProfileBio,
  nextDraft,
  type ProfileDraftSeed,
  syncDrafts,
} from "@/lib/profile-draft-sync";

/** The fields of the loaded profile this session reads. */
export interface ProfileDraftSource {
  readonly id: string;
  readonly bio: string;
  readonly username: string;
}

/** What {@link useProfileDrafts} hands the screen. */
export interface ProfileDraftSession {
  /** The stored bio with the default sentinel translated — what a reader sees. */
  readonly localizedBio: string;
  readonly bioDraft: string;
  readonly setBioDraft: (value: string) => void;
  readonly profileIdDraft: string;
  readonly setProfileIdDraft: (value: string) => void;
  readonly editingHandle: boolean;
  readonly setEditingHandle: (value: boolean) => void;
  /**
   * Write the bio draft through `write`, then mark the draft saved.
   *
   * Resolves to `false` without calling `write` when there is no profile
   * loaded, so the caller's own guard is one `if` it no longer needs.
   */
  readonly saveBio: (write: (bio: string) => Promise<void>) => Promise<boolean>;
  /** {@link saveBio} for the handle. */
  readonly saveHandle: (write: (username: string) => Promise<void>) => Promise<boolean>;
}

export function useProfileDrafts(
  profile: ProfileDraftSource | null,
  t: (key: "defaultProfileBio") => string,
): ProfileDraftSession {
  const [bioDraft, setBioDraft] = useState("");
  const [profileIdDraft, setProfileIdDraft] = useState("");
  const [editingHandle, setEditingHandle] = useState(false);

  const localizedBio = profile ? localizedProfileBio(profile.bio, t) : "";

  /**
   * What the profile last put into each draft, so a remote change can tell an
   * untouched field from one the user is typing in.
   *
   * A ref rather than state because "what was seeded" is a fact about this
   * mount and must not cause a render — and because the saves write to it
   * after an await, where a stale state value would be the wrong answer.
   */
  const seededDraftsRef = useRef<ProfileDraftSeed | null>(null);

  useEffect(() => {
    if (!profile) return;
    const bio = localizedBio;
    const username = profile.username;
    const sync = syncDrafts(seededDraftsRef.current, profile.id);
    seededDraftsRef.current = { id: profile.id, bio, username };
    if (sync.kind === "reseed") {
      setBioDraft(bio);
      setProfileIdDraft(username);
      return;
    }
    // Updaters, so React bails out when the value has not moved: on the
    // common path — a refresh that found the same profile — this effect
    // renders nothing at all, where before it set two states on every run.
    setBioDraft((draft) => nextDraft(draft, sync.seeded.bio, bio));
    setProfileIdDraft((draft) => nextDraft(draft, sync.seeded.username, username));
    // `localizedBio` rather than `profile?.bio` and `t`: the same expression
    // was written above this effect and again inside it, and both of this
    // session's draft fixes read it. One value, and the list is exactly what
    // the body reads. The drafts are deliberately absent — they are read
    // through updaters, which is what keeps the effect that sets them out of
    // its own dependency list and therefore out of a loop.
  }, [profile?.id, profile?.username, localizedBio]);

  async function saveBio(write: (bio: string) => Promise<void>): Promise<boolean> {
    if (!profile) return false;
    // `draftToSave` against the STORED bio, not against `localizedBio`: an
    // untouched draft writes what is on the row, because writing the
    // translation would replace the sentinel and freeze the bio in whichever
    // language the author happened to be reading.
    await write(draftToSave(bioDraft, seededDraftsRef.current?.bio ?? null, profile.bio));
    // Committed AFTER the write, which is the order: a save makes the draft
    // clean again so the next profile change may deliver what the row ended
    // up with, and doing it first would call a draft saved that is not.
    seededDraftsRef.current = commitDraft(seededDraftsRef.current, "bio", bioDraft);
    return true;
  }

  async function saveHandle(write: (username: string) => Promise<void>): Promise<boolean> {
    if (!profile) return false;
    // The handle keeps its `||` and that is a decision, not an oversight: a
    // profile with no handle is not a state this app has — `publicId` and
    // every link to it are built from one — so an emptied handle draft is a
    // mistake to refuse rather than an edit to honour. The bio beside it goes
    // the other way because an empty bio is a bio.
    await write(profileIdDraft.trim() || profile.username);
    seededDraftsRef.current = commitDraft(seededDraftsRef.current, "username", profileIdDraft);
    return true;
  }

  return {
    localizedBio,
    bioDraft,
    setBioDraft,
    profileIdDraft,
    setProfileIdDraft,
    editingHandle,
    setEditingHandle,
    saveBio,
    saveHandle,
  };
}
