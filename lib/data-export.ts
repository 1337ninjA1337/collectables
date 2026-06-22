/**
 * BE-26 — pure request/response shapes for the GDPR `export-data` Edge Function.
 *
 * No react-native / Supabase imports — every helper here is unit-testable in
 * node. The Edge Function (`supabase/functions/export-data/index.ts`) and the
 * client wrapper (`lib/supabase-data-export.ts`) consume these so the export
 * contract lives in one place.
 *
 * The export is the user's "right to data portability" (GDPR Art. 20) bundle:
 * everything the app stores keyed on the caller's `auth.uid()` — their profile,
 * owned collections, authored items, friend requests (both directions), chat
 * messages (sent + received), and subscription history — assembled into a single
 * machine-readable JSON document the user can download. The Edge Function is the
 * service-role reader (so it can see every row regardless of RLS read scope) and
 * always subjects the export to the authenticated caller, never a body value.
 */

/** Bump when the document shape changes so a consumer can branch on it. */
export const DATA_EXPORT_VERSION = 1;

/**
 * The tables included in a data export, in a stable order. Each becomes a
 * top-level array on the document (except `profile`, which is a single row).
 * Kept here as the single source of truth so the function, the parser, and the
 * tests agree on coverage.
 */
export const DATA_EXPORT_TABLES = [
  "collections",
  "items",
  "friendRequests",
  "chatMessages",
  "subscriptions",
] as const;

export type DataExportTable = (typeof DATA_EXPORT_TABLES)[number];

/** The full export document the Edge Function returns / the client downloads. */
export type DataExportDocument = {
  version: number;
  exportedAt: string;
  userId: string;
  profile: Record<string, unknown> | null;
  collections: Record<string, unknown>[];
  items: Record<string, unknown>[];
  friendRequests: Record<string, unknown>[];
  chatMessages: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
};

/** BE-26: the `export-data` Edge Function endpoint. */
export function dataExportUrl(baseUrl: string): string {
  return `${baseUrl}/functions/v1/export-data`;
}

/** A stable, human-friendly filename for a downloaded export. */
export function dataExportFileName(exportedAt: string = new Date().toISOString()): string {
  const day = exportedAt.slice(0, 10) || "export";
  return `collectables-export-${day}.json`;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
  );
}

/**
 * Assemble a `DataExportDocument` from the raw table reads. Pure so both the
 * Edge Function shape and the tests share one definition; defensive against
 * null/undefined table reads (a failed read collapses to an empty array rather
 * than a malformed document).
 */
export function buildDataExport(parts: {
  userId: string;
  profile?: unknown;
  collections?: unknown;
  items?: unknown;
  friendRequests?: unknown;
  chatMessages?: unknown;
  subscriptions?: unknown;
  exportedAt?: string;
}): DataExportDocument {
  const profile =
    typeof parts.profile === "object" && parts.profile !== null
      ? (parts.profile as Record<string, unknown>)
      : null;
  return {
    version: DATA_EXPORT_VERSION,
    exportedAt: parts.exportedAt ?? new Date().toISOString(),
    userId: parts.userId,
    profile,
    collections: asRows(parts.collections),
    items: asRows(parts.items),
    friendRequests: asRows(parts.friendRequests),
    chatMessages: asRows(parts.chatMessages),
    subscriptions: asRows(parts.subscriptions),
  };
}

/**
 * Coerce an arbitrary response body into a safe `DataExportDocument`, or `null`
 * when it is not a recognisable export (missing/blank `userId`). Mirrors the
 * defensive `parseValidation` pattern.
 */
export function parseDataExport(raw: unknown): DataExportDocument | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Partial<DataExportDocument>;
  if (typeof obj.userId !== "string" || obj.userId.length === 0) return null;
  return buildDataExport({
    userId: obj.userId,
    profile: obj.profile,
    collections: obj.collections,
    items: obj.items,
    friendRequests: obj.friendRequests,
    chatMessages: obj.chatMessages,
    subscriptions: obj.subscriptions,
    exportedAt:
      typeof obj.exportedAt === "string" && obj.exportedAt.length > 0
        ? obj.exportedAt
        : undefined,
  });
}
