/**
 * The profile fields this app searches, guards and identifies people by —
 * named once, with every fact about each one in the same row.
 *
 * Until 2026-10-19 there were three lists and two spellings of one subject:
 *
 *  - `PROFILE_SEARCH_COLUMNS` in `lib/profile-search.ts` — the three SNAKE
 *    columns the server's `or=` list searches, which the client predicate
 *    also matches on by construction.
 *  - `UNIQUE_SEARCH_FIELDS` in the same module — the two CAMEL fields whose
 *    columns carry a UNIQUE index, which is the whole argument behind
 *    `rankProfileMatch`'s top band.
 *  - `GUARDED_FIELDS` in `lib/check-profile-id-pii.ts` — the identifiers an
 *    email address must not reach inline, held in BOTH spellings because that
 *    guard scans source rather than rows.
 *
 * Three lists, two spellings, one set of fields, and the only thing tying any
 * pair of them was a case-fold a reader had to perform in their head. The tie
 * already needed a test (`profiles-search.test.ts` compares the search list
 * against the guard's list and happens to work, because `publicId` and
 * `public_id` are the same column), and `GUARDED_FIELDS` already held both
 * spellings of two fields for exactly this reason. A fourth list — or a fourth
 * field — is what the arrangement could not survive: added to one list, it
 * reaches the server without the client, or the client without the guard.
 *
 * So the facts live in rows and the lists are derived. Adding a field means
 * one row and five answers; it cannot mean "searchable here, unknown there".
 *
 * `unique` is a claim about the DATABASE, not about this module:
 * `profiles_username_key` and `profiles_public_id_key` are the UNIQUE indexes
 * `supabase/migrations/20260423_base_schema.sql` creates, and
 * `profiles-search.test.ts` reads every migration to hold these rows to them.
 * A migration that dropped one makes that case red rather than making band 0
 * quietly wrong.
 */

/** The camel-case spellings — how the app's own types name a profile field. */
export type ProfileFieldCamel = "username" | "displayName" | "publicId";

/** The snake-case spellings — how `profiles` names its columns. */
export type ProfileFieldSnake = "username" | "display_name" | "public_id";

/**
 * One profile field, and everything the tree currently decides about it.
 *
 * Every flag is a question some reader used to answer from a list of its own:
 *
 *  - `searchable` — in the server's `or=` filter AND in the client predicate.
 *    The two halves must agree or a match appears and disappears as the page
 *    scrolls, which is why this is one flag rather than two.
 *  - `unique` — the column has a UNIQUE index, so an exact match is THE answer
 *    rather than an answer. Only a searchable unique field reaches band 0.
 *  - `piiGuarded` — `lint:profile-id-pii` refuses an email address reaching
 *    this field inline. True of the identifiers a person shares and does not
 *    choose at sign-up; deliberately false for `displayName`, where deriving
 *    "ada" from `ada@example.com` is the intended behaviour and a rule that
 *    fires on correct code is one somebody exempts and then ignores.
 */
export interface ProfileFieldDescriptor {
  readonly camel: ProfileFieldCamel;
  readonly snake: ProfileFieldSnake;
  readonly searchable: boolean;
  readonly unique: boolean;
  readonly piiGuarded: boolean;
}

/**
 * The table. Order is the `or=` list's order, which is load-bearing: the
 * server filter is built by mapping this list, and three suites read the
 * clause order out of the URL it produces.
 */
export const PROFILE_FIELDS = [
  { camel: "username", snake: "username", searchable: true, unique: true, piiGuarded: true },
  { camel: "displayName", snake: "display_name", searchable: true, unique: false, piiGuarded: false },
  { camel: "publicId", snake: "public_id", searchable: true, unique: true, piiGuarded: true },
] as const satisfies readonly ProfileFieldDescriptor[];

/**
 * The snake columns of the fields matching `predicate`, in table order.
 *
 * A helper rather than three `.filter().map()` chains at three call sites,
 * because the chains were the duplication one level down: each derivation is
 * "which rows, which spelling", and only the first half differs.
 */
export function profileFieldColumns(
  predicate: (field: ProfileFieldDescriptor) => boolean,
): readonly ProfileFieldSnake[] {
  return PROFILE_FIELDS.filter(predicate).map((field) => field.snake);
}

/** The camel names of the fields matching `predicate`, in table order. */
export function profileFieldNames(
  predicate: (field: ProfileFieldDescriptor) => boolean,
): readonly ProfileFieldCamel[] {
  return PROFILE_FIELDS.filter(predicate).map((field) => field.camel);
}

/**
 * Both spellings of the fields matching `predicate`, deduped, in table order.
 *
 * What a source-scanning reader wants: `lint:profile-id-pii` greps for
 * `publicId:` and for `public_id:` because a profile field is written in camel
 * in the app and in snake in a row literal, and it cannot know which file it
 * is looking at. `username` spells the same both ways, so the dedupe is the
 * difference between three entries and four — and a fourth field whose two
 * spellings coincide would otherwise double silently.
 */
export function profileFieldSpellings(
  predicate: (field: ProfileFieldDescriptor) => boolean,
): readonly (ProfileFieldCamel | ProfileFieldSnake)[] {
  const spellings: (ProfileFieldCamel | ProfileFieldSnake)[] = [];
  for (const field of PROFILE_FIELDS.filter(predicate)) {
    for (const spelling of [field.camel, field.snake] as const) {
      if (!spellings.includes(spelling)) spellings.push(spelling);
    }
  }
  return spellings;
}
