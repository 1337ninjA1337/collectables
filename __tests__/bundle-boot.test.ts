import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateBundleBoot,
  formatBundleBootReport,
  isSameOrigin,
  MIN_ROOT_HTML_LENGTH,
  type BootObservation,
} from "../lib/bundle-boot";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * The rule for what a boot failure IS.
 *
 * The browser half cannot be unit-tested — it drives Chromium over the
 * DevTools protocol — which is exactly why the judgement lives in a pure
 * module: "a 404 from another origin is the network's problem" is a decision,
 * and a decision inside a browser callback is one nobody can argue with.
 */

const ORIGIN = "http://127.0.0.1:4173";

/** A healthy boot: the auth screen, one chunk, nothing on fire. */
function healthy(overrides: Partial<BootObservation> = {}): BootObservation {
  return {
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    rootHtmlLength: 3155,
    bodyText: "АККАУНТ COLLECTABLES\nВойдите, чтобы хранить свои коллекции",
    chunksFetched: ["entry-abc123.js"],
    ...overrides,
  };
}

describe("what counts as a failed boot", () => {
  it("passes a tree that mounted", () => {
    const result = evaluateBundleBoot(healthy(), ORIGIN);
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
  });

  it("fails on an uncaught exception", () => {
    const result = evaluateBundleBoot(
      healthy({ pageErrors: ["TypeError: t is not a function"] }),
      ORIGIN,
    );
    assert.equal(result.ok, false);
    assert.equal(result.failures[0].kind, "page error");
  });

  it("fails on a console error", () => {
    // React logs a caught render error here before the boundary renders, so a
    // tree that mounted its FALLBACK looks healthy by markup alone.
    const result = evaluateBundleBoot(
      healthy({ consoleErrors: ["The above error occurred in <AppShell>"] }),
      ORIGIN,
    );
    assert.equal(result.ok, false);
    assert.equal(result.failures[0].kind, "console error");
  });

  it("fails on a same-origin request that did not arrive", () => {
    const result = evaluateBundleBoot(
      healthy({
        failedRequests: [{ url: `${ORIGIN}/collectables/_expo/static/js/web/pl-1.js`, status: 404 }],
      }),
      ORIGIN,
    );
    assert.equal(result.ok, false);
    assert.match(result.failures[0].detail, /HTTP 404/);
  });

  it("ignores a request to another origin", () => {
    // Supabase, a font host and an analytics endpoint are all unreachable from
    // a sandbox with no internet. A check that reddened on that would be a
    // check about the network.
    const result = evaluateBundleBoot(
      healthy({
        failedRequests: [
          { url: "https://xyz.supabase.co/auth/v1/session", status: null },
          { url: "https://fonts.googleapis.com/css2", status: 403 },
        ],
      }),
      ORIGIN,
    );
    assert.equal(result.ok, true);
  });

  it("fails on an empty root, which is what a render error leaves behind", () => {
    const result = evaluateBundleBoot(healthy({ rootHtmlLength: 0 }), ORIGIN);
    assert.equal(result.ok, false);
    assert.equal(result.failures[0].kind, "empty root");
  });

  it("passes markup at the threshold and fails just under it", () => {
    assert.equal(evaluateBundleBoot(healthy({ rootHtmlLength: MIN_ROOT_HTML_LENGTH }), ORIGIN).ok, true);
    assert.equal(
      evaluateBundleBoot(healthy({ rootHtmlLength: MIN_ROOT_HTML_LENGTH - 1 }), ORIGIN).ok,
      false,
    );
  });

  it("reports every problem rather than the first", () => {
    // One CI run, or one hand-run, should say everything that is wrong: a
    // fail-fast order costs a second boot to discover the second problem.
    const result = evaluateBundleBoot(
      healthy({
        pageErrors: ["Error: boom"],
        consoleErrors: ["also broken"],
        rootHtmlLength: 0,
      }),
      ORIGIN,
    );
    assert.deepEqual(
      result.failures.map((f) => f.kind),
      ["page error", "console error", "empty root"],
    );
  });
});

describe("isSameOrigin", () => {
  it("matches the origin itself and its paths", () => {
    assert.equal(isSameOrigin(ORIGIN, ORIGIN), true);
    assert.equal(isSameOrigin(`${ORIGIN}/collectables/index.html`, ORIGIN), true);
  });

  it("does not match a host that merely starts the same way", () => {
    // `http://127.0.0.1:41730` starts with `http://127.0.0.1:4173`, and the
    // port is chosen by the OS — so this is a real collision, not a
    // hypothetical one.
    assert.equal(isSameOrigin("http://127.0.0.1:41730/x.js", ORIGIN), false);
    assert.equal(isSameOrigin("https://evil.example/127.0.0.1:4173", ORIGIN), false);
  });
});

describe("formatBundleBootReport", () => {
  it("says what mounted and what the first line on screen was", () => {
    const report = formatBundleBootReport("check-bundle-boot", evaluateBundleBoot(healthy(), ORIGIN));
    assert.match(report, /OK — the tree mounted \(3155 characters/);
    assert.match(report, /first line on screen: "АККАУНТ COLLECTABLES"/);
    assert.match(report, /fetched 1 chunk\(s\): entry-abc123\.js/);
  });

  it("lists every failure and says a red here is a broken site", () => {
    const report = formatBundleBootReport(
      "check-bundle-boot",
      evaluateBundleBoot(healthy({ pageErrors: ["Error: boom"], rootHtmlLength: 0 }), ORIGIN),
    );
    assert.match(report, /FAIL — 2 problem\(s\)/);
    assert.match(report, /page error: Error: boom/);
    assert.match(report, /a broken site, not a broken test/);
  });
});

describe("the script around it", () => {
  const SCRIPT = read("scripts/check-bundle-boot.ts");

  it("is wired as check:boot and stays out of the gate", () => {
    // The decision the module's doc block argues: a check that downloads a
    // browser is a check that goes red when a download does. The suggestion
    // asking for a tenth gate leg is still open, and this is not it.
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.scripts["check:boot"], "tsx scripts/check-bundle-boot.ts");
    assert.ok(!pkg.scripts.verify.includes("check:boot"));
    assert.ok(!pkg.scripts["verify:dist"].includes("check:boot"));
    assert.ok(!read(".github/workflows/ci.yml").includes("check:boot"));
  });

  it("adds no dependency to do it", () => {
    // Node 22 has a WebSocket client, and Chromium speaks CDP over one.
    const pkg = JSON.parse(read("package.json"));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.ok(
        !name.includes("playwright") && !name.includes("puppeteer"),
        `${name} arrived for a script that navigates to one URL`,
      );
    }
    assert.ok(!SCRIPT.includes("playwright"), "the script must not import a driver");
  });

  it("serves the app at the base path the deploy uses", () => {
    // Read from app.json rather than spelled: the export's asset URLs are
    // absolute from `experiments.baseUrl`, so serving dist/ at `/` produces a
    // page that fails to fetch its own entry chunk — which is what the first
    // hand-run of this check did.
    assert.match(SCRIPT, /experiments\?\.baseUrl/);
    assert.match(SCRIPT, /requested\.startsWith\(baseUrl\)/);
    const appJson = JSON.parse(read("app.json"));
    assert.equal(typeof appJson.expo.experiments.baseUrl, "string");
  });

  it("shares the post-build premise with the other dist/ readers", () => {
    // A boot check against a stale dist/ boots yesterday's app with today's
    // confidence — the same failure `assertBundlePremise` exists for.
    assert.match(SCRIPT, /assertBundlePremise\(CHECK_NAME\)/);
  });

  it("lets the OS choose the port", () => {
    // Two runs at once must not collide, and a hard-coded port is also the
    // one a developer's own dev server is most likely to be on.
    assert.match(SCRIPT, /server\.listen\(0, "127\.0\.0\.1"/);
  });
});
