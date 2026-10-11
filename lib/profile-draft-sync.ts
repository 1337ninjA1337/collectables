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
