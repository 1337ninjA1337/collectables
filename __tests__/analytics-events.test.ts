import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  type AnalyticsEventSpec,
} from "../lib/analytics-events";
import type { AnalyticsEventName } from "../lib/analytics";

const EXPECTED_NAMES: AnalyticsEventName[] = [
  "signup_completed",
  "collection_created",
  "item_added",
  "item_photo_attached",
  "listing_created",
  "listing_claimed",
  "chat_opened",
  "friend_requested",
  "premium_activated",
  "language_switched",
];

describe("ANALYTICS_EVENTS — taxonomy completeness", () => {
  it("declares every canonical event from the platform doc", () => {
    for (const name of EXPECTED_NAMES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name),
        `ANALYTICS_EVENTS must declare "${name}"`,
      );
    }
    assert.equal(Object.keys(ANALYTICS_EVENTS).length, EXPECTED_NAMES.length);
  });

  it("exposes ANALYTICS_EVENT_NAMES that mirrors the keys", () => {
    const sortedKeys = Object.keys(ANALYTICS_EVENTS).sort();
    const sortedNames = [...ANALYTICS_EVENT_NAMES].sort();
    assert.deepStrictEqual(sortedKeys, sortedNames);
  });
});

describe("ANALYTICS_EVENTS — spec shape", () => {
  it("every entry has a non-empty description", () => {
    for (const [name, spec] of Object.entries(ANALYTICS_EVENTS) as [
      AnalyticsEventName,
      AnalyticsEventSpec,
    ][]) {
      assert.equal(typeof spec.description, "string", `${name}: description type`);
      assert.ok(spec.description.length > 0, `${name}: description must be non-empty`);
    }
  });

  it("every entry has at least one allowed prop", () => {
    for (const [name, spec] of Object.entries(ANALYTICS_EVENTS) as [
      AnalyticsEventName,
      AnalyticsEventSpec,
    ][]) {
      assert.ok(
        Array.isArray(spec.props),
        `${name}: props must be an array`,
      );
      assert.ok(
        spec.props.length >= 1,
        `${name}: must declare at least one allowed prop`,
      );
      for (const prop of spec.props) {
        assert.equal(typeof prop, "string", `${name}: prop must be string`);
        assert.ok(prop.length > 0, `${name}: prop must be non-empty`);
      }
    }
  });

  it("declares the expected props for marketplace events (matches Analytics #9)", () => {
    assert.deepStrictEqual(
      [...ANALYTICS_EVENTS.listing_created.props].sort(),
      ["hasPrice", "mode"],
    );
    assert.deepStrictEqual(
      [...ANALYTICS_EVENTS.listing_claimed.props].sort(),
      ["mode", "sellerWasFriend"],
    );
  });

  it("declares the expected props for collection/item events (matches Analytics #8)", () => {
    assert.deepStrictEqual(
      [...ANALYTICS_EVENTS.collection_created.props].sort(),
      ["isPremium", "visibility"],
    );
    assert.deepStrictEqual(
      [...ANALYTICS_EVENTS.item_added.props].sort(),
      ["collectionId", "hasPhoto"],
    );
  });
});
