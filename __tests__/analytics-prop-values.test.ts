import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertValidProps,
  findInvalidPropValues,
  __resetAnalyticsValidateForTests,
} from "../lib/analytics-validate";
import { ANALYTICS_EVENTS, ANALYTICS_EVENT_NAMES } from "../lib/analytics-events";
import {
  APP_LANGUAGE_VALUES,
  MARKETPLACE_MODE_VALUES,
  PREMIUM_INTENT_SOURCE_VALUES,
  SIGNUP_METHOD_VALUES,
  UPSELL_SOURCE_VALUES,
} from "../lib/analytics-prop-values";
import { BUNDLE_SMOKE_LANGUAGE_CODES } from "../lib/bundle-smoke";
import { readRepoFile } from "./helpers/repo-file";
import { captureConsole } from "./helpers/capture-console";

/**
 * Closed sets of allowed prop VALUES.
 *
 * `props` has always constrained the payload's keys. The values were free
 * strings, and the value is the more expensive of the two to get wrong: an
 * unknown key makes a column nobody has built a report on, while
 * `source: "collectionEdit"` makes a second bucket inside a column somebody
 * HAS, splitting a funnel that is then read as a number that looks too low.
 */

describe("findInvalidPropValues", () => {
  it("accepts every declared member of a set", () => {
    for (const mode of MARKETPLACE_MODE_VALUES) {
      assert.deepEqual(findInvalidPropValues("listing_created", { mode }), []);
    }
  });

  it("reports a value outside the set, with the set in the finding", () => {
    const [found, ...rest] = findInvalidPropValues("listing_created", { mode: "sale" });
    assert.equal(rest.length, 0);
    assert.equal(found.key, "mode");
    assert.equal(found.value, "sale");
    // The allowed list travels with the finding so the message can name it —
    // "sale" is not a typo of nothing, it is the wrong spelling of "sell",
    // and a reader needs to see both to know which.
    assert.deepEqual([...found.allowed], [...MARKETPLACE_MODE_VALUES]);
  });

  it("ignores props the payload does not carry", () => {
    // A set is not a requirement that the prop be present: `listing_view`
    // constrains `mode` and `sellerRelationship`, and a payload with neither
    // is under-specified, not invalid.
    assert.deepEqual(findInvalidPropValues("listing_view", { isSold: true }), []);
  });

  it("ignores props with no declared set", () => {
    assert.deepEqual(
      findInvalidPropValues("item_added", { collectionId: "anything at all" }),
      [],
    );
  });

  it("treats null as not-applicable rather than out-of-set", () => {
    // `null` is how this app already says "no value here", and a list of
    // buckets is not a claim that one always applies.
    assert.deepEqual(findInvalidPropValues("listing_created", { mode: null }), []);
  });

  it("reports a non-string under a key that declares a set", () => {
    // The set is the statement that this prop is a small enumeration, so
    // `mode: 3` is as wrong as `mode: "swap"` — and a number silently kept
    // would make a bucket that sorts oddly and belongs to nobody.
    const found = findInvalidPropValues("listing_created", { mode: 3 });
    assert.equal(found.length, 1);
    assert.equal(found[0].value, "3");
  });

  it("reports every offending key, sorted, not just the first", () => {
    const found = findInvalidPropValues("premium_upsell_shown", {
      feature: "listing_cap",
      source: "collectionEdit",
      control: "chip",
    });
    assert.deepEqual(
      found.map((f) => f.key),
      ["feature", "source"],
    );
  });

  it("returns nothing for an event name outside the registry", () => {
    // Only reachable through an `as AnalyticsEventName` cast, and the key
    // check already reports that case — this must not throw on the way there.
    assert.deepEqual(
      findInvalidPropValues("not_a_real_event" as never, { mode: "sell" }),
      [],
    );
  });
});

describe("the same prop name means different things per event", () => {
  it("keeps premium_activated.source and premium_upsell_shown.source separate", () => {
    // `server_sync` is a legitimate `premium_activated.source` (the cloud
    // restored an entitlement) and an impossible `premium_upsell_shown.source`
    // (nobody SAW a gate). One global table keyed by prop name would have to
    // allow it for both.
    assert.ok(PREMIUM_INTENT_SOURCE_VALUES.includes("server_sync"));
    assert.ok(!UPSELL_SOURCE_VALUES.includes("server_sync" as never));
    assert.deepEqual(findInvalidPropValues("premium_activated", { source: "server_sync" }), []);
    assert.equal(
      findInvalidPropValues("premium_upsell_shown", { source: "server_sync" }).length,
      1,
    );
  });
});

describe("assertValidProps — out-of-set values", () => {
  it("throws in dev, naming the value, the set and where to fix it", () => {
    __resetAnalyticsValidateForTests();
    assert.throws(
      () => assertValidProps("listing_created", { mode: "sale" }, { failFast: true }),
      (err: Error) => {
        assert.match(err.message, /listing_created/);
        assert.match(err.message, /mode="sale"/);
        assert.match(err.message, /allowed: sell, trade/);
        // Pointing at the table rather than at the validator: the person
        // reading this is deciding whether the call site or the taxonomy is
        // the thing that is out of date.
        assert.match(err.message, /analytics-prop-values/);
        return true;
      },
    );
  });

  it("KEEPS the value outside dev, unlike an unknown key", () => {
    __resetAnalyticsValidateForTests();
    const { result, warn: warns } = captureConsole(() =>
      assertValidProps("listing_created", { mode: "sale", hasPrice: true }, { failFast: false }),
    );
    // The asymmetry, stated: an unknown KEY is a column nothing was built on,
    // so dropping it costs nothing. An unexpected VALUE sits under a key a
    // report already reads, and dropping it deletes what actually happened
    // because the taxonomy is stale — leaving a breakdown whose buckets no
    // longer add up to the event count, which is harder to notice than one
    // extra bar.
    assert.deepEqual(result, { mode: "sale", hasPrice: true });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /kept in the captured event/);
  });

  it("warns once per event+value, not once per call", () => {
    __resetAnalyticsValidateForTests();
    const { warn: warns } = captureConsole(() => {
      for (let i = 0; i < 5; i += 1) {
        assertValidProps("listing_created", { mode: "sale" }, { failFast: false });
      }
    });
    assert.equal(warns.length, 1);
  });

  it("still drops unknown keys while keeping a bad value, in one call", () => {
    // Both checks run on the same payload, and they disagree about what to do
    // with what they find. This is the case where that could go wrong.
    __resetAnalyticsValidateForTests();
    const { result } = captureConsole(() =>
      assertValidProps("listing_created", { mode: "sale", pirce: 10 }, { failFast: false }),
    );
    assert.deepEqual(result, { mode: "sale" });
  });

  it("reports the value before the unknown key in dev", () => {
    // Both throw; only one can be first. The value is the one a person can
    // act on without leaving the call site, so it goes first.
    __resetAnalyticsValidateForTests();
    assert.throws(
      () => assertValidProps("listing_created", { mode: "sale", pirce: 10 }, { failFast: true }),
      /out-of-taxonomy prop value/,
    );
  });

  it("leaves a fully valid payload untouched and silent", () => {
    __resetAnalyticsValidateForTests();
    const { result, warn: warns } = captureConsole(() =>
      assertValidProps("listing_created", { mode: "sell", hasPrice: true }, { failFast: true }),
    );
    assert.deepEqual(result, { mode: "sell", hasPrice: true });
    assert.deepEqual(warns, []);
  });
});

describe("the tables and the registry agree", () => {
  it("declares values only for props the event actually has", () => {
    // A `values` entry for a prop the event does not carry is a rule that can
    // never fire, which reads as coverage and is not.
    for (const name of ANALYTICS_EVENT_NAMES) {
      const def = ANALYTICS_EVENTS[name];
      const values = (def as { values?: Record<string, readonly string[]> }).values;
      if (!values) continue;
      for (const key of Object.keys(values)) {
        assert.ok(
          (def.props as readonly string[]).includes(key),
          `${name}.values names "${key}", which is not in ${name}.props`,
        );
      }
    }
  });

  it("gives every set at least one member", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      const values = (ANALYTICS_EVENTS[name] as { values?: Record<string, readonly string[]> })
        .values;
      if (!values) continue;
      for (const [key, allowed] of Object.entries(values)) {
        assert.ok(allowed.length > 0, `${name}.values.${key} is empty — nothing could pass it`);
      }
    }
  });

  it("lists no duplicates and stays sorted", () => {
    // Sorted because the Power BI schema doc renders these: insertion order
    // would rewrite the doc whenever somebody reordered a union.
    for (const name of ANALYTICS_EVENT_NAMES) {
      const values = (ANALYTICS_EVENTS[name] as { values?: Record<string, readonly string[]> })
        .values;
      if (!values) continue;
      for (const [key, allowed] of Object.entries(values)) {
        assert.equal(new Set(allowed).size, allowed.length, `${name}.values.${key} has duplicates`);
        assert.deepEqual([...allowed], [...allowed].sort(), `${name}.values.${key} is not sorted`);
      }
    }
  });

  it("covers something — at least a third of the events constrain a value", () => {
    // A vacuity guard. Every case above passes trivially if `values` is
    // absent everywhere, which is exactly what a bad merge would leave behind.
    const constrained = ANALYTICS_EVENT_NAMES.filter(
      (name) => (ANALYTICS_EVENTS[name] as { values?: unknown }).values !== undefined,
    );
    assert.ok(
      constrained.length >= Math.ceil(ANALYTICS_EVENT_NAMES.length / 3),
      `only ${constrained.length}/${ANALYTICS_EVENT_NAMES.length} events constrain a value`,
    );
  });
});

describe("the sets and the app agree", () => {
  it("keeps the language set in step with the other two copies", () => {
    // Three lists of the six locales exist: the `AppLanguage` union (bound to
    // this table at compile time by `closedSet`), `BUNDLE_SMOKE_LANGUAGE_CODES`,
    // and this one. The compiler pins the first pair; this pins the second, so
    // a seventh language cannot half-land.
    assert.deepEqual([...APP_LANGUAGE_VALUES], [...BUNDLE_SMOKE_LANGUAGE_CODES].sort());
  });

  it("declares the dev smoke test's synthetic signup method", () => {
    // `simulateSignupEvent()` fires `method: "manual_test"` to check the
    // PostHog wire end-to-end. It runs in DEV, which is the runtime where an
    // undeclared value throws — so the honest move is to declare it rather
    // than exempt the call site and leave a `method` breakdown unexplained.
    assert.ok(SIGNUP_METHOD_VALUES.includes("manual_test"));
    const analytics = readRepoFile("lib/analytics.ts");
    assert.match(
      analytics,
      /trackEvent\("signup_completed", \{ method: "manual_test" \}\)/,
      "the synthetic value moved — SIGNUP_METHOD_VALUES may now be declaring a value nothing sends",
    );
  });

  it("matches the real listing call sites' modes", () => {
    // The table is bound to `MarketplaceMode` by the compiler; this checks the
    // other end, that the union is what the screens actually send.
    const item = readRepoFile("app/item/[id].tsx");
    assert.match(item, /listingMode === "sell"/);
  });
});
