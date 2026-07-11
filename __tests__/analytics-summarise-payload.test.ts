import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildCollectionAnalyticsProps,
  summarisePayload,
} from "../lib/analytics-helpers";
import { isPiiPropKey } from "../lib/analytics-pii";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("summarisePayload — canonical has-X booleans", () => {
  it("derives hasPhoto from a non-empty photo list", () => {
    assert.deepEqual(summarisePayload({ photos: ["https://cdn/a.jpg"] }), {
      hasPhoto: true,
      hasCover: false,
      hasDescription: false,
    });
  });

  it("empty / missing / null photo lists derive hasPhoto: false", () => {
    for (const photos of [[], undefined, null] as const) {
      assert.equal(
        summarisePayload({ photos }).hasPhoto,
        false,
        `photos=${JSON.stringify(photos)} must derive hasPhoto: false`,
      );
    }
  });

  it("a list of only blank URIs does not count as having a photo", () => {
    assert.equal(summarisePayload({ photos: ["", "   "] }).hasPhoto, false);
    assert.equal(
      summarisePayload({ photos: ["", "https://cdn/a.jpg"] }).hasPhoto,
      true,
      "one real URI among blanks still counts",
    );
  });

  it("derives hasCover / hasDescription from trimmed non-empty strings", () => {
    assert.deepEqual(
      summarisePayload({ coverPhoto: "https://cdn/c.jpg", description: "x" }),
      { hasPhoto: false, hasCover: true, hasDescription: true },
    );
    for (const blank of ["", "   ", undefined, null]) {
      const summary = summarisePayload({
        coverPhoto: blank,
        description: blank,
      });
      assert.equal(summary.hasCover, false, `cover=${JSON.stringify(blank)}`);
      assert.equal(
        summary.hasDescription,
        false,
        `description=${JSON.stringify(blank)}`,
      );
    }
  });

  it("an empty input derives all-false (no field ever defaults to true)", () => {
    assert.deepEqual(summarisePayload({}), {
      hasPhoto: false,
      hasCover: false,
      hasDescription: false,
    });
  });

  it("hasPhoto / hasCover pass the PII key rule; hasDescription is documented as blocked", () => {
    // hasPhoto and hasCover are registered event props today. hasDescription
    // is derived for future events but the conservative PII guard rejects the
    // "description" token — the helper's doc comment must warn adopters.
    assert.equal(isPiiPropKey("hasPhoto"), false);
    assert.equal(isPiiPropKey("hasCover"), false);
    assert.equal(isPiiPropKey("hasDescription"), true);
    assert.match(
      read("lib/analytics-helpers.ts"),
      /hasDescription[\s\S]{0,400}PII/,
      "summarisePayload's doc comment must warn that hasDescription is not yet a registrable prop key",
    );
  });
});

describe("summarisePayload — adoption (one derivation, no re-rolls)", () => {
  it("buildCollectionAnalyticsProps.hasCover delegates to summarisePayload", () => {
    const src = read("lib/analytics-helpers.ts");
    assert.match(
      src,
      /hasCover:\s*summarisePayload\(\s*\{\s*coverPhoto:\s*collection\.coverPhoto\s*\}\s*\)\.hasCover/,
      "the collection builder must reuse summarisePayload instead of re-rolling the trim check",
    );
    // behaviour parity — the delegation must not change the builder's output
    assert.equal(
      buildCollectionAnalyticsProps(
        { visibility: "public", coverPhoto: " " },
        false,
      ).hasCover,
      false,
    );
    assert.equal(
      buildCollectionAnalyticsProps(
        { visibility: "public", coverPhoto: "x" },
        false,
      ).hasCover,
      true,
    );
  });

  it("app/create.tsx derives item_added.hasPhoto through the helper", () => {
    const src = read("app/create.tsx");
    assert.match(
      src,
      /summarisePayload\(\s*\{\s*photos:\s*uploadedPhotos\s*\}\s*\)/,
      "create.tsx must call summarisePayload({ photos: uploadedPhotos })",
    );
    assert.doesNotMatch(
      src,
      /hasPhoto:\s*uploadedPhotos\.length/,
      "the inline uploadedPhotos.length > 0 re-roll must be gone",
    );
  });
});
