import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCloudinaryConfig } from "../lib/cloudinary-config";

describe("resolveCloudinaryConfig", () => {
  it("uses defaults when env vars are absent", () => {
    const cfg = resolveCloudinaryConfig({});
    assert.equal(cfg.cloudName, "dt57phtma");
    assert.equal(cfg.uploadPreset, "collectables");
    assert.match(cfg.apiBase, /api\.cloudinary\.com\/v1_1\/dt57phtma/);
  });

  it("uses provided cloud name and preset", () => {
    const cfg = resolveCloudinaryConfig({
      EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME: "mycloud",
      EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET: "mypreset",
    });
    assert.equal(cfg.cloudName, "mycloud");
    assert.equal(cfg.uploadPreset, "mypreset");
    assert.match(cfg.apiBase, /mycloud/);
  });

  it("override URL wins over cloud name", () => {
    const cfg = resolveCloudinaryConfig({
      EXPO_PUBLIC_CLOUDINARY_URL: "https://staging.example.com/v1_1/other",
      EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME: "mycloud",
    });
    assert.equal(cfg.apiBase, "https://staging.example.com/v1_1/other");
  });

  it("strips trailing slash from override URL", () => {
    const cfg = resolveCloudinaryConfig({
      EXPO_PUBLIC_CLOUDINARY_URL: "https://staging.example.com/v1_1/other/",
    });
    assert.equal(cfg.apiBase, "https://staging.example.com/v1_1/other");
  });
});
