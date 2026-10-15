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
 * A query that has been through {@link sanitizeProfileSearchQuery}.
 *
 * A brand rather than a plain `string`, because the alternative was read
 * twice: `searchProfiles` sanitised the query for its own emptiness check and
 * then handed the RAW query to `profilesSearchUrl`, which sanitised it a
 * second time. Both were right and the pair is the two-readings-of-one-thing
 * shape most of this repository's history is about removing — a caller that
 * stopped sanitising still worked, and one that sanitised differently would
 * have won silently. The URL builder takes this type now, so there is exactly
 * one place the characters can be stripped and the compiler says so.
 *
 * The brand is a phantom property and never exists at runtime; the one `as`
 * is in the function that earns it.
 */
export type SanitizedProfileQuery = string & {
  readonly __brand: "sanitized-profile-query";
};

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
export function sanitizeProfileSearchQuery(query: string): SanitizedProfileQuery {
  return query
    .replace(/[%*,()\\"']/g, "")
    .trim()
    .replace(/^@/, "")
    .trim() as SanitizedProfileQuery;
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

/**
 * Anything with an id — what {@link mergeProfileMatches} dedupes on.
 *
 * Narrower than `UserProfile` on purpose, for the reason the rest of this
 * module takes {@link SearchableProfile}: the merge is about two lists of the
 * same rows arriving from two places, and nothing about it needs a bio or an
 * avatar.
 */
export interface IdentifiedProfile extends SearchableProfile {
  readonly id: string;
}

/**
 * How well a profile answers the needle: 0 best, 2 worst.
 *
 * Three bands rather than a score, because the only ordering question this
 * search has is the one a user can see going wrong:
 *
 *  - 0 — a searchable field IS the needle. Pasting a whole `publicId` or a
 *    whole handle is the commonest way this box is used (somebody sent it to
 *    you), and it is the one case where there is a single right answer.
 *  - 1 — a field STARTS with the needle. "ann" for "anna" is what typing
 *    looks like before you have finished.
 *  - 2 — a field contains it somewhere. Still a match, because both halves of
 *    this search are substring matches by construction, but the weakest kind:
 *    `profileMatchesSearch` is what admits it and this is what ranks it last.
 *
 * An empty needle is 0 for everything, which is consistent with
 * `profileMatchesSearch` matching everything on one — and the callers skip
 * the whole filter in that state anyway. It is answered before the
 * comparisons rather than left to fall out of them: every field starts with
 * `""`, so the bands would otherwise read 1 for an ordinary row and 0 for one
 * with an empty username, and those two would sort against each other for no
 * reason at all.
 */
export function rankProfileMatch(profile: SearchableProfile, needle: string): 0 | 1 | 2 {
  if (needle.length === 0) return 0;
  const fields = [profile.username, profile.displayName, profile.publicId].map((field) =>
    field.toLowerCase(),
  );
  if (fields.some((field) => field === needle)) return 0;
  if (fields.some((field) => field.startsWith(needle))) return 1;
  return 2;
}

/**
 * The two halves of a profile search as one list: best match first.
 *
 * Both readers (`app/people.tsx` and `components/search-overlay.tsx`) hold a
 * page of profiles and also ask the server for the rest of the table, and
 * both used to write `[...local, ...remote]` after deduping by id with a
 * `Set` of their own. That is three things written twice and one of them
 * wrong: the order was "whatever the loaded page happened to contain, then
 * the server's `created_at.desc`", so pasting somebody's whole profile ID
 * could put an unrelated substring match from page one ABOVE the exact match
 * that only the server knew about. The one query with an unambiguous answer
 * was the one most likely to show it second.
 *
 * Sorted by {@link rankProfileMatch} and STABLE within a band, which is what
 * keeps the rest of the old behaviour intact: among equally good matches the
 * loaded page still leads (it is already on screen) and the server's own
 * ordering still decides the tail. `Array.prototype.sort` is required to be
 * stable, so the input order is the tiebreak rather than an accident.
 *
 * `local` wins a duplicate, as it did in both call sites: the two lists
 * describe the same row and the local copy is the one the screen's other
 * reads are consistent with.
 */
export function mergeProfileMatches<T extends IdentifiedProfile>(
  local: readonly T[],
  remote: readonly T[],
  needle: string,
): T[] {
  const seen = new Set(local.map((profile) => profile.id));
  return [...local, ...remote.filter((profile) => !seen.has(profile.id))].sort(
    (a, b) => rankProfileMatch(a, needle) - rankProfileMatch(b, needle),
  );
}
