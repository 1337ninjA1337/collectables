// Cheap vision integration via Google Gemini Flash.
// Set EXPO_PUBLIC_GEMINI_API_KEY in .env to enable.

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export type ItemAnalysis = {
  title: string;
  description: string;
  variants: string;
};

export const isAiVisionConfigured = Boolean(GEMINI_API_KEY);

const LANGUAGE_NAMES: Record<string, string> = {
  ru: "Russian",
  en: "English",
  be: "Belarusian",
  pl: "Polish",
  de: "German",
  es: "Spanish",
};

async function uriToBase64(uri: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const mimeType = blob.type || "image/jpeg";
  const data: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { data, mimeType };
}

function extractJson(text: string): unknown {
  // Strip markdown code fences if present
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to find first { ... } block
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("AI response is not valid JSON");
  }
}

export async function analyzeItemPhoto(
  uri: string,
  language: string = "en",
): Promise<ItemAnalysis> {
  if (!isAiVisionConfigured) {
    throw new Error("AI vision not configured");
  }

  const { data, mimeType } = await uriToBase64(uri);
  const langName = LANGUAGE_NAMES[language] ?? "English";

  const prompt =
    `You are helping a collector catalog an item from a photograph. ` +
    `Identify the collectible object in the image and respond strictly in ${langName}. ` +
    `Return ONLY a JSON object with exactly these keys: ` +
    `"title" (a short item name, max 60 chars), ` +
    `"description" (1-3 sentences describing what it is, history or notable facts), ` +
    `"variants" (notable variants, editions, colorways, or empty string if none). ` +
    `Do not wrap the JSON in code fences.`;

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  };

  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Gemini error: ${response.status}`);
  }

  const json = await response.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty AI response");
  }

  const parsed = extractJson(text) as Partial<ItemAnalysis>;
  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    description: typeof parsed.description === "string" ? parsed.description : "",
    variants: typeof parsed.variants === "string" ? parsed.variants : "",
  };
}
