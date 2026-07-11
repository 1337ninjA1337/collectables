import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCollectionAnalyticsProps } from "../lib/analytics-helpers";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";

describe("buildCollectionAnalyticsProps — canonical collection payload", () => {
  it("derives hasCover from a non-empty cover photo", () => {
    assert.deepEqual(
      buildCollectionAnalyticsProps(
        { visibility: "private", coverPhoto: "https://cdn/x.jpg" },
        true,
      ),
      { visibility: "private", isPremium: true, hasCover: true },
    );
  });

  it("treats empty / whitespace / missing / null covers as no cover", () => {
    for (const coverPhoto of ["", "   ", undefined, null]) {
      assert.equal(
        buildCollectionAnalyticsProps({ visibility: "public", coverPhoto }, false)
          .hasCover,
        false,
        `coverPhoto=${JSON.stringify(coverPhoto)} must derive hasCover: false`,
      );
    }
  });

  it("passes the user's isPremium entitlement through untouched", () => {
    assert.equal(
      buildCollectionAnalyticsProps({ visibility: "public" }, false).isPremium,
      false,
    );
  });

  it("returns only keys the collection_created registry entry allows", () => {
    const props = buildCollectionAnalyticsProps(
      { visibility: "public", coverPhoto: "x" },
      true,
    );
    const allowed = new Set<string>(ANALYTICS_EVENTS.collection_created.props);
    for (const key of Object.keys(props)) {
      assert.ok(
        allowed.has(key),
        `builder key "${key}" missing from the collection_created registry props — assertValidProps would strip it (or throw in dev)`,
      );
    }
  });
});
