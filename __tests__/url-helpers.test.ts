import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  inferWebBasePath,
  normalizeConfiguredUrl,
  resolveAppBaseUrl,
} from "@/lib/url-helpers";

describe("normalizeConfiguredUrl", () => {
  it("returns empty string for undefined or null", () => {
    assert.equal(normalizeConfiguredUrl(undefined), "");
    assert.equal(normalizeConfiguredUrl(null), "");
  });

  it("returns empty string untouched", () => {
    assert.equal(normalizeConfiguredUrl(""), "");
  });

  it("strips a single trailing slash", () => {
    assert.equal(
      normalizeConfiguredUrl("https://example.com/collectables/"),
      "https://example.com/collectables",
    );
  });

  it("strips multiple trailing slashes", () => {
    assert.equal(
      normalizeConfiguredUrl("https://example.com/collectables///"),
      "https://example.com/collectables",
    );
  });

  it("leaves a URL without trailing slash alone", () => {
    assert.equal(
      normalizeConfiguredUrl("https://example.com/collectables"),
      "https://example.com/collectables",
    );
  });
});

describe("inferWebBasePath", () => {
  it("returns empty string for root pathname", () => {
    assert.equal(inferWebBasePath("/"), "");
  });

  it("returns empty string for empty pathname", () => {
    assert.equal(inferWebBasePath(""), "");
  });

  it("returns the first segment as base path", () => {
    assert.equal(inferWebBasePath("/collectables"), "/collectables");
  });

  it("returns only the first segment when pathname is nested", () => {
    assert.equal(
      inferWebBasePath("/collectables/collection/abc-123"),
      "/collectables",
    );
  });

  it("ignores trailing slashes", () => {
    assert.equal(inferWebBasePath("/collectables/"), "/collectables");
  });
});

describe("resolveAppBaseUrl", () => {
  it("prefers the configured URL when present", () => {
    assert.equal(
      resolveAppBaseUrl(
        "https://deploy.example/app",
        "https://runtime.example",
        "/some/page",
      ),
      "https://deploy.example/app",
    );
  });

  it("falls back to origin + inferred base path when not configured", () => {
    assert.equal(
      resolveAppBaseUrl("", "https://runtime.example", "/collectables/item/1"),
      "https://runtime.example/collectables",
    );
  });

  it("falls back to origin with no base path when at root", () => {
    assert.equal(
      resolveAppBaseUrl("", "https://runtime.example", "/"),
      "https://runtime.example",
    );
  });

  it("returns empty string off-web (no origin)", () => {
    assert.equal(resolveAppBaseUrl("", null, null), "");
    assert.equal(resolveAppBaseUrl("", undefined, undefined), "");
  });

  it("uses configured URL even when origin is present", () => {
    assert.equal(
      resolveAppBaseUrl(
        "https://1337ninja1337.github.io/collectables",
        "https://1337ninja1337.github.io",
        "/collectables/item/999",
      ),
      "https://1337ninja1337.github.io/collectables",
    );
  });
});
