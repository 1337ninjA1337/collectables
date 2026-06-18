import {
  CollectableItem,
  Collection,
  CollectionVisibility,
  ItemCondition,
  ItemTag,
  Reaction,
  ReactionEmoji,
  ReactionTargetType,
  UserProfile,
} from "@/lib/types";

/**
 * BE-10 — defensive `coerce*` validators for every Supabase read path.
 *
 * The DB now guarantees `NOT NULL` + defaults on the columns the client always
 * sends (`20260622_not_null_defaults.sql`), but a row can still reach the app
 * malformed: a legacy partial write from before that migration, a row from a
 * project where the migration hasn't been applied, an RLS-narrowed `select`
 * that omits a column, or a hand-edited dashboard row. The `to*` mappers in
 * `lib/supabase-profiles.ts` used to trust the raw JSON and feed a `null`
 * straight into a field typed as a plain `string`/`string[]`, which then
 * crashes downstream (`row.username.toLowerCase()`, `.map` on a null `photos`).
 *
 * These helpers take an `unknown` row (the genuine type of `await res.json()`)
 * and return a fully-typed domain object with every required field coalesced to
 * a safe default — mirroring the `coerceListing`/`normalizeListing` pattern in
 * `lib/marketplace-helpers.ts`. Pure (no react-native/auth imports) so the
 * tests exercise them without mocking `fetch`.
 */

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/** Coerce to a string, falling back to `fallback` (default `""`) for anything else. */
export function coerceString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Coerce to a finite number, or `null` (the typed contract for optional costs). */
export function coerceNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Coerce to a boolean, falling back to `fallback`. */
export function coerceBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Coerce to an array of strings, dropping any non-string entries. */
export function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const VISIBILITIES: CollectionVisibility[] = ["public", "private"];
const CONDITIONS: ItemCondition[] = ["new", "excellent", "good", "fair"];
const REACTION_EMOJIS: ReactionEmoji[] = ["heart", "fire", "eyes", "star", "clap"];
const REACTION_TARGETS: ReactionTargetType[] = ["collection", "item"];

function coerceTags(value: unknown): ItemTag[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags: ItemTag[] = [];
  for (const entry of value) {
    const t = asRecord(entry);
    if (typeof t.label === "string" && typeof t.color === "string") {
      tags.push({ label: t.label, color: t.color });
    }
  }
  return tags.length > 0 ? tags : undefined;
}

export function coerceProfileRow(raw: unknown): UserProfile {
  const r = asRecord(raw);
  return {
    id: coerceString(r.id),
    email: coerceString(r.email),
    displayName: coerceString(r.display_name),
    username: coerceString(r.username),
    publicId: coerceString(r.public_id),
    bio: coerceString(r.bio),
    avatar: coerceString(r.avatar),
    displayCurrency: typeof r.display_currency === "string" ? r.display_currency : null,
    isAdmin: r.is_admin === true,
  };
}

export function coerceCollectionRow(raw: unknown): Collection {
  const r = asRecord(raw);
  const visibility = VISIBILITIES.includes(r.visibility as CollectionVisibility)
    ? (r.visibility as CollectionVisibility)
    : "private";
  return {
    id: coerceString(r.id),
    name: coerceString(r.name),
    coverPhoto: coerceString(r.cover_photo),
    description: coerceString(r.description),
    ownerName: coerceString(r.owner_name),
    ownerUserId: coerceString(r.owner_user_id),
    sharedWith: [],
    sharedWithUserIds: coerceStringArray(r.shared_with_user_ids),
    role: "viewer",
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : undefined,
    visibility,
    currency: typeof r.currency === "string" ? r.currency : null,
  };
}

export function coerceItemRow(raw: unknown): CollectableItem {
  const r = asRecord(raw);
  const condition = CONDITIONS.includes(r.condition as ItemCondition)
    ? (r.condition as ItemCondition)
    : undefined;
  return {
    id: coerceString(r.id),
    collectionId: coerceString(r.collection_id),
    title: coerceString(r.title),
    acquiredAt: coerceString(r.acquired_at),
    acquiredFrom: coerceString(r.acquired_from),
    description: coerceString(r.description),
    variants: coerceString(r.variants),
    photos: coerceStringArray(r.photos),
    createdBy: coerceString(r.created_by),
    createdByUserId: coerceString(r.created_by_user_id),
    createdAt: coerceString(r.created_at),
    cost: coerceNumberOrNull(r.cost),
    costCurrency: typeof r.cost_currency === "string" ? r.cost_currency : undefined,
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : undefined,
    isWishlist: coerceBoolean(r.is_wishlist),
    condition,
    tags: coerceTags(r.tags),
    archivedAt: typeof r.archived_at === "string" ? r.archived_at : null,
  };
}

export function coerceReactionRow(raw: unknown): Reaction {
  const r = asRecord(raw);
  const targetType = REACTION_TARGETS.includes(r.target_type as ReactionTargetType)
    ? (r.target_type as ReactionTargetType)
    : "item";
  const emoji = REACTION_EMOJIS.includes(r.emoji as ReactionEmoji)
    ? (r.emoji as ReactionEmoji)
    : "heart";
  return {
    id: coerceString(r.id),
    userId: coerceString(r.user_id),
    targetType,
    targetId: coerceString(r.target_id),
    emoji,
    createdAt: coerceString(r.created_at),
  };
}
