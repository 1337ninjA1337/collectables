import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnalyticsMirrorPayloadError,
  buildAnalyticsEventRow,
  isUuid,
  normaliseTimestamp,
  stripPosthogMeta,
} from "../lib/analytics-mirror-payload";

describe("analytics-mirror payload transformer", () => {
  describe("isUuid", () => {
    it("accepts canonical lowercase UUIDs", () => {
      assert.equal(
        isUuid("550e8400-e29b-41d4-a716-446655440000"),
        true,
      );
    });
    it("accepts uppercase UUIDs", () => {
      assert.equal(
        isUuid("550E8400-E29B-41D4-A716-446655440000"),
        true,
      );
    });
    it("rejects PostHog anonymous distinct_ids", () => {
      assert.equal(isUuid("01933bcf-anonymous-cookie-id"), false);
      assert.equal(isUuid("anon_user_42"), false);
    });
    it("rejects empty strings, numbers, null, undefined, objects", () => {
      assert.equal(isUuid(""), false);
      assert.equal(isUuid(42), false);
      assert.equal(isUuid(null), false);
      assert.equal(isUuid(undefined), false);
      assert.equal(isUuid({}), false);
    });
  });

  describe("stripPosthogMeta", () => {
    it("drops every $-prefixed PostHog meta key", () => {
      const result = stripPosthogMeta({
        visibility: "public",
        $lib: "posthog-js",
        $lib_version: "1.2.3",
        $ip: "1.2.3.4",
        $current_url: "https://example.com",
        isPremium: true,
      });
      assert.deepEqual(result, { visibility: "public", isPremium: true });
    });
    it("preserves nested objects, arrays, falsy values", () => {
      const result = stripPosthogMeta({
        nested: { a: 1 },
        list: [1, 2, 3],
        zero: 0,
        empty: "",
        bool: false,
        nullVal: null,
      });
      assert.deepEqual(result, {
        nested: { a: 1 },
        list: [1, 2, 3],
        zero: 0,
        empty: "",
        bool: false,
        nullVal: null,
      });
    });
    it("returns {} for non-object inputs", () => {
      assert.deepEqual(stripPosthogMeta(null), {});
      assert.deepEqual(stripPosthogMeta(undefined), {});
      assert.deepEqual(stripPosthogMeta("string"), {});
      assert.deepEqual(stripPosthogMeta(42), {});
      assert.deepEqual(stripPosthogMeta([1, 2, 3]), {});
    });
  });

  describe("normaliseTimestamp", () => {
    it("round-trips a valid ISO 8601 string to canonical ISO", () => {
      assert.equal(
        normaliseTimestamp("2026-05-08T12:34:56.789Z"),
        "2026-05-08T12:34:56.789Z",
      );
    });
    it("converts numeric epoch ms", () => {
      const ms = Date.UTC(2026, 4, 8, 12, 0, 0);
      assert.equal(normaliseTimestamp(ms), "2026-05-08T12:00:00.000Z");
    });
    it("falls back to now() for unparseable input (invalid string)", () => {
      const before = Date.now();
      const out = normaliseTimestamp("not-a-date");
      const after = Date.now();
      const ms = Date.parse(out);
      assert.ok(ms >= before && ms <= after);
    });
    it("falls back to now() for missing input", () => {
      const before = Date.now();
      const out = normaliseTimestamp(undefined);
      const after = Date.now();
      const ms = Date.parse(out);
      assert.ok(ms >= before && ms <= after);
    });
  });

  describe("buildAnalyticsEventRow", () => {
    it("maps a typical PostHog payload into an analytics_events row", () => {
      const row = buildAnalyticsEventRow({
        event: "collection_created",
        timestamp: "2026-05-08T12:34:56.789Z",
        distinct_id: "550e8400-e29b-41d4-a716-446655440000",
        properties: {
          visibility: "public",
          isPremium: true,
          $lib: "posthog-js",
        },
      });
      assert.deepEqual(row, {
        user_id: "550e8400-e29b-41d4-a716-446655440000",
        name: "collection_created",
        occurred_at: "2026-05-08T12:34:56.789Z",
        properties: { visibility: "public", isPremium: true },
      });
    });

    it("nulls user_id for anonymous distinct_id (FK-safe)", () => {
      const row = buildAnalyticsEventRow({
        event: "signup_completed",
        distinct_id: "anon_cookie_xyz",
        properties: {},
      });
      assert.equal(row.user_id, null);
    });

    it("defaults occurred_at to now() when timestamp is missing", () => {
      const before = Date.now();
      const row = buildAnalyticsEventRow({
        event: "item_added",
        properties: {},
      });
      const after = Date.now();
      const ms = Date.parse(row.occurred_at);
      assert.ok(ms >= before && ms <= after);
    });

    it("defaults properties to {} when missing or non-object", () => {
      const row1 = buildAnalyticsEventRow({ event: "item_added" });
      assert.deepEqual(row1.properties, {});
      const row2 = buildAnalyticsEventRow({
        event: "item_added",
        properties: "garbage",
      });
      assert.deepEqual(row2.properties, {});
    });

    it("rejects events with no name", () => {
      assert.throws(
        () => buildAnalyticsEventRow({ properties: {} }),
        AnalyticsMirrorPayloadError,
      );
      assert.throws(
        () => buildAnalyticsEventRow({ event: "" }),
        AnalyticsMirrorPayloadError,
      );
      assert.throws(
        () => buildAnalyticsEventRow({ event: 42 as unknown }),
        AnalyticsMirrorPayloadError,
      );
    });

    it("rejects events with names exceeding 200 chars (matches DB CHECK)", () => {
      assert.throws(
        () =>
          buildAnalyticsEventRow({
            event: "a".repeat(201),
          }),
        AnalyticsMirrorPayloadError,
      );
    });

    it("accepts event names exactly 200 chars (matches DB CHECK boundary)", () => {
      const row = buildAnalyticsEventRow({
        event: "a".repeat(200),
      });
      assert.equal(row.name.length, 200);
    });
  });
});
