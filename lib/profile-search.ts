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
 * What somebody typed, reduced to the characters that can be matched.
 *
 * Strips every character that carries meaning inside a PostgREST `or=(...)`
 * filter or an `ilike` pattern (commas and parens break the boolean tree; `%`,
 * `*` and `\\` are wildcards; quotes end a quoted literal), then a leading `@`
 * so users can paste an `@handle` verbatim. What is left is matched as a plain
 * substring.
 *
 * It lives here rather than in `supabase-profiles-shapes.ts` because it is a
 * fact about the QUERY and not about the URL, and because the client half has
 * to run it too: {@link profileSearchNeedle} composes it. Before 2026-10-13
 * only the server half sanitised, so `anna*` searched `*anna*` on the server
 * and matched nothing at all on the loaded page — and with Supabase
 * unconfigured, where the server half returns nothing by design, it matched
 * nobody anywhere.
 *
 * The `@` strip moved AFTER the metacharacter strip in the same change, so
 * `%@anna` reduces to `anna` rather than to `@anna`. Both halves agreed on
 * `@anna` before, so this is the smaller of the two fixes, but it is the same
 * one: a leading `@` is what the app prints in front of every handle.
 */
export function sanitizeProfileSearchQuery(query: string): string {
  return query.replace(/[%*,()\\"']/g, "").trim().replace(/^@/, "").trim();
}

/**
 * The text the client compares against, from what somebody typed.
 *
 * {@link sanitizeProfileSearchQuery} lower-cased, and the composition is the
 * point: the client comparison is `includes` while the server's is `ilike`, so
 * case is the ONE thing the two halves may legitimately handle differently —
 * `ilike` is case-insensitive by definition. Everything else they must agree
 * on, or a match appears and disappears as the page scrolls.
 */
export function profileSearchNeedle(query: string): string {
  return sanitizeProfileSearchQuery(query).toLowerCase();
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
