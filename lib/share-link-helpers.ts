/**
 * Pure half of the share-a-deep-link flow — no React, no react-native, so it
 * is importable under the plain `tsx --test` harness (`lib/use-share-link.ts`
 * pulls in `Platform`/`Share` and is only reachable structurally).
 */

/** How long the "Link copied" confirmation stays up before reverting. */
export const COPIED_RESET_MS = 2000;

/**
 * Build the payload the OS share sheet receives. An entity name (item title,
 * collection name, profile display name) is prefixed on its own line; an empty
 * or absent name degrades to the bare link rather than a leading newline.
 */
export function buildSharePayload(url: string, message?: string): { message: string; url: string } {
  return { message: message ? `${message}\n${url}` : url, url };
}
