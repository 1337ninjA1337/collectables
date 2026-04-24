/**
 * Extracts the Cloudinary public ID (without extension) from a Cloudinary image URL.
 * Returns null if the URL is not a recognized Cloudinary upload URL.
 */
export function extractPublicId(cloudinaryUrl: string): string | null {
  const match = cloudinaryUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
  return match?.[1] ?? null;
}
