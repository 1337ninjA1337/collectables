import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractPublicId,
  resolveCloudinaryApiBase,
  withCloudinaryThumbUrl,
} from "@/lib/cloudinary-url";

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

describe("resolveCloudinaryApiBase", () => {
  it("falls back to the standard host when no override is provided", () => {
    assert.equal(
      resolveCloudinaryApiBase(undefined, "dt57phtma"),
      "https://api.cloudinary.com/v1_1/dt57phtma",
    );
    assert.equal(
      resolveCloudinaryApiBase(null, "dt57phtma"),
      "https://api.cloudinary.com/v1_1/dt57phtma",
    );
    assert.equal(
      resolveCloudinaryApiBase("", "dt57phtma"),
      "https://api.cloudinary.com/v1_1/dt57phtma",
    );
  });

  it("uses the override when provided", () => {
    assert.equal(
      resolveCloudinaryApiBase("https://api.cloudinary.com/v1_1/staging", "ignored"),
      "https://api.cloudinary.com/v1_1/staging",
    );
  });

  it("strips trailing slashes so callers can append paths safely", () => {
    assert.equal(
      resolveCloudinaryApiBase("https://api.cloudinary.com/v1_1/foo/", "ignored"),
      "https://api.cloudinary.com/v1_1/foo",
    );
    assert.equal(
      resolveCloudinaryApiBase("https://api.cloudinary.com/v1_1/foo///", "ignored"),
      "https://api.cloudinary.com/v1_1/foo",
    );
  });
});

describe("withCloudinaryThumbUrl", () => {
  it("injects a transform block into a versioned Cloudinary delivery URL", () => {
    const url = "https://res.cloudinary.com/dt57phtma/image/upload/v1712345678/folder/name.jpg";
    assert.equal(
      withCloudinaryThumbUrl(url, { width: 1200, height: 900, mode: "fill" }),
      "https://res.cloudinary.com/dt57phtma/image/upload/c_fill,w_1200,h_900,q_auto,f_auto/v1712345678/folder/name.jpg",
    );
  });

  it("defaults to c_limit and width 800 with no explicit options", () => {
    const url = "https://res.cloudinary.com/x/image/upload/v1/img.jpg";
    assert.equal(
      withCloudinaryThumbUrl(url),
      "https://res.cloudinary.com/x/image/upload/c_limit,w_800,q_auto,f_auto/v1/img.jpg",
    );
  });

  it("omits height when only width is provided", () => {
    const url = "https://res.cloudinary.com/x/image/upload/v1/img.jpg";
    const out = withCloudinaryThumbUrl(url, { width: 600 });
    assert.match(out, /\/upload\/c_limit,w_600,q_auto,f_auto\/v1\/img\.jpg$/);
    assert.equal(out.includes("h_"), false);
  });

  it("does not double-transform URLs that already carry a transform block", () => {
    const already = "https://res.cloudinary.com/x/image/upload/c_fill,w_400/v1/img.jpg";
    assert.equal(withCloudinaryThumbUrl(already, { width: 1200 }), already);
    const single = "https://res.cloudinary.com/x/image/upload/w_400/v1/img.jpg";
    assert.equal(withCloudinaryThumbUrl(single, { width: 1200 }), single);
  });

  it("treats a Cloudinary URL with no version segment correctly (still injects)", () => {
    const url = "https://res.cloudinary.com/x/image/upload/folder/img.jpg";
    assert.equal(
      withCloudinaryThumbUrl(url, { width: 1200 }),
      "https://res.cloudinary.com/x/image/upload/c_limit,w_1200,q_auto,f_auto/folder/img.jpg",
    );
  });

  it("passes through non-Cloudinary URLs unchanged", () => {
    assert.equal(
      withCloudinaryThumbUrl("https://example.com/pic.jpg", { width: 1200 }),
      "https://example.com/pic.jpg",
    );
    assert.equal(
      withCloudinaryThumbUrl("data:image/png;base64,AAAA", { width: 1200 }),
      "data:image/png;base64,AAAA",
    );
    assert.equal(
      withCloudinaryThumbUrl("file:///tmp/local.jpg", { width: 1200 }),
      "file:///tmp/local.jpg",
    );
  });

  it("passes through an empty string unchanged", () => {
    assert.equal(withCloudinaryThumbUrl("", { width: 1200 }), "");
  });
});
