import { makeExpoPublicEnvReader } from "@/lib/expo-public-env";
import { resolveCloudinaryApiBase } from "@/lib/cloudinary-url";

export type CloudinaryConfig = {
  apiBase: string;
  cloudName: string;
  uploadPreset: string;
};

export function resolveCloudinaryConfig(env: Record<string, string | undefined>): CloudinaryConfig {
  const cloudName = env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || "dt57phtma";
  const uploadPreset = env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "collectables";
  const apiBase = resolveCloudinaryApiBase(env.EXPO_PUBLIC_CLOUDINARY_URL, cloudName);
  return { apiBase, cloudName, uploadPreset };
}

/** Every EXPO_PUBLIC_ var the Cloudinary resolver supports, declared once. */
export const CLOUDINARY_ENV_VAR_NAMES = [
  "EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME",
  "EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET",
  "EXPO_PUBLIC_CLOUDINARY_URL",
] as const;

/**
 * Reads the Cloudinary env vars from `process.env` using *literal* member
 * accesses. Metro / babel-preset-expo only inlines
 * `process.env.EXPO_PUBLIC_*` references when it sees them as direct member
 * expressions in source — passing `process.env` whole to a helper bypasses
 * the transform and every value reads `undefined` in the production bundle
 * (same footgun fixed for Sentry in `lib/sentry-config.ts`). The
 * `makeExpoPublicEnvReader` wrapper enforces name-tuple ↔ literal-object
 * parity at compile time (see lib/expo-public-env.ts).
 */
export const readCloudinaryEnvFromProcess = makeExpoPublicEnvReader(
  "lib/cloudinary-config.ts",
  CLOUDINARY_ENV_VAR_NAMES,
  () => ({
    EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME: process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME,
    EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET: process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET,
    EXPO_PUBLIC_CLOUDINARY_URL: process.env.EXPO_PUBLIC_CLOUDINARY_URL,
  }),
);

export const cloudinaryConfig: CloudinaryConfig = resolveCloudinaryConfig(
  readCloudinaryEnvFromProcess(),
);
