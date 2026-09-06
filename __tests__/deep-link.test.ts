import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { inferWebBasePath, normalizeConfiguredUrl, resolveAppBaseUrl } from "@/lib/url-helpers";

import { installNativeModuleStubs, mockModule } from "./helpers/render";

/**
 * `buildDeepLink`, the shared half of every share surface, run at last.
 *
 * ## Why it had no suite
 *
 * `suite-named-modules.test.ts` found it: thirteen lines of live product code,
 * imported by `app/item/[id].tsx` and `components/collection-share-sheet.tsx`,
 * and named by no suite in the tree. The census's own first finding, and the
 * reason the older hand-run version of that list missed it is worth keeping —
 * it matched on the bare word "deep-link", which four suites use in prose
 * about share links, so a module with no coverage read as covered.
 *
 * Nothing about it was hard. It imports `expo-linking`, which esbuild can load
 * but which answers `Linking.createURL` differently per platform, and
 * `@/lib/env`, which imports `react-native` at its first line. Two
 * `mockModule` calls and the stub installer, both of which have been here
 * since the render harness landed.
 *
 * ## What is mocked and what is real
 *
 * The two seams are mocked and the subject is not: what `buildDeepLink` itself
 * does is strip the caller's leading slashes, pick a branch on whether a base
 * URL is configured, and join. `getAppBaseUrl` is behind a mock because the
 * value it answers is a module-scope `const` read from `process.env` at import
 * time — one value per process — and both branches are the point.
 *
 * The join's correctness rests on something this module cannot see: that the
 * base never ends in a slash, or `${base}/${clean}` doubles it. That is
 * `lib/url-helpers.ts`'s guarantee, so the last case asks the REAL helpers for
 * it rather than the mock, over both of the two ways a base is produced.
 *
 * ## The leading-slash strip is not cosmetic
 *
 * Callers pass both spellings — `buildDeepLink("item/" + id)` in one screen
 * and a path with a slash in another — and the two branches would disagree
 * about a leading slash in opposite directions: `${base}//item/1` on web, and
 * `collectables:///item/1` from `createURL` on native. The strip happens
 * BEFORE the branch, which is why both cases below can assert the same
 * normalisation.
 */

/** What `getAppBaseUrl` answers this pass; a stable mock reads it per call. */
let baseUrl = "";

/** Every path handed to `Linking.createURL`, in order. */
const createURLCalls: string[] = [];

mockModule("@/lib/env", {
  getAppBaseUrl: () => baseUrl,
});

mockModule("expo-linking", {
  // The real one answers a scheme URL on native and an origin-relative one on
  // web. What matters here is the argument, so the return is a marker.
  createURL: (path: string) => {
    createURLCalls.push(path);
    return `collectables://${path}`;
  },
});

installNativeModuleStubs();

type DeepLinkModule = typeof import("../lib/deep-link");

let deepLink: DeepLinkModule | null = null;

async function buildDeepLink(path: string): Promise<string> {
  deepLink ??= await import("../lib/deep-link");
  return deepLink.buildDeepLink(path);
}

describe("buildDeepLink with a base URL configured", () => {
  it("joins the base and the path with one separator", async () => {
    baseUrl = "https://collectables.app";
    createURLCalls.length = 0;

    assert.equal(await buildDeepLink("item/42"), "https://collectables.app/item/42");
    // The native path is not consulted at all — a web build that fell through
    // to `createURL` would produce a link nobody outside the app can open.
    assert.deepEqual(createURLCalls, []);
  });

  it("agrees about a path however many leading slashes the caller passed", async () => {
    baseUrl = "https://collectables.app/collectables";
    const spellings = ["item/42", "/item/42", "///item/42"];
    const built = [];
    for (const spelling of spellings) built.push(await buildDeepLink(spelling));

    assert.deepEqual(built, [
      "https://collectables.app/collectables/item/42",
      "https://collectables.app/collectables/item/42",
      "https://collectables.app/collectables/item/42",
    ]);
  });
});

describe("buildDeepLink with no base URL", () => {
  it("falls back to the native scheme builder", async () => {
    baseUrl = "";
    createURLCalls.length = 0;

    assert.equal(await buildDeepLink("collection/7"), "collectables://collection/7");
    assert.deepEqual(createURLCalls, ["collection/7"]);
  });

  it("hands the builder the stripped path, not the caller's", async () => {
    // `createURL("/collection/7")` produces `scheme:///collection/7` — three
    // slashes, an empty authority, and a link that resolves to nothing. The
    // strip runs before the branch, so this is the same normalisation the
    // configured-base case gets.
    baseUrl = "";
    createURLCalls.length = 0;

    await buildDeepLink("/collection/7");

    assert.deepEqual(createURLCalls, ["collection/7"]);
  });
});

describe("the assumption the join rests on", () => {
  it("never produces a base that ends in a slash, from either source", async () => {
    // Asked of the real helpers rather than the mock: `${base}/${clean}` is
    // only right because nothing upstream can hand it a trailing slash, and
    // that is a fact about `lib/url-helpers.ts` that lives two modules away
    // from the template literal depending on it.
    const configured = [
      "https://collectables.app",
      "https://collectables.app/",
      "https://collectables.app///",
    ].map((raw) => resolveAppBaseUrl(normalizeConfiguredUrl(raw), null, null));
    assert.deepEqual(configured, [
      "https://collectables.app",
      "https://collectables.app",
      "https://collectables.app",
    ]);

    // The web branch: an origin (never slash-terminated) plus the first path
    // segment, which `inferWebBasePath` returns slash-PREFIXED and never
    // slash-terminated — the shape a GitHub Pages project base has.
    const fromOrigin = resolveAppBaseUrl("", "https://user.github.io", "/collectables/item/42");
    assert.equal(fromOrigin, "https://user.github.io/collectables");
    assert.equal(inferWebBasePath("/"), "");

    for (const base of [...configured, fromOrigin]) {
      assert.ok(!base.endsWith("/"), `${base} ends in a slash, and buildDeepLink appends one`);
    }
  });
});
