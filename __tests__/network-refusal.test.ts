/**
 * The suites cannot reach the network, and this is where that is checked.
 *
 * WHAT THIS IS ABOUT. `PUBLISHED_ELSEWHERE_NOTE` rides every failure of the
 * audit gate telling a contributor it is "the one check here whose answer can
 * change while the repository does not". `verify-gate-script.test.ts` measures
 * that claim by scanning the gate's CLI wrappers for a remote read, and it
 * says out loud what it skips: the suites. `npm test` runs 1420 files, they
 * stub `fetch` by name in dozens of places, and a marker scan cannot tell a
 * stub from a call — so the leg with the most code in it, and the one most
 * likely to acquire a real request, was the leg nothing looked at.
 *
 * That was filed twice as a follow-up and both times as a gap in the SCAN. It
 * is not a scan problem. Whether a call goes out is a runtime fact, and the
 * runtime is right there: `__tests__/test-globals.ts` is preloaded into every
 * test process by `--import`, before any suite loads, so it can replace the
 * global and make a request that nobody stubbed throw instead of leave.
 *
 * ## Why stubbing is not a hole in it
 *
 * A suite that assigns `globalThis.fetch` has said what the response is; the
 * request never leaves either way. What the refusal catches is the call NOBODY
 * stubbed — a helper that grew a real request, a module that fetches on
 * import, a stub installed for one case and reached from another. Those are
 * the shapes that would send a request to a real host, and they are exactly
 * the ones no reader would spot in a diff.
 */

import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { request } from "node:https";
import { describe, it } from "node:test";

import { NETWORK_MARKERS } from "./helpers/gate-legs";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The refusal as the bootstrap left it, captured before any case runs.
 *
 * A suite is free to stub the global — that is the point — so a case that read
 * `globalThis.fetch` at call time would be asking about whatever ran last.
 * This is the value every OTHER suite starts its life with.
 */
const installed = globalThis.fetch;

describe("a test that reaches the network fails instead", () => {
  it("throws rather than returning a promise, so nothing awaits a real host", () => {
    // Synchronous on purpose: a rejected promise is something a suite can
    // swallow with a `.catch`, and half the value here is that the failure
    // lands in the case that made the call.
    assert.throws(
      () => installed("https://registry.npmjs.org/postcss"),
      /tried to fetch https:\/\/registry\.npmjs\.org\/postcss/,
    );
  });

  it("names what was being fetched, however the caller spelled it", () => {
    // The three shapes `fetch` takes. A message that said "a request" would
    // send the reader looking through 1420 files for the caller.
    assert.throws(() => installed(new URL("https://example.test/a")), /https:\/\/example\.test\/a/);
    assert.throws(
      () => installed({ url: "https://example.test/b" } as unknown as Request),
      /https:\/\/example\.test\/b/,
    );
    assert.throws(() => installed(undefined as unknown as string), /an unnamed request/);
  });

  it("says where the refusal came from and what to do instead", () => {
    // A failure nobody can act on gets worked around. This one names the file
    // that installed it and the one legitimate way past it.
    assert.throws(() => installed("https://example.test"), {
      message: /Stub the call for the case that needs a response/,
    });
    assert.throws(() => installed("https://example.test"), {
      message: /__tests__\/test-globals\.ts/,
    });
  });

  it("lets a suite stub the global, because a stub never leaves the process", () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (() =>
        Promise.resolve({ ok: true })) as unknown as typeof globalThis.fetch;
      assert.doesNotThrow(() => globalThis.fetch("https://example.test"));
    } finally {
      globalThis.fetch = original;
    }
    // And restoring puts the refusal back, which is what every suite that
    // saves and restores the global is relying on without knowing it.
    assert.throws(() => globalThis.fetch("https://example.test"), /tried to fetch/);
  });
});

describe("the other ways out of the tree", () => {
  // The audit gate's scan names four shapes for a read outside the tree: a
  // `fetch`, an http/https client, an `npm audit` and an `npx expo install`.
  // The refusal shipped covering the first, and a refusal that covered one of
  // four would leave the other three exactly as invisible as `fetch` was on
  // the morning the case for it was made.

  it("refuses http and https, through the module object", () => {
    for (const client of [http, https]) {
      assert.throws(
        () => client.request("http://example.test/x"),
        /open an http connection to http:\/\/example\.test\/x/,
      );
      assert.throws(() => client.get("http://example.test/y"), /example\.test\/y/);
    }
  });

  it("refuses a NAMED import of the same function", () => {
    // The shape the patch is not obviously able to reach, and the reason it
    // does: `tsx` transpiles these suites to CommonJS, so a named import
    // compiles to a property read at CALL time. Under a native-ESM runner the
    // binding would be made when the builtin was evaluated and this case would
    // go red — which is the point of pinning it rather than assuming it.
    assert.throws(() => request("https://example.test/named"), /example\.test\/named/);
  });

  it("refuses a spawned network tool, whatever path it is given as", () => {
    for (const spawnCurl of [
      () => execFileSync("curl", ["https://example.test"]),
      () => execFileSync("/usr/bin/curl", ["https://example.test"]),
      () => execSync("wget https://example.test -O -"),
      () => execFileSync("npm", ["audit"]),
      () => execFileSync("npx", ["expo", "install", "--check"]),
    ]) {
      assert.throws(spawnCurl, /tried to spawn (?:curl|wget|npm|npx)/);
    }
  });

  it("lets the spawns this repository actually makes through", () => {
    // Refusing spawning outright would break the guard-fixture suites, which
    // run `node`, `tsx` and `git` dozens of times — and those are reads of
    // THIS TREE, which is the thing the whole rule is about.
    assert.equal(execFileSync(process.execPath, ["-e", "process.stdout.write('ok')"], {
      encoding: "utf8",
    }), "ok");
  });
});

/**
 * The scan and the refusal describe the same property and were written apart.
 *
 * `NETWORK_MARKERS` is what `verify-gate-script.test.ts` looks for in a gate
 * script's TEXT; the bootstrap's patches are what a suite is refused at
 * RUNTIME. They agreed on the day the second was written from the first by
 * hand, which is the arrangement every "two copies" entry in `.tasks/` is
 * about — so the population comes from the scan's list here, and a fifth
 * marker with no runtime probe is a red run rather than a quiet asymmetry.
 */
describe("every marker the scan reads is refused at runtime", () => {
  const PROBES: Readonly<Record<string, () => unknown>> = {
    "an `npm audit` of the registry": () => execFileSync("npm", ["audit", "--json"]),
    "`expo install --check`, which resolves versions against the registry": () =>
      execFileSync("npx", ["expo", "install", "--check"]),
    "a `fetch` call": () => installed("https://example.test"),
    "an http/https client import": () => https.request("https://example.test"),
  };

  it("has a probe for every marker, and no probe for a marker that has gone", () => {
    const markers = NETWORK_MARKERS.map(([label]) => label).sort();
    assert.deepEqual(
      Object.keys(PROBES).sort(),
      markers,
      "the scan's markers and the runtime probes have drifted — a marker with no probe is a shape the suites can still perform, and a probe with no marker is a refusal nothing asks for",
    );
  });

  it("refuses each of them, so the two describe one property", () => {
    for (const [label, probe] of Object.entries(PROBES)) {
      assert.throws(probe, /A test tried to/, `${label} is not refused at runtime`);
    }
  });
});

describe("the refusal is wired into every test process", () => {
  const pkg = JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> };

  it("is preloaded by --import, before any suite can load", () => {
    // A bootstrap a suite imports itself would cover the suites that
    // remembered to. `--import` covers the ones that have not been written.
    for (const script of ["test", "test:only", "test:sentry"]) {
      assert.match(
        pkg.scripts[script],
        /--import \.\/__tests__\/test-globals\.ts/,
        `\`npm run ${script}\` runs suites without the bootstrap, so nothing refuses a request in them`,
      );
    }
  });

  it("installs the refusal at module scope rather than in a beforeEach", () => {
    // A `beforeEach` would fight every suite that stubs `fetch` in a `before`
    // or at module scope — it would reinstall the refusal underneath a stub
    // that was deliberately put there. Once, at import, is the only placement
    // that refuses the unstubbed call without breaking the stubbed one.
    const bootstrap = readRepoFile("__tests__/test-globals.ts");
    const assignment = bootstrap.indexOf("globalThis.fetch = ");
    assert.ok(assignment > 0, "the bootstrap no longer replaces `fetch`");
    assert.ok(
      !/beforeEach\([^)]*\{[^}]*globalThis\.fetch/s.test(bootstrap),
      "the refusal is being reinstalled per test, which would overwrite a suite's own stub",
    );
  });
});
