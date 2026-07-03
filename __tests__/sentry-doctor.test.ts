import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  envelopeUrl,
  formatDoctorReport,
  parseDsn,
  releaseFilesUrl,
  releasesUrl,
  runSentryDoctor,
  type DoctorFetcher,
} from "../lib/sentry-doctor";

const DSN = "https://abc123@o450.ingest.sentry.io/4509";
const FULL_ENV = {
  EXPO_PUBLIC_SENTRY_DSN: DSN,
  SENTRY_AUTH_TOKEN: "token-1",
  SENTRY_ORG: "anton-m3",
  SENTRY_PROJECT: "collectables",
};

function fakeFetcher(
  routes: Record<string, { status: number; body?: unknown }>,
  log: string[] = [],
): DoctorFetcher {
  return async (url, init) => {
    log.push(`${init?.headers?.Authorization ?? "anon"} ${url}`);
    const route = routes[url];
    if (!route) throw new Error(`unrouted ${url}`);
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body ?? null,
    };
  };
}

describe("sentry-doctor url builders", () => {
  it("parses a canonical DSN and rejects malformed ones", () => {
    assert.deepEqual(parseDsn(DSN), {
      host: "o450.ingest.sentry.io",
      projectId: "4509",
    });
    assert.equal(parseDsn("https://hooks.slack.com/services/T0/B0/x"), null);
    assert.equal(parseDsn(""), null);
  });

  it("builds the probe and API urls with encoding", () => {
    assert.equal(
      envelopeUrl("h.ingest.sentry.io", "42"),
      "https://h.ingest.sentry.io/api/42/envelope/",
    );
    assert.ok(releasesUrl("org", "proj").endsWith("/releases/?per_page=1"));
    assert.ok(
      releaseFilesUrl("org", "proj", "collectables@a/b").includes(
        "collectables%40a%2Fb",
      ),
      "release version must be percent-encoded",
    );
  });
});

describe("runSentryDoctor", () => {
  it("all green when DSN reachable, release tagged, artifacts present", async () => {
    const checks = await runSentryDoctor(
      FULL_ENV,
      fakeFetcher({
        [envelopeUrl("o450.ingest.sentry.io", "4509")]: { status: 405 },
        [releasesUrl("anton-m3", "collectables")]: {
          status: 200,
          body: [{ version: "collectables@abc", dateCreated: "2026-07-01" }],
        },
        [releaseFilesUrl("anton-m3", "collectables", "collectables@abc")]: {
          status: 200,
          body: [{ name: "main.js.map" }],
        },
      }),
    );
    assert.deepEqual(
      checks.map((c) => [c.name, c.status]),
      [
        ["dsn", "ok"],
        ["release", "ok"],
        ["sourcemaps", "ok"],
      ],
    );
    assert.equal(formatDoctorReport(checks).ok, true);
  });

  it("skips everything gracefully with an empty env", async () => {
    const checks = await runSentryDoctor({}, fakeFetcher({}));
    assert.deepEqual(
      checks.map((c) => c.status),
      ["skip", "skip", "skip"],
    );
    assert.equal(formatDoctorReport(checks).ok, true, "skips are not failures");
  });

  it("fails the DSN check on a malformed DSN without fetching", async () => {
    const log: string[] = [];
    const checks = await runSentryDoctor(
      { EXPO_PUBLIC_SENTRY_DSN: "https://hooks.slack.com/services/x" },
      fakeFetcher({}, log),
    );
    assert.equal(checks[0].status, "fail");
    assert.equal(log.length, 0, "must not probe a malformed DSN");
  });

  it("downgrades a thrown fetch to a fail, never throws", async () => {
    const checks = await runSentryDoctor(FULL_ENV, async () => {
      throw new Error("ECONNREFUSED");
    });
    assert.equal(checks[0].status, "fail");
    assert.match(checks[0].detail, /ECONNREFUSED/);
    assert.equal(formatDoctorReport(checks).ok, false);
  });

  it("flags an empty release list and skips the sourcemap check", async () => {
    const checks = await runSentryDoctor(
      FULL_ENV,
      fakeFetcher({
        [envelopeUrl("o450.ingest.sentry.io", "4509")]: { status: 405 },
        [releasesUrl("anton-m3", "collectables")]: { status: 200, body: [] },
      }),
    );
    assert.equal(checks[1].status, "fail");
    assert.match(checks[1].detail, /no releases tagged/);
    assert.equal(checks[2].status, "skip");
  });

  it("flags a release with no uploaded artifacts", async () => {
    const checks = await runSentryDoctor(
      FULL_ENV,
      fakeFetcher({
        [envelopeUrl("o450.ingest.sentry.io", "4509")]: { status: 405 },
        [releasesUrl("anton-m3", "collectables")]: {
          status: 200,
          body: [{ version: "v1" }],
        },
        [releaseFilesUrl("anton-m3", "collectables", "v1")]: {
          status: 200,
          body: [],
        },
      }),
    );
    assert.equal(checks[2].status, "fail");
    assert.match(checks[2].detail, /minified/);
  });

  it("reports a bad token as a release failure with scope hint", async () => {
    const checks = await runSentryDoctor(
      FULL_ENV,
      fakeFetcher({
        [envelopeUrl("o450.ingest.sentry.io", "4509")]: { status: 405 },
        [releasesUrl("anton-m3", "collectables")]: { status: 401 },
      }),
    );
    assert.equal(checks[1].status, "fail");
    assert.match(checks[1].detail, /token scope/);
  });

  it("sends the bearer token only to the API endpoints", async () => {
    const log: string[] = [];
    await runSentryDoctor(
      FULL_ENV,
      fakeFetcher(
        {
          [envelopeUrl("o450.ingest.sentry.io", "4509")]: { status: 405 },
          [releasesUrl("anton-m3", "collectables")]: {
            status: 200,
            body: [{ version: "v1" }],
          },
          [releaseFilesUrl("anton-m3", "collectables", "v1")]: {
            status: 200,
            body: [{}],
          },
        },
        log,
      ),
    );
    assert.match(log[0], /^anon /, "ingest probe must be unauthenticated");
    assert.match(log[1], /^Bearer token-1 /);
    assert.match(log[2], /^Bearer token-1 /);
  });
});

describe("script wiring", () => {
  it("registers sentry:check in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    assert.equal(pkg.scripts["sentry:check"], "tsx scripts/sentry-doctor.ts");
  });
});
