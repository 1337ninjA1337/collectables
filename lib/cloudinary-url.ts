/**
 * Extracts the Cloudinary public ID (without extension) from a Cloudinary image URL.
 * Returns null if the URL is not a recognized Cloudinary upload URL.
 */
export function extractPublicId(cloudinaryUrl: string): string | null {
  const match = cloudinaryUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
  return match?.[1] ?? null;
}

/**
 * Wrap a Cloudinary delivery URL with on-the-fly resize + format transforms so
 * a hero/grid image fetches a sensibly-sized JPEG/WebP/AVIF instead of the
 * original (which can be multi-MB and crashes iOS Safari when decoded into a
 * small viewport).
 *
 * - `c_limit` never upscales (safe default for any container size).
 * - `f_auto` lets Cloudinary serve AVIF/WebP to capable browsers.
 * - `q_auto` chooses a perceptual-quality tier.
 *
 * Pass-through for non-Cloudinary URLs (data: URIs, local file:// paths,
 * other CDNs) and for URLs that already carry a transform block.
 */
export function withCloudinaryThumbUrl(
  url: string,
  options: { width: number; height?: number; mode?: "limit" | "fill" | "fit" } = { width: 800 },
): string {
  if (!url) return url;
  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const after = url.slice(idx + marker.length);
  const firstSegment = after.split("/")[0] ?? "";
  const hasExtension = /\.[a-z0-9]{2,4}$/i.test(firstSegment);
  const looksLikeTransform = !hasExtension && /^[a-z]{1,3}_/i.test(firstSegment);
  if (looksLikeTransform) return url;
  const mode = options.mode ?? "limit";
  const parts = [`c_${mode}`, `w_${options.width}`];
  if (options.height) parts.push(`h_${options.height}`);
  parts.push("q_auto", "f_auto");
  return url.slice(0, idx + marker.length) + parts.join(",") + "/" + after;
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
