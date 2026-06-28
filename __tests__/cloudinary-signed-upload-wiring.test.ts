import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  signedUploadFields,
  SignedUploadParams,
} from "../lib/cloudinary-signed-upload";

/**
 * SEC-5b — structural assertions on `uploadImage` in `lib/cloudinary.ts`.
 * The module imports `react-native` (Platform) so it can't be executed under
 * the node runner; instead we pin the wiring contract: `uploadImage` requests a
 * server signature via `cloudSignUpload`, appends the signed multipart fields
 * (NO `upload_preset`) and POSTs to the signed cloud's endpoint, falling back to
 * the unsigned `upload_preset` path only when signing returns null (Supabase
 * unconfigured / no session). A small runtime check on the shared pure
 * `signedUploadFields` helper guards the field contract the wiring relies on.
 */

const SRC_PATH = path.join(process.cwd(), "lib", "cloudinary.ts");

function readSrc(): string {
  return readFileSync(SRC_PATH, "utf8");
}

describe("uploadImage — signed upload wiring (SEC-5b)", () => {
  it("requests a server signature via cloudSignUpload before uploading", () => {
    const src = readSrc();
    assert.match(src, /from "@\/lib\/supabase-cloudinary"/);
    assert.match(src, /const\s+signed\s*=\s*await\s+cloudSignUpload\(\)/);
  });

  it("appends the signed multipart fields when a signature is returned", () => {
    const src = readSrc();
    assert.match(src, /from "@\/lib\/cloudinary-signed-upload"/);
    assert.match(src, /if\s*\(signed\)\s*\{/);
    assert.match(src, /signedUploadFields\(signed\)/);
    assert.match(src, /form\.append\(key,\s*value\)/);
  });

  it("falls back to the unsigned upload_preset only when signing returns null", () => {
    const src = readSrc();
    // The unsigned preset append must live AFTER the `if (signed) { ... return }`
    // block so it is unreachable on the signed path.
    const signedIdx = src.indexOf("if (signed)");
    const presetIdx = src.indexOf('form.append("upload_preset"');
    assert.ok(signedIdx !== -1 && presetIdx !== -1);
    assert.ok(
      presetIdx > signedIdx,
      "upload_preset fallback must come after the signed branch",
    );
    assert.match(src, /form\.append\("upload_preset",\s*cloudinaryConfig\.uploadPreset\)/);
  });

  it("targets the signed cloud's endpoint", () => {
    const src = readSrc();
    assert.match(src, /function\s+signedUploadUrl\(params:\s*SignedUploadParams\)/);
    assert.match(src, /resolveCloudinaryApiBase\(undefined,\s*params\.cloudName\)/);
    assert.match(src, /return postUpload\(signedUploadUrl\(signed\),\s*form\)/);
  });

  it("shares the file-appending logic across both upload paths", () => {
    const src = readSrc();
    assert.match(src, /async\s+function\s+appendFile\(/);
    assert.match(src, /await\s+appendFile\(form,\s*localUri\)/);
  });
});

describe("signedUploadFields — field contract uploadImage relies on (SEC-5b)", () => {
  const params: SignedUploadParams = {
    cloudName: "demo",
    apiKey: "key-123",
    timestamp: 1700000000,
    signature: "sig-abc",
    folder: "collectables/users/u1",
  };

  it("echoes api_key/timestamp/signature/folder and never upload_preset", () => {
    const fields = signedUploadFields(params);
    assert.deepEqual(fields, {
      api_key: "key-123",
      timestamp: "1700000000",
      signature: "sig-abc",
      folder: "collectables/users/u1",
    });
    assert.ok(!("upload_preset" in fields));
    assert.equal(typeof fields.timestamp, "string");
  });
});
