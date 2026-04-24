import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractPublicId } from "@/lib/cloudinary-url";

describe("extractPublicId", () => {
  it("extracts the public id from a standard upload URL with version prefix", () => {
    const url = "https://res.cloudinary.com/dt57phtma/image/upload/v1712345678/folder/name.jpg";
    assert.equal(extractPublicId(url), "folder/name");
  });

  it("extracts the public id from a URL without version prefix", () => {
    const url = "https://res.cloudinary.com/dt57phtma/image/upload/folder/name.png";
    assert.equal(extractPublicId(url), "folder/name");
  });

  it("handles nested folder paths", () => {
    const url = "https://res.cloudinary.com/dt57phtma/image/upload/v1/a/b/c.webp";
    assert.equal(extractPublicId(url), "a/b/c");
  });

  it("returns null for non-Cloudinary URLs", () => {
    assert.equal(extractPublicId("https://example.com/picture.jpg"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(extractPublicId(""), null);
  });

  it("returns null when there is no file extension", () => {
    assert.equal(extractPublicId("https://res.cloudinary.com/x/image/upload/v1/abc"), null);
  });
});
