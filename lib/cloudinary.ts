import { Platform } from "react-native";

import { cloudinaryConfig } from "@/lib/cloudinary-config";
import { extractPublicId, resolveCloudinaryApiBase } from "@/lib/cloudinary-url";
import {
  signedUploadFields,
  SignedUploadParams,
} from "@/lib/cloudinary-signed-upload";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cloudSignUpload } from "@/lib/supabase-cloudinary";
import { deleteImagesViaEdgeFunction } from "@/lib/supabase-profiles";

const UPLOAD_PATH = "/image/upload";
const UNSIGNED_UPLOAD_URL = `${cloudinaryConfig.apiBase}${UPLOAD_PATH}`;

async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return res.blob();
}

async function appendFile(form: FormData, localUri: string): Promise<void> {
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
}

// SEC-5b: target the cloud the server signed for. When it matches the
// configured cloud we keep any custom apiBase host (region/staging); otherwise
// fall back to the default Cloudinary host for that cloud name.
function signedUploadUrl(params: SignedUploadParams): string {
  const base =
    params.cloudName === cloudinaryConfig.cloudName
      ? cloudinaryConfig.apiBase
      : resolveCloudinaryApiBase(undefined, params.cloudName);
  return `${base}${UPLOAD_PATH}`;
}

async function postUpload(url: string, form: FormData): Promise<string> {
  const res = await fetch(url, {
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

export async function uploadImage(localUri: string): Promise<string> {
  // SEC-5b: prefer a JWT-checked signed upload (per-user folder, signature from
  // the `sign-upload` Edge Function) over the open unsigned `upload_preset`.
  // `cloudSignUpload` returns null when Supabase is unconfigured / there is no
  // session / signing fails, in which case we fall back to the unsigned preset
  // so image uploads never break.
  const signed = await cloudSignUpload();

  const form = new FormData();
  await appendFile(form, localUri);

  if (signed) {
    const fields = signedUploadFields(signed);
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
    return postUpload(signedUploadUrl(signed), form);
  }

  // Unsigned fallback: only reached without a Supabase session.
  form.append("upload_preset", cloudinaryConfig.uploadPreset);
  return postUpload(UNSIGNED_UPLOAD_URL, form);
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
