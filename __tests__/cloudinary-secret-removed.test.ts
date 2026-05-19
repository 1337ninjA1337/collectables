import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("SEC-1 — Cloudinary secret is gone from the client", () => {
  const src = read("lib/cloudinary.ts");

  it("lib/cloudinary.ts never references the API secret env var", () => {
    assert.doesNotMatch(
      src,
      /EXPO_PUBLIC_CLOUDINARY_API_SECRET/,
      "the Cloudinary API secret must not be read in client code — Metro inlines EXPO_PUBLIC_* into the bundle",
    );
    assert.doesNotMatch(
      src,
      /EXPO_PUBLIC_CLOUDINARY_API_KEY/,
      "the Cloudinary API key must not be read in client code either",
    );
  });

  it("no client-side destroy signing remains", () => {
    assert.doesNotMatch(
      src,
      /crypto\.subtle\.digest/,
      "client must not compute the Cloudinary destroy signature",
    );
    assert.doesNotMatch(
      src,
      /image\/destroy/,
      "client must not call the Cloudinary destroy endpoint directly",
    );
  });

  it("deletes are routed through the delete-image Edge Function helper", () => {
    assert.match(
      src,
      /deleteImagesViaEdgeFunction/,
      "deleteCloudinaryImages must delegate to deleteImagesViaEdgeFunction",
    );
  });

  it("no .env / .env.example commits the secret", () => {
    for (const f of [".env", ".env.example"]) {
      if (existsSync(join(ROOT, f))) {
        assert.doesNotMatch(
          read(f),
          /CLOUDINARY_API_SECRET\s*=\s*\S/,
          `${f} must not contain a Cloudinary API secret value`,
        );
      }
    }
  });
});

describe("SEC-1 — delete-image Edge Function holds the secret server-side", () => {
  const fnPath = "supabase/functions/delete-image/index.ts";

  it("the function file exists", () => {
    assert.ok(
      existsSync(join(ROOT, fnPath)),
      `${fnPath} must exist`,
    );
  });

  const fn = read(fnPath);

  it("reads the Cloudinary secret from Deno.env, never EXPO_PUBLIC_*", () => {
    assert.match(
      fn,
      /Deno\.env\.get\(\s*["']CLOUDINARY_API_SECRET["']\s*\)/,
      "the secret must come from a server-side function secret",
    );
    assert.doesNotMatch(
      fn,
      /EXPO_PUBLIC_/,
      "an Edge Function must never reference EXPO_PUBLIC_* (client) vars",
    );
  });

  it("verifies the caller's session before acting (mirrors delete-account)", () => {
    assert.match(
      fn,
      /req\.headers\.get\(\s*["']Authorization["']\s*\)/,
      "must read the Authorization header",
    );
    assert.match(
      fn,
      /auth\.getUser\(\)/,
      "must verify the caller via auth.getUser()",
    );
    assert.match(
      fn,
      /\b401\b/,
      "must reject missing/invalid sessions with 401",
    );
  });

  it("computes the destroy signature server-side", () => {
    assert.match(
      fn,
      /crypto\.subtle\.digest\(\s*["']SHA-1["']/,
      "signature must be computed in the function, not the client",
    );
    assert.match(
      fn,
      /api\.cloudinary\.com\/v1_1\//,
      "must call the Cloudinary destroy API server-side",
    );
  });

  it("does not hardcode any secret literal", () => {
    // crude but effective: no long hex/base64-ish literal assigned to a
    // secret-looking identifier.
    assert.doesNotMatch(
      fn,
      /(api[_-]?secret|apiSecret)\s*[:=]\s*["'][A-Za-z0-9_\-]{12,}["']/i,
      "no inline secret literal allowed",
    );
  });
});

describe("SEC-1 — supabase-profiles exposes the edge-function client helper", () => {
  const src = read("lib/supabase-profiles.ts");

  it("exports deleteImagesViaEdgeFunction posting to /functions/v1/delete-image", () => {
    assert.match(
      src,
      /export async function deleteImagesViaEdgeFunction/,
      "helper must be exported",
    );
    assert.match(
      src,
      /functions\/v1\/delete-image/,
      "helper must target the delete-image Edge Function",
    );
    assert.match(
      src,
      /Authorization:\s*`Bearer \$\{token\}`/,
      "helper must forward the caller's JWT so the function can verify it",
    );
  });
});
