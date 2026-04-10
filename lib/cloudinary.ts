import { Platform } from "react-native";

const CLOUD_NAME = "dt57phtma";
const UPLOAD_PRESET = "collectables";
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

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

  form.append("upload_preset", UPLOAD_PRESET);

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
