/**
 * What "search by profile ID" matches, written once for the three places that
 * ask it.
 *
 * The field is labelled `searchByProfileId` in all six locales and its
 * placeholder is `my-collectables-id`, which is a `publicId` — the slug the app
 * invites people to share so others can find them. Until 2026-10-13 neither
 * reader looked at it: `app/people.tsx` and `components/search-overlay.tsx`
 * each filtered on `username` and `displayName`, and `profilesSearchUrl` sent
 * `or=(username.ilike.…,display_name.ilike.…)`. So somebody who passed their
 * profile ID to a friend was unfindable by it, on the page AND on the server,
 * under a field that names it.
 *
 * The two client filters were also the same five lines written twice, which is
 * the defect most of this repository's history is about removing. One
 * predicate, and the server's `or=` list is derived from the same field names
 * so a fourth field cannot be added to one half only.
 */

/** The fields a profile is findable by. */
export interface SearchableProfile {
  readonly username: string;
  readonly displayName: string;
  readonly publicId: string;
}

/**
 * The columns the server searches, in the order the `or=` list spells them.
 *
 * Exported so `profilesSearchUrl` builds its filter from this list rather than
 * from a hand-written copy: the page the client already holds and the rest of
 * the table have to answer the same question, or a match appears and
 * disappears as the page scrolls.
 */
export const PROFILE_SEARCH_COLUMNS = ["username", "display_name", "public_id"] as const;

/**
 * The text to compare against, from what somebody typed.
 *
 * `@` is stripped because the app prints every handle with one, so a user who
 * copies `@anna` out of a profile header is typing a handle and not a
 * character class. Lower-cased because the client comparison is
 * `includes` — the server's half is `ilike`, which is case-insensitive by
 * definition.
 */
export function profileSearchNeedle(query: string): string {
  return query.trim().toLowerCase().replace(/^@/, "");
}

/**
 * Whether this profile answers the needle.
 *
 * A substring match on all three fields, which is what both client readers
 * already did on two of them. An empty needle matches everything, and that is
 * the callers' cue to skip the filter entirely rather than a meaning of its
 * own — `"".includes("")` is `true`, so the answer is at least consistent.
 */
export function profileMatchesSearch(profile: SearchableProfile, needle: string): boolean {
  return (
    profile.username.toLowerCase().includes(needle) ||
    profile.displayName.toLowerCase().includes(needle) ||
    profile.publicId.toLowerCase().includes(needle)
  );
}
