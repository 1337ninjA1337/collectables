/**
 * Extracts the Cloudinary public ID (without extension) from a Cloudinary image URL.
 * Returns null if the URL is not a recognized Cloudinary upload URL.
 */
export function extractPublicId(cloudinaryUrl: string): string | null {
  const match = cloudinaryUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
  return match?.[1] ?? null;
}

/**
 * Builds the Cloudinary REST API base ("https://api.cloudinary.com/v1_1/<cloud>")
 * from env-style inputs. If `apiBase` is provided it wins (useful for swapping
 * regions or staging endpoints); otherwise falls back to the default host with
 * the supplied cloud name. Trailing slashes are stripped so callers can safely
 * append `/image/upload` etc.
 */
export function resolveCloudinaryApiBase(
  apiBase: string | undefined | null,
  cloudName: string,
): string {
  const trimmed = (apiBase ?? "").replace(/\/+$/, "");
  if (trimmed) return trimmed;
  return `https://api.cloudinary.com/v1_1/${cloudName}`;
}
