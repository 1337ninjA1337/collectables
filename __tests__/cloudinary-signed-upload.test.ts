import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  buildUploadSignatureString,
  cloudinaryUploadSignature,
  parseSignedUpload,
  signedUploadFields,
  SIGNED_UPLOAD_FOLDER_ROOT,
  signUploadUrl,
  uploadFolderForUser,
} from "../lib/cloudinary-signed-upload.ts";

/**
 * SEC-5a — behavioural tests for the pure signed-upload helpers. These run the
 * REAL signature algorithm (Web Crypto SHA-1, a global in Node ≥ 18) so the
 * Edge Function and client share a verified contract.
 */

describe("uploadFolderForUser", () => {
  it("scopes every user under the shared root folder", () => {
    assert.equal(uploadFolderForUser("abc-123"), `${SIGNED_UPLOAD_FOLDER_ROOT}/abc-123`);
    assert.match(uploadFolderForUser("u"), /^collectables\/users\//);
  });
});

describe("buildUploadSignatureString", () => {
  it("sorts params alphabetically and joins key=value with &", () => {
    assert.equal(
      buildUploadSignatureString({ timestamp: 1700000000, folder: "collectables/users/u1" }),
      "folder=collectables/users/u1&timestamp=1700000000",
    );
  });

  it("excludes file/cloud_name/resource_type/api_key/signature from the signed set", () => {
    const str = buildUploadSignatureString({
      file: "blob",
      cloud_name: "demo",
      resource_type: "image",
      api_key: "123",
      signature: "deadbeef",
      folder: "f",
      timestamp: 1,
    });
    assert.equal(str, "folder=f&timestamp=1");
  });

  it("drops undefined/null/empty values rather than signing them", () => {
    assert.equal(
      buildUploadSignatureString({ folder: "f", timestamp: 1, public_id: undefined, tags: "" }),
      "folder=f&timestamp=1",
    );
  });

  it("never appends the secret itself (testable without one)", () => {
    assert.doesNotMatch(buildUploadSignatureString({ folder: "f", timestamp: 1 }), /secret/i);
  });
});

describe("cloudinaryUploadSignature", () => {
  it("matches Cloudinary's documented SHA-1(sortedParams + apiSecret)", async () => {
    const params = { folder: "collectables/users/u1", timestamp: 1700000000 };
    const apiSecret = "test-secret";
    const expected = createHash("sha1")
      .update(`folder=collectables/users/u1&timestamp=1700000000${apiSecret}`)
      .digest("hex");
    assert.equal(await cloudinaryUploadSignature(params, apiSecret), expected);
  });

  it("changes when the folder changes (binds the upload to the per-user folder)", async () => {
    const ts = 1700000000;
    const a = await cloudinaryUploadSignature({ folder: "collectables/users/a", timestamp: ts }, "s");
    const b = await cloudinaryUploadSignature({ folder: "collectables/users/b", timestamp: ts }, "s");
    assert.notEqual(a, b);
  });

  it("returns a 40-char lowercase hex digest", async () => {
    const sig = await cloudinaryUploadSignature({ folder: "f", timestamp: 1 }, "s");
    assert.match(sig, /^[0-9a-f]{40}$/);
  });
});

describe("signUploadUrl", () => {
  it("targets the sign-upload Edge Function", () => {
    assert.equal(
      signUploadUrl("https://proj.supabase.co"),
      "https://proj.supabase.co/functions/v1/sign-upload",
    );
  });
});

describe("parseSignedUpload", () => {
  const good = {
    cloudName: "demo",
    apiKey: "123456",
    timestamp: 1700000000,
    signature: "abcdef",
    folder: "collectables/users/u1",
  };

  it("accepts a complete response", () => {
    assert.deepEqual(parseSignedUpload(good), good);
  });

  it("coerces a stringified timestamp to a number", () => {
    const out = parseSignedUpload({ ...good, timestamp: "1700000000" });
    assert.equal(out?.timestamp, 1700000000);
  });

  it("returns null when any required field is missing or blank", () => {
    for (const key of ["cloudName", "apiKey", "signature", "folder"] as const) {
      assert.equal(parseSignedUpload({ ...good, [key]: "" }), null, `blank ${key}`);
      assert.equal(parseSignedUpload({ ...good, [key]: undefined }), null, `missing ${key}`);
    }
    assert.equal(parseSignedUpload({ ...good, timestamp: "not-a-number" }), null);
  });

  it("returns null for non-object / null input", () => {
    assert.equal(parseSignedUpload(null), null);
    assert.equal(parseSignedUpload("nope"), null);
    assert.equal(parseSignedUpload(42), null);
  });
});

describe("signedUploadFields", () => {
  it("emits exactly the multipart fields a signed upload echoes back (no upload_preset)", () => {
    const fields = signedUploadFields({
      cloudName: "demo",
      apiKey: "123456",
      timestamp: 1700000000,
      signature: "abcdef",
      folder: "collectables/users/u1",
    });
    assert.deepEqual(fields, {
      api_key: "123456",
      timestamp: "1700000000",
      signature: "abcdef",
      folder: "collectables/users/u1",
    });
    assert.ok(!("upload_preset" in fields), "signed uploads must not use the open preset");
  });
});
