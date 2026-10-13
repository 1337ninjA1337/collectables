/**
 * Which of two writers wins a profile edit draft, when both move.
 *
 * `app/profile/[id].tsx` keeps two editable drafts — the bio and the handle —
 * in step with the profile it loaded. Three things move that profile while the
 * screen is open, and all three are ordinary: the focus effect calls
 * `ensureProfilesLoaded`, a pull-to-refresh re-reads it, and a language switch
 * changes what the default bio says. Until 2026-10-11 each of them overwrote
 * both drafts, so a bio somebody had spent thirty seconds writing was replaced
 * by the stored one with no warning and nothing to undo it.
 *
 * ## The decision, which is the whole module
 *
 * What the user just typed wins. Losing a remote bio edit costs a refresh;
 * losing a half-typed one cannot be recovered at all, and the person who lost
 * it watched it happen.
 *
 * That is not the same as "never sync". A draft nobody has touched SHOULD show
 * a newer value — that is the only reason the sync exists — so the question is
 * how to tell the two apart, and the answer is the value the profile last put
 * there: a draft still equal to its seed is untouched, and one that is not is
 * something somebody wrote.
 *
 * ## Pure, and two functions rather than one
 *
 * No React here, for the reason `lib/check-sentry-version.ts` has none: the
 * rule is the part worth testing and a screen that pulls React Native peers is
 * the part a suite cannot mount. Two functions because the caller needs the
 * answers at different moments — {@link syncDrafts} before it writes anything,
 * {@link nextDraft} inside a `setState` updater, which is what keeps the
 * current draft out of the effect's dependency list and therefore out of a
 * loop.
 */

/** The three values a profile puts into the screen's drafts. */
export interface ProfileDraftSeed {
  /** Whose profile this is. */
  readonly id: string;
  /** The bio as the screen shows it, already localized if it is the default. */
  readonly bio: string;
  /** The handle. */
  readonly username: string;
}

/**
 * What to do with the drafts now that the profile has moved.
 *
 * A two-sided union rather than a boolean, for the reason `AuditAnswer |
 * AuditSkip` is one: the `"follow"` half CARRIES the seed its caller then
 * needs, so there is no second read of a ref that may already have been
 * overwritten, and no `!` at the call site to tell the compiler what the
 * boolean implied.
 */
export type ProfileDraftSync =
  /** Replace both drafts outright. Nothing of this profile's session survives. */
  | { readonly kind: "reseed"; readonly seeded?: undefined }
  /** Keep whatever the user wrote; the seed says what "whatever" is measured against. */
  | { readonly kind: "follow"; readonly seeded: ProfileDraftSeed };

/**
 * Whether this profile change replaces both drafts outright.
 *
 * `"reseed"` on the first profile the screen sees, and whenever it is a
 * DIFFERENT profile: an untouched-draft rule must not carry one person's
 * half-typed bio onto the next person's screen, which is what expo-router does
 * when the same component serves a new `[id]`. The dirty-draft protection is
 * about one profile's edit session and ends when that profile does.
 */
export function syncDrafts(seeded: ProfileDraftSeed | null, incomingId: string): ProfileDraftSync {
  if (seeded === null || seeded.id !== incomingId) return { kind: "reseed" };
  return { kind: "follow", seeded };
}

/**
 * What a draft becomes when the profile moved under it.
 *
 * `draft === seeded` is the untouched test, and it is deliberately an equality
 * rather than a "has the user typed" flag: a user who types a character and
 * deletes it is back to untouched, which is the right answer and is one a flag
 * would get wrong. It also means a user who happens to type exactly the stored
 * value loses nothing by being treated as untouched.
 *
 * Returning `draft` unchanged is what lets the caller pass this to a
 * `setState` updater and have React bail out: on the common path — a refresh
 * that found the same profile — the effect then renders nothing at all, where
 * before it set two states on every run.
 */
export function nextDraft(draft: string, seeded: string, incoming: string): string {
  return draft === seeded ? incoming : draft;
}

/**
 * What to save for a draft, given what the profile put there and what is stored.
 *
 * Two bugs, both from one expression. `app/profile/[id].tsx` saved
 * `bioDraft.trim() || localizedBio`:
 *
 * - somebody who selected their whole bio, deleted it and pressed Save got the
 *   stored one back — a save that looked like a save and was a no-op, because
 *   `||` cannot tell "the user cleared this" from "this was never filled in";
 * - somebody who pressed Save without typing anything wrote the LOCALIZED
 *   default into the row, because the draft is seeded with
 *   `t("defaultProfileBio")` while the stored sentinel is
 *   `DEFAULT_EN_PROFILE_BIO`. A profile opened in Russian and saved untouched
 *   kept Russian prose as its bio forever, and every later language switch
 *   showed it, because the sentinel the switch keys on was gone.
 *
 * The seed answers both, and it is the ref {@link syncDrafts} already keeps:
 *
 * - **untouched** (`draft === seeded`): save `stored`, unchanged. Not what the
 *   screen was SHOWING, which is the localized default — what is on the row.
 *   An untouched draft is not an edit and must not become one.
 * - **emptied** (seeded, and the draft trims to nothing): save the empty
 *   string. Somebody did that on purpose.
 * - **typed**: save it trimmed, because trailing whitespace is not content.
 * - **no seed at all**: save `stored`. The sync effect has not run, so the
 *   empty draft is `useState("")` rather than an answer, and this is the one
 *   case the old `||` was right about.
 *
 * `stored` rather than a `fallback`, and the rename is the fix: what to write
 * when nobody edited anything is "whatever is already there", and spelling it
 * as a fallback is what let a localized string be passed for it.
 */
export function draftToSave(draft: string, seeded: string | null, stored: string): string {
  if (seeded !== null && draft === seeded) return stored;
  const trimmed = draft.trim();
  if (trimmed !== "") return trimmed;
  return seeded === null ? stored : "";
}

/** Which of the screen's two drafts a Save button commits. */
export type ProfileDraftField = "bio" | "username";

/**
 * The seed after a save, which is what makes the draft clean again.
 *
 * The dirty-draft rule above protects what somebody is typing from a refresh
 * that arrives mid-sentence, and it has one blind spot: a save is not a
 * refresh. Once the user has pressed Save the draft is no longer unsaved work
 * — it has been committed — and what the row ended up holding can differ from
 * what was typed, because the context normalises before it writes.
 *
 * The handle is where that is visible. `updateMyProfile` runs
 * `ensureUniqueUsername`, so "Ada Lovelace" is stored as `ada_lovelace` and an
 * all-Cyrillic handle slugifies to nothing and is stored as the anonymous
 * `user_…` seed. Without this, {@link nextDraft} read the draft as dirty
 * forever after: the header showed `@user_1234` while the editor behind it
 * still held "Антон", reopening the editor showed the rejected text rather
 * than the handle in force, and pressing OK again re-slugified it. The bio has
 * the same shape one step smaller — the draft keeps the whitespace the save
 * trimmed off.
 *
 * `draft` is the draft AS IT STANDS and deliberately not the value that was
 * written: the untouched test is `draft === seeded`, so the seed has to be set
 * to what the draft holds for the next profile change to win. The window
 * between pressing Save and getting here is one microtask — `updateMyProfile`
 * awaits no I/O — so there is nothing a keystroke can slip into.
 *
 * A null seed stays null. Nothing has been shown to anybody, so there is no
 * draft to call clean, and inventing a seed here would hand
 * {@link draftToSave} the "somebody emptied this" reading of a `useState("")`.
 */
export function commitDraft(
  seeded: ProfileDraftSeed | null,
  field: ProfileDraftField,
  draft: string,
): ProfileDraftSeed | null {
  if (seeded === null) return null;
  return field === "bio" ? { ...seeded, bio: draft } : { ...seeded, username: draft };
}
