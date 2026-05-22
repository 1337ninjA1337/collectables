import { Platform } from "react-native";

import { cloudinaryConfig } from "@/lib/cloudinary-config";
import { extractPublicId } from "@/lib/cloudinary-url";
import { isSupabaseConfigured } from "@/lib/supabase";
import { deleteImagesViaEdgeFunction } from "@/lib/supabase-profiles";

const UPLOAD_URL = `${cloudinaryConfig.apiBase}/image/upload`;

async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return res.blob();
}

export async function uploadImage(localUri: string): Promise<string> {
  const form = new FormData();

  if (Platform.OS === "web") {
    // On web, convert the blob/data URI to an actual Blob for FormData
    const blob = await uriToBlob(localUri);
    form.append("file", blob, "upload.jpg");
  } else {
    // On native, React Native's FormData accepts { uri, type, name }
    const file = {
      uri: localUri,
      type: "image/jpeg",
      name: "upload.jpg",
    } as unknown as Blob;
    form.append("file", file);
  }

  form.append("upload_preset", cloudinaryConfig.uploadPreset);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloudinary upload failed: ${text}`);
  }

  const data = await res.json();
  return data.secure_url as string;
}

export async function uploadImages(localUris: string[]): Promise<string[]> {
  return Promise.all(localUris.map(uploadImage));
}

// SEC-1: deletion is delegated to the `delete-image` Edge Function. The
// Cloudinary API secret lives only in Supabase function secrets — it must
// never be an EXPO_PUBLIC_* var (Metro inlines those into the bundle).
export const isCloudinaryDeleteConfigured = isSupabaseConfigured;

export async function deleteCloudinaryImages(urls: string[]): Promise<void> {
  const publicIds = urls
    .map(extractPublicId)
    .filter((id): id is string => id !== null);
  if (publicIds.length === 0) return;
  // Best-effort: an orphaned asset is not a user data-loss bug, so a failed
  // delete is swallowed exactly as the previous client-side path did.
  await deleteImagesViaEdgeFunction(publicIds);
}
