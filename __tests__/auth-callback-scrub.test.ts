import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  scrubAuthParamsFromLocation,
  stripAuthParamsFromHref,
} from "../lib/auth-callback-scrub";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("SEC-7 — stripAuthParamsFromHref removes credential params", () => {
  it("strips implicit-flow tokens from the hash fragment", () => {
    const dirty =
      "https://app.example.com/auth/callback#access_token=abc&refresh_token=def&token_type=bearer&expires_in=3600";
    const cleaned = stripAuthParamsFromHref(dirty);
    assert.equal(cleaned, "https://app.example.com/auth/callback");
    assert.ok(!cleaned.includes("access_token"));
    assert.ok(!cleaned.includes("refresh_token"));
  });

  it("strips PKCE / OTP params from the query string", () => {
    const dirty =
      "https://app.example.com/auth/callback?code=xyz&token_hash=hhh&type=signup";
    const cleaned = stripAuthParamsFromHref(dirty);
    assert.equal(cleaned, "https://app.example.com/auth/callback");
  });

  it("strips OAuth error params from both hash and query", () => {
    const dirty =
      "https://app.example.com/auth/callback?error=access_denied#error_code=otp_expired&error_description=Token+has+expired";
    const cleaned = stripAuthParamsFromHref(dirty);
    assert.ok(!cleaned.includes("error"));
    assert.equal(cleaned, "https://app.example.com/auth/callback");
  });

  it("preserves non-sensitive params and path", () => {
    const dirty =
      "https://app.example.com/auth/callback?next=%2Fhome&code=secret#access_token=abc&keep=1";
    const cleaned = stripAuthParamsFromHref(dirty);
    assert.ok(cleaned.includes("next=%2Fhome"));
    assert.ok(cleaned.includes("keep=1"));
    assert.ok(!cleaned.includes("code=secret"));
    assert.ok(!cleaned.includes("access_token"));
  });

  it("returns a malformed URL unchanged", () => {
    assert.equal(stripAuthParamsFromHref("not a url"), "not a url");
  });

  it("leaves an already-clean URL untouched", () => {
    const clean = "https://app.example.com/auth/callback";
    assert.equal(stripAuthParamsFromHref(clean), clean);
  });
});

function makeWindow(href: string) {
  const calls: { href: string }[] = [];
  return {
    win: {
      location: { href },
      history: {
        state: { foo: "bar" },
        replaceState(_data: unknown, _unused: string, url?: string | null) {
          calls.push({ href: String(url) });
        },
      },
    },
    calls,
  };
}

describe("SEC-7 — scrubAuthParamsFromLocation rewrites history", () => {
  it("calls replaceState with the cleaned URL when tokens are present", () => {
    const { win, calls } = makeWindow(
      "https://app.example.com/auth/callback#access_token=abc&refresh_token=def",
    );
    const changed = scrubAuthParamsFromLocation(win);
    assert.equal(changed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].href, "https://app.example.com/auth/callback");
    assert.ok(!calls[0].href.includes("access_token"));
  });

  it("is a no-op when there is nothing to strip", () => {
    const { win, calls } = makeWindow("https://app.example.com/auth/callback");
    assert.equal(scrubAuthParamsFromLocation(win), false);
    assert.equal(calls.length, 0);
  });

  it("is a no-op in a native / SSR environment (no history)", () => {
    assert.equal(scrubAuthParamsFromLocation(undefined), false);
    assert.equal(scrubAuthParamsFromLocation({ location: { href: "x" } }), false);
  });
});

describe("SEC-7 — callback screen scrubs before navigating", () => {
  const src = read("app/auth/callback.tsx");

  it("imports and calls the scrub helper", () => {
    assert.ok(src.includes("scrubAuthParamsFromLocation"));
    assert.ok(src.includes("scrubAuthParamsFromLocation(window)"));
  });

  it("scrubs the hash before the success router.replace navigation", () => {
    const scrubIdx = src.indexOf("scrubAuthParamsFromLocation(window)");
    const navIdx = src.indexOf('router.replace("/")');
    assert.ok(scrubIdx > -1, "scrub call must exist");
    assert.ok(navIdx > -1, "navigation call must exist");
    assert.ok(
      scrubIdx < navIdx,
      "the hash must be cleared before navigation occurs",
    );
  });
});
