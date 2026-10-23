import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import {
  formatAbsoluteDate,
  formatChatPreviewTimestamp,
  formatClockTime,
  formatRelativeDate,
} from "../lib/i18n-context";
import { readI18nSource } from "./helpers/i18n-source-file";
import { locales } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * `formatClockTime` — the `HH:mm` the conversation list and the conversation
 * now share.
 *
 * ## The disagreement it was written for
 *
 * `app/chats.tsx` previews each conversation's last message through
 * `formatChatPreviewTimestamp`, which pins `hour12: false` and resolves the app
 * language through `getDefaultLocaleForLanguage`. `app/chat/[id].tsx` stamped
 * the bubble for that same message with its own `formatTime`, which did
 * neither: it handed `toLocaleTimeString` the raw `AppLanguage` — `"en"`, not
 * `"en-US"` — and left the 12/24-hour choice to whatever the locale preferred.
 *
 * So an English session read `14:05` in the list and `02:05 PM` in the bubble,
 * for one message and one instant. That is the pair of cases below: the shape,
 * and the two surfaces agreeing.
 *
 * ## And the throw only one of them caught
 *
 * `Intl` rejects a malformed locale tag with a `RangeError`. The bubble's
 * formatter wrapped its call in a `try`; the preview's did not, so the same bad
 * tag rendered an empty time in the conversation and took the conversation LIST
 * down. One function, one `try`, and the preview's relative branch — which
 * needs no `DateTimeFormat` at all — as the fallback.
 */
function isoAt(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("formatClockTime", () => {
  it("renders a 24-hour HH:mm, so the clock is a decision and not a locale's habit", () => {
    // `en-US` prefers 12-hour with an AM/PM marker; this is the surface where
    // that would disagree with the list, and the assertion is the marker's
    // absence rather than a fixed string (the suite runs in UTC on CI and in
    // whatever zone a contributor has).
    const result = formatClockTime(isoAt(-5 * 60 * 1000), "en");
    assert.match(result, /^\d{2}:\d{2}$/);
    assert.doesNotMatch(result, /[AP]M/i);
  });

  it("renders the same shape in every supported language", () => {
    const supported = locales(readI18nSource());
    const recent = isoAt(-10 * 60 * 1000);
    for (const locale of supported) {
      assert.match(
        formatClockTime(recent, locale),
        /^\d{2}:\d{2}$/,
        `expected a 24-hour HH:mm for language "${locale}"`,
      );
    }
  });

  it("resolves the app language to its BCP-47 tag", () => {
    // The thing the screen's copy skipped. `"en"` and `"en-US"` have to be the
    // same answer, or the region-aware formatting `LANGUAGE_LOCALE` exists for
    // is a property of which call site you went through.
    const when = isoAt(-7 * 60 * 1000);
    assert.equal(formatClockTime(when, "en"), formatClockTime(when, "en-US"));
    assert.equal(formatClockTime(when, "ru"), formatClockTime(when, "ru-RU"));
  });

  it("agrees with the conversation list about the message it is previewing", () => {
    // The regression, stated end to end: inside the preview's one-hour window
    // the two surfaces describe one instant, so they have to say one thing.
    const recent = isoAt(-5 * 60 * 1000);
    for (const locale of locales(readI18nSource())) {
      assert.equal(
        formatChatPreviewTimestamp(recent, locale),
        formatClockTime(recent, locale),
        `the list and the bubble disagree in "${locale}"`,
      );
    }
  });

  it("answers an empty string for an unparseable timestamp", () => {
    // What the bubble's own formatter did, kept: a bubble is a better place
    // for no time at all than for a raw ISO string.
    assert.equal(formatClockTime("not-a-date"), "");
    assert.equal(formatClockTime(""), "");
  });

  it("renders in the fallback locale for a tag Intl refuses", () => {
    // Not the empty-string case. A tag the platform rejects is a caller's bug
    // and the user's clock is not the place to report it, so the answer is the
    // time in `en-US` rather than a bubble with no time in it.
    const when = isoAt(-6 * 60 * 1000);
    assert.equal(formatClockTime(when, "nonsense tag"), formatClockTime(when, "en"));
  });

  it("does not let that tag throw out of the conversation list", () => {
    // The latent crash, and it reached further than the clock: neither
    // `formatChatPreviewTimestamp` nor `formatRelativeDate` had a `try`
    // anywhere in it, so one malformed tag was a `RangeError` on the screen
    // that lists every conversation — and on every relative timestamp in the
    // app. Both formatter caches fall back now.
    const recent = isoAt(-5 * 60 * 1000);
    assert.equal(formatChatPreviewTimestamp(recent, "nonsense tag"), formatClockTime(recent, "en"));

    const older = isoAt(-3 * 60 * 60 * 1000);
    assert.equal(formatRelativeDate(older, "another nonsense tag"), formatRelativeDate(older, "en"));
    assert.equal(formatChatPreviewTimestamp(older, "another nonsense tag"), formatRelativeDate(older, "en"));
  });
});

describe("the formatter is built once per locale", () => {
  const realDateTimeFormat = Intl.DateTimeFormat;

  afterEach(() => {
    Object.defineProperty(Intl, "DateTimeFormat", {
      configurable: true,
      writable: true,
      value: realDateTimeFormat,
    });
  });

  it("constructs one DateTimeFormat per resolved tag and reuses it", () => {
    // Why the cache is here rather than `toLocaleTimeString`: the bubble list
    // formats once per message per render, and `text` state lives in the same
    // component — so a 200-message conversation re-formatted all 200 on every
    // keystroke in the composer.
    //
    // A tag no other case uses, because the cache is module-level and outlives
    // a test: a shared tag would make the count depend on test order. `en-GB`
    // rather than, say, `fr-CA`, whose 24-hour clock is `07 h 18` — a real
    // reminder that `HH:mm` is this repo's shape and not `Intl`'s.
    let constructed = 0;
    Object.defineProperty(Intl, "DateTimeFormat", {
      configurable: true,
      writable: true,
      value: function CountingDateTimeFormat(
        this: unknown,
        locale?: string,
        options?: Intl.DateTimeFormatOptions,
      ) {
        constructed += 1;
        return new realDateTimeFormat(locale, options);
      },
    });

    const when = isoAt(-3 * 60 * 1000);
    const first = formatClockTime(when, "en-GB");
    assert.equal(constructed, 1);

    const second = formatClockTime(isoAt(-4 * 60 * 1000), "en-GB");
    assert.equal(constructed, 1, "the second call reused the cached formatter");
    assert.match(first, /^\d{2}:\d{2}$/);
    assert.match(second, /^\d{2}:\d{2}$/);
  });

  it("caches the fallback under the tag that was asked for", () => {
    // A rejected tag costs ONE rejected construction for the life of the
    // process, not one per render — and the key is the tag the caller passed,
    // so the fallback is found without re-deriving that it is needed.
    const when = isoAt(-60 * 1000);
    assert.equal(formatClockTime(when, "also nonsense"), formatClockTime(when, "en"));

    let constructed = 0;
    Object.defineProperty(Intl, "DateTimeFormat", {
      configurable: true,
      writable: true,
      value: function CountingDateTimeFormat(
        this: unknown,
        locale?: string,
        options?: Intl.DateTimeFormatOptions,
      ) {
        constructed += 1;
        return new realDateTimeFormat(locale, options);
      },
    });

    assert.match(formatClockTime(isoAt(-90 * 1000), "also nonsense"), /^\d{2}:\d{2}$/);
    assert.equal(constructed, 0, "the rejected tag was not re-constructed");
  });
});

describe("the chat screen reads the shared formatter", () => {
  const CODE = stripComments(readRepoFile("app/chat/[id].tsx"));

  it("carries no time formatter of its own", () => {
    assert.ok(!/function formatTime/.test(CODE), "the fourth copy is back in the screen");
    assert.ok(
      !/toLocaleTimeString/.test(CODE),
      "a screen formatting its own clock is how the two surfaces disagreed",
    );
  });

  it("stamps the bubble through the context, bound to the current language", () => {
    assert.match(CODE, /const \{ t, formatClockTime \} = useI18n\(\);/);
    assert.match(CODE, /\{formatClockTime\(m\.createdAt\)\}/);
  });
});

describe("formatAbsoluteDate, the third formatter in the same file", () => {
  it("renders in the fallback locale rather than throwing on a tag Intl refuses", () => {
    // Same latent `RangeError`, one function over, reaching a long-press
    // tooltip and an accessibility label on `app/listing/[id].tsx`. Found by
    // grepping the fix above against its neighbours.
    const when = isoAt(-3 * 24 * 60 * 60 * 1000);
    assert.equal(formatAbsoluteDate(when, "nonsense tag"), formatAbsoluteDate(when, "en"));
  });

  it("still returns the raw ISO string for a timestamp it cannot parse", () => {
    // Its own contract, unchanged by the cache: callers pass persisted rows
    // through without pre-validating them.
    assert.equal(formatAbsoluteDate("not-a-date"), "not-a-date");
  });

  it("resolves the app language to its BCP-47 tag", () => {
    const when = isoAt(-2 * 24 * 60 * 60 * 1000);
    assert.equal(formatAbsoluteDate(when, "de"), formatAbsoluteDate(when, "de-DE"));
  });
});
