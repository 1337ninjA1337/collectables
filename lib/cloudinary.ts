import { Platform } from "react-native";

import { cloudinaryConfig } from "@/lib/cloudinary-config";
import { extractPublicId } from "@/lib/cloudinary-url";

const UPLOAD_URL = `${cloudinaryConfig.apiBase}/image/upload`;
const DESTROY_URL = `${cloudinaryConfig.apiBase}/image/destroy`;

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

const API_KEY = process.env.EXPO_PUBLIC_CLOUDINARY_API_KEY ?? "";
const API_SECRET = process.env.EXPO_PUBLIC_CLOUDINARY_API_SECRET ?? "";

export const isCloudinaryDeleteConfigured = Boolean(API_KEY && API_SECRET);

async function deleteImage(publicId: string): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signatureString = `public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`;

  const msgBuffer = new TextEncoder().encode(signatureString);
  const hashBuffer = await crypto.subtle.digest("SHA-1", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const signature = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", timestamp);
  form.append("api_key", API_KEY);
  form.append("signature", signature);

  await fetch(DESTROY_URL, {
    method: "POST",
    body: form,
  });
}

export async function deleteCloudinaryImages(urls: string[]): Promise<void> {
  if (!isCloudinaryDeleteConfigured) return;

  const publicIds = urls.map(extractPublicId).filter((id): id is string => id !== null);
  await Promise.allSettled(publicIds.map(deleteImage));
}
