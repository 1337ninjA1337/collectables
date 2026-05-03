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

export const cloudinaryConfig: CloudinaryConfig = resolveCloudinaryConfig(
  process.env as Record<string, string | undefined>,
);
