import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LANGUAGE_KEY } from "@/lib/storage-keys";

import {
  BOOT_SCENARIOS,
  evaluateBundleBoot,
  formatBundleBootReport,
  isBundleRequest,
  isSameOrigin,
  isSpaRouteRequest,
  MIN_ROOT_HTML_LENGTH,
  toBootRequestFailure,
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

  it("fails on a same-origin request that never got a response at all", () => {
    // The gap this closes: a chunk that dies without a status used to be
    // dropped, so a locale that was never served read as an empty screen
    // rather than as "the chunk did not arrive".
    const result = evaluateBundleBoot(
      healthy({
        failedRequests: [
          {
            url: `${ORIGIN}/collectables/_expo/static/js/web/pl-1.js`,
            status: null,
            errorText: "net::ERR_CONNECTION_RESET",
          },
        ],
      }),
      ORIGIN,
    );
    assert.equal(result.ok, false);
    // The reason is on the line: "no response" alone reads as a slow chunk.
    assert.match(result.failures[0].detail, /no response \(net::ERR_CONNECTION_RESET\)/);
  });

  it("says no response without a reason when Chromium gave none", () => {
    const result = evaluateBundleBoot(
      healthy({ failedRequests: [{ url: `${ORIGIN}/collectables/`, status: null }] }),
      ORIGIN,
    );
    assert.equal(result.failures[0].detail, `no response — ${ORIGIN}/collectables/`);
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

describe("a scenario that exists to prove a chunk is reachable", () => {
  it("fails when the chunk was never requested", () => {
    // The silent failure this catches: a `pl` that fell back to the default
    // copy mounts, fills the root and logs nothing. Every other rule here
    // passes it.
    const result = evaluateBundleBoot(healthy(), ORIGIN, "", /^pl-/);
    assert.equal(result.ok, false);
    assert.equal(result.failures[0].kind, "chunk not fetched");
    assert.match(result.failures[0].detail, /fetched entry-abc123\.js/);
  });

  it("passes when it was", () => {
    const result = evaluateBundleBoot(
      healthy({ chunksFetched: ["entry-abc123.js", "pl-9f8e7d.js"] }),
      ORIGIN,
      "",
      /^pl-/,
    );
    assert.equal(result.ok, true);
  });

  it("says so when the page fetched nothing at all", () => {
    const result = evaluateBundleBoot(healthy({ chunksFetched: [] }), ORIGIN, "", /^pl-/);
    assert.match(result.failures[0].detail, /fetched nothing/);
  });

  it("is not asked of the scenarios that do not name one", () => {
    assert.equal(evaluateBundleBoot(healthy({ chunksFetched: [] }), ORIGIN).ok, true);
  });
});

describe("what the check boots", () => {
  it("loads the home screen, a lazy locale and a deep link", () => {
    assert.deepEqual(
      BOOT_SCENARIOS.map((scenario) => scenario.name),
      ["home", "polish", "deep link"],
    );
  });

  it("seeds the language under the key the app reads", () => {
    // Spelled here it would drift; imported, a renamed key is a type error
    // rather than a boot in the default language under a Polish label.
    const polish = BOOT_SCENARIOS.find((scenario) => scenario.name === "polish");
    assert.ok(polish);
    assert.equal(polish.storage[LANGUAGE_KEY], "pl");
    assert.ok(polish.expectChunk, "a seeded locale that proves nothing about its chunk is a boot of the default copy");
  });

  it("asks for a route the export has no file for", () => {
    // The SPA fallback is the whole reason every route but `/` works, and the
    // home screen is the one path that does not exercise it.
    const deep = BOOT_SCENARIOS.find((scenario) => scenario.name === "deep link");
    assert.ok(deep);
    assert.match(deep.path, /^\/[a-z]/);
    assert.notEqual(deep.path, "/");
  });

  it("gives every scenario its own name and an absolute path", () => {
    const names = new Set(BOOT_SCENARIOS.map((scenario) => scenario.name));
    assert.equal(names.size, BOOT_SCENARIOS.length, "the report is keyed by name");
    for (const scenario of BOOT_SCENARIOS) {
      assert.match(scenario.path, /^\//, `${scenario.name} is appended to the base path`);
    }
  });
});

describe("toBootRequestFailure", () => {
  it("turns a dead request into a failure with no status and the reason", () => {
    assert.deepEqual(
      toBootRequestFailure({
        url: `${ORIGIN}/collectables/_expo/static/js/web/de-1.js`,
        errorText: "net::ERR_CONNECTION_REFUSED",
        canceled: false,
      }),
      {
        url: `${ORIGIN}/collectables/_expo/static/js/web/de-1.js`,
        status: null,
        errorText: "net::ERR_CONNECTION_REFUSED",
      },
    );
  });

  it("drops a request the page itself called off", () => {
    // An effect that unmounted or a fetch the app aborted is ordinary React
    // behaviour, and a check that reddened on it would be a check about
    // strict mode.
    assert.equal(
      toBootRequestFailure({ url: `${ORIGIN}/x.js`, errorText: "net::ERR_ABORTED", canceled: true }),
      null,
    );
  });

  it("drops an abort even when the flag is not set", () => {
    // Chromium sets `canceled` for most of them and reports only the error
    // text for the rest; both spellings mean the same thing.
    assert.equal(
      toBootRequestFailure({
        url: `${ORIGIN}/x.js`,
        errorText: "net::ERR_ABORTED",
        canceled: false,
      }),
      null,
    );
  });

  it("drops a failure it cannot attribute to a URL", () => {
    // The event carries a request id and nothing else. Without the sending
    // event there is no URL, so there is no way to ask whether it was this
    // origin — and the requests that die in a sandbox are all the other ones.
    assert.equal(
      toBootRequestFailure({ url: null, errorText: "net::ERR_NAME_NOT_RESOLVED", canceled: false }),
      null,
    );
  });
});

describe("what the artifact under test includes", () => {
  const BASE = "/collectables";

  it("ignores the browser's own favicon probe at the domain root", () => {
    // Chromium asks every origin for /favicon.ico whether the page mentions
    // one or not, and this export ships none. Counting it would fail every
    // healthy boot for something the deploy does not publish.
    const result = evaluateBundleBoot(
      healthy({ failedRequests: [{ url: `${ORIGIN}/favicon.ico`, status: 404 }] }),
      ORIGIN,
      BASE,
    );
    assert.equal(result.ok, true);
  });

  it("still counts a file under the base path", () => {
    const result = evaluateBundleBoot(
      healthy({ failedRequests: [{ url: `${ORIGIN}${BASE}/_expo/x.js`, status: 404 }] }),
      ORIGIN,
      BASE,
    );
    assert.equal(result.ok, false);
  });

  it("counts everything same-origin when the app is the whole origin", () => {
    // `experiments.baseUrl` is empty for a deploy at a domain root, and then
    // there is nothing above the app to belong to somebody else.
    const result = evaluateBundleBoot(
      healthy({ failedRequests: [{ url: `${ORIGIN}/x.js`, status: 404 }] }),
      ORIGIN,
      "",
    );
    assert.equal(result.ok, false);
  });

  it("does not match a sibling path that merely starts the same way", () => {
    assert.equal(isBundleRequest(`${ORIGIN}/collectables-old/x.js`, ORIGIN, BASE), false);
    assert.equal(isBundleRequest(`${ORIGIN}/collectables`, ORIGIN, BASE), true);
    assert.equal(isBundleRequest(`${ORIGIN}/collectables/x.js`, ORIGIN, BASE), true);
    assert.equal(isBundleRequest("https://xyz.supabase.co/collectables/x", ORIGIN, BASE), false);
  });
});

describe("isSpaRouteRequest", () => {
  it("treats an extensionless path as a route the shell answers", () => {
    assert.equal(isSpaRouteRequest("/collectables/item/abc"), true);
    assert.equal(isSpaRouteRequest("/collectables/people"), true);
    assert.equal(isSpaRouteRequest("/"), true);
  });

  it("treats a path that asked for a file as a file", () => {
    // The bug it fixes: serving the SPA shell for a chunk missing from dist/
    // hands the browser HTML with a `.js` content type, and the failure
    // arrives as a syntax error one step removed from "the file is not there".
    assert.equal(isSpaRouteRequest("/collectables/_expo/static/js/web/pl-1.js"), false);
    assert.equal(isSpaRouteRequest("/collectables/favicon.ico"), false);
  });

  it("looks at the last segment only", () => {
    // A version or a locale tag in a directory name is not an extension.
    assert.equal(isSpaRouteRequest("/collectables/v1.2/settings"), true);
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
  it("names the scenario, so three OK lines are three answers", () => {
    const report = formatBundleBootReport(
      "check-bundle-boot",
      evaluateBundleBoot(healthy(), ORIGIN),
      "polish",
    );
    for (const line of report.split("\n")) {
      assert.match(line, /^check-bundle-boot \[polish\]:/);
    }
  });

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

  it("remembers where each request was going, so a dead one has a URL", () => {
    // `Network.loadingFailed` has a request id and no URL. Without the map,
    // the whole class of "the chunk never arrived" was invisible.
    assert.match(SCRIPT, /requestUrls\.set\(params\.requestId, url\)/);
    assert.match(SCRIPT, /requestUrls\.get\(requestId\)/);
    assert.match(SCRIPT, /toBootRequestFailure\(/);
  });

  it("boots every scenario in one browser and closes each page after it", () => {
    assert.match(SCRIPT, /for \(const scenario of BOOT_SCENARIOS\)/);
    assert.match(SCRIPT, /Page\.navigate", \{ url: `\$\{origin\}\$\{readBaseUrl\(\)\}\$\{scenario\.path\}`/);
    assert.match(SCRIPT, /Target\.closeTarget/);
  });

  it("clears storage before every scenario, seeded or not", () => {
    // A new target is not a new origin: without the clear, the scenario after
    // the Polish one booted in Polish and said it was the default.
    assert.match(SCRIPT, /localStorage\.clear\(\);/);
    assert.match(SCRIPT, /Page\.addScriptToEvaluateOnNewDocument/);
  });

  it("does not stop at the first scenario that fails", () => {
    // A run that stopped would cost a second build to learn whether the other
    // two are broken too.
    assert.match(SCRIPT, /if \(!result\.ok\) process\.exitCode = 1;/);
    assert.doesNotMatch(SCRIPT, /if \(!result\.ok\) (?:break|return)/);
  });

  it("judges the boot against the base path it served the app on", () => {
    assert.match(SCRIPT, /evaluateBundleBoot\(\s*observation,\s*server\.origin,\s*readBaseUrl\(\),/);
  });

  it("404s a file that is missing from dist/ instead of handing back the shell", () => {
    assert.match(SCRIPT, /if \(!isSpaRouteRequest\(requested\)\) \{/);
    assert.match(SCRIPT, /res\.writeHead\(404/);
  });

  it("reports one broken request once", () => {
    // A request can answer 4xx and then fail; both events carry the same id.
    assert.match(SCRIPT, /reportedRequests\.has\(requestId\)/);
  });

  it("lets the OS choose the port", () => {
    // Two runs at once must not collide, and a hard-coded port is also the
    // one a developer's own dev server is most likely to be on.
    assert.match(SCRIPT, /server\.listen\(0, "127\.0\.0\.1"/);
  });
});
