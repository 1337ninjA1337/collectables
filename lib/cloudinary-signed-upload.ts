/**
 * SEC-5a — signed Cloudinary upload foundation.
 *
 * Pure, framework-free helpers (no `react-native`, no `@/lib/supabase`) shared
 * by BOTH the client wrapper (`lib/supabase-cloudinary.ts`) and the Deno
 * `sign-upload` Edge Function (which imports this file by its `.ts` relative
 * path, exactly like `delete-image` imports `service-role-claim.ts`). Keeping
 * the folder convention + signature algorithm here makes them a single source
 * of truth: the function computes the signature, the client appends the same
 * fields, and the structural tests verify both against these helpers.
 *
 * The unsigned `upload_preset` in `lib/cloudinary.ts` is an open write endpoint
 * (anyone with the bundle can upload to the account). The fix routes uploads
 * through a JWT-checked Edge Function that signs a per-user folder server-side
 * with `CLOUDINARY_API_SECRET` (which never reaches the client). This module is
 * the contract; the actual upload-path rewire is SEC-5b.
 */

/** Root folder every user upload is scoped under (per-user subfolder below). */
export const SIGNED_UPLOAD_FOLDER_ROOT = "collectables/users";

/**
 * Per-user Cloudinary folder for signed uploads. The user id comes from the
 * function's `auth.getUser()` (never a body-supplied value), so a caller can
 * only ever write under their own folder.
 */
export function uploadFolderForUser(userId: string): string {
  return `${SIGNED_UPLOAD_FOLDER_ROOT}/${userId}`;
}

/**
 * Cloudinary signature string: every signed param EXCEPT `file`, `cloud_name`,
 * `resource_type` and `api_key`, sorted alphabetically by key and joined as
 * `key=value` with `&`. The API secret is appended by `cloudinaryUploadSignature`
 * BEFORE hashing — never include it here (so this stays node-testable without a
 * secret). Mirrors the destroy-signature shape inlined in `delete-image`.
 */
const SIGNATURE_EXCLUDED_KEYS = new Set([
  "file",
  "cloud_name",
  "resource_type",
  "api_key",
  "signature",
]);

export function buildUploadSignatureString(
  params: Record<string, string | number | undefined | null>,
): string {
  return Object.keys(params)
    .filter((key) => !SIGNATURE_EXCLUDED_KEYS.has(key))
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

/**
 * SHA-1 hex of the canonical signature string + the API secret. Uses Web Crypto
 * `crypto.subtle`, a global in both the Deno runtime and Node ≥ 18 (so the real
 * function code is exercised by the node tests).
 */
export async function cloudinaryUploadSignature(
  params: Record<string, string | number | undefined | null>,
  apiSecret: string,
): Promise<string> {
  const signatureString = `${buildUploadSignatureString(params)}${apiSecret}`;
  const buffer = new TextEncoder().encode(signatureString);
  const hash = await crypto.subtle.digest("SHA-1", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function signUploadUrl(baseUrl: string): string {
  return `${baseUrl}/functions/v1/sign-upload`;
}

/**
 * The server-validated upload credentials the client needs to POST a signed
 * upload directly to Cloudinary. `signature` proves the `folder`+`timestamp`
 * were authorised server-side; the API secret stays on the server.
 */
export type SignedUploadParams = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
};

function coerceNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function coerceTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
}

/**
 * Defensive coercion of the function's JSON response. Returns `null` on any
 * missing/blank field so the client (SEC-5b) falls back to the unsigned path
 * rather than POSTing a half-formed signed request that Cloudinary 401s.
 */
export function parseSignedUpload(raw: unknown): SignedUploadParams | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const cloudName = coerceNonEmptyString(obj.cloudName);
  const apiKey = coerceNonEmptyString(obj.apiKey);
  const signature = coerceNonEmptyString(obj.signature);
  const folder = coerceNonEmptyString(obj.folder);
  const timestamp = coerceTimestamp(obj.timestamp);
  if (!cloudName || !apiKey || !signature || !folder || timestamp === null) {
    return null;
  }
  return { cloudName, apiKey, timestamp, signature, folder };
}

/**
 * The multipart fields the client appends alongside `file` for a signed upload.
 * Order-independent; `upload_preset` is NOT included (signed uploads don't use
 * the open preset). Centralised so the SEC-5b wiring and its test agree.
 */
export function signedUploadFields(params: SignedUploadParams): Record<string, string> {
  return {
    api_key: params.apiKey,
    timestamp: String(params.timestamp),
    signature: params.signature,
    folder: params.folder,
  };
}
