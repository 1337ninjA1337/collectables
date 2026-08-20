import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocaleBody,
  assertMatchesInEveryNonBaseLocaleBody,
  localeStrings,
} from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * The two nav badges nobody could hear.
 *
 * The chats tab draws an unread count and the friends tab a pending-request
 * dot, and both are drawn INSIDE the `<Pressable>` that carries the tab's
 * accessibility label. A screen reader announces the label and stops, so the
 * bar said "Chats, button" whether there were zero unread messages or forty —
 * the one piece of information the badge exists to convey was the one piece a
 * non-visual user never got.
 *
 * Two shapes of badge, two shapes of label: the count badge shows a number, so
 * its label says the number; the friends badge is a dot that shows only THAT
 * something is waiting, so its label says that and no more. Announcing a count
 * the screen does not show would be its own mismatch.
 *
 * Source-level like the rest of the i18n suites — `lib/i18n-context.tsx` pulls
 * React Native through its import graph and cannot be imported under
 * `tsx --test`, so a structural question about it is asked of the text. The
 * badge → label mapping itself is a pure function and is tested by importing
 * it, in `__tests__/chat-helpers.test.ts`.
 */

const KEYS = ["navChatsUnreadA11y", "navFriendsRequestsA11y"] as const;

describe("the nav-badge a11y keys exist in all six languages", () => {
  const src = readI18nSource();

  for (const key of KEYS) {
    it(`declares ${key} in every locale`, () => {
      assertDeclaredInEveryLocale(src, key);
    });
  }

  it("declares navFriendsRequestsA11y as a plain string in every locale", () => {
    // No parameter: the dot carries no number, so neither does its label.
    assertMatchesInEveryLocaleBody(
      src,
      /navFriendsRequestsA11y:\s*"[^"]+"/,
      "navFriendsRequestsA11y is a non-empty string",
    );
    assertMatchesInEveryNonBaseLocaleBody(
      src,
      /navFriendsRequestsA11y:\s*"[^"]+"/,
      "navFriendsRequestsA11y is overridden",
    );
  });

  it("declares navChatsUnreadA11y as a count-taking function in every locale", () => {
    // Both halves in one pattern, per locale body: the key is a formatter AND
    // its template interpolates the count. A bare string, or a formatter that
    // ignores its params, would read fine in review and never change with the
    // number — which is the whole point of the key.
    //
    // Asked of each locale body rather than counted across the file: six hits
    // somewhere in `lib/i18n-context.tsx` is satisfied by one locale declaring
    // it six times, and `i18n-locales-helper.test.ts` retires that habit
    // repo-wide.
    const declaration =
      /navChatsUnreadA11y:\s*\(params\?: TranslationParams\) =>\s*`[^`]*\$\{params\?\.count \?\? 0\}[^`]*`/;
    assertMatchesInEveryLocaleBody(src, declaration, "navChatsUnreadA11y interpolates the count");
    assertMatchesInEveryNonBaseLocaleBody(src, declaration, "navChatsUnreadA11y is overridden");
  });

  it("gives the friends label a different sentence in every language than English", () => {
    // The four partial locales inherit most keys from `en`; these two are new
    // and were written in all six, so a row that matched English here would be
    // a copy rather than a translation. `de`'s word for Chats is "Chats", so
    // this checks the friends label, whose noun differs in all six.
    const labels = localeStrings(src, "navFriendsRequestsA11y");
    const english = labels.get("en");
    assert.ok(english, "en must declare navFriendsRequestsA11y");
    for (const [code, label] of labels) {
      if (code === "en") continue;
      assert.notEqual(label, english, `${code} pasted the English string`);
    }
  });

  it("says more than the tab's own name in every language", () => {
    // The label REPLACES the plain tab name while a badge is up, so a terse
    // one would lose information rather than add it.
    for (const [code, label] of localeStrings(src, "navFriendsRequestsA11y")) {
      assert.ok(
        label.length > 12,
        `${code}: navFriendsRequestsA11y is too terse to replace the tab name: "${label}"`,
      );
    }
  });
});
