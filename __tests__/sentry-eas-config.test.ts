import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Sentry native sourcemap config (EAS / iOS)", () => {
  it("app.json registers the @sentry/react-native/expo config plugin", () => {
    const appJson = JSON.parse(read("app.json")) as {
      expo: { plugins?: Array<unknown> };
    };
    const plugins = appJson.expo.plugins ?? [];
    const sentry = plugins.find(
      (p) =>
        Array.isArray(p) &&
        typeof p[0] === "string" &&
        p[0] === "@sentry/react-native/expo",
    );
    assert.ok(
      sentry,
      "app.json must include the @sentry/react-native/expo plugin in expo.plugins",
    );
    const cfg = (sentry as [string, Record<string, unknown>])[1];
    assert.equal(typeof cfg, "object");
    assert.equal(typeof cfg.organization, "string");
    assert.equal(typeof cfg.project, "string");
  });

  it("app.json declares expo.extra.sentry with org + project slugs", () => {
    const appJson = JSON.parse(read("app.json")) as {
      expo: {
        extra?: {
          sentry?: { organization?: string; project?: string; url?: string };
        };
      };
    };
    const sentryExtra = appJson.expo.extra?.sentry;
    assert.ok(
      sentryExtra,
      "app.json must declare expo.extra.sentry so sentry-cli can resolve the project on EAS Build",
    );
    assert.ok(
      sentryExtra.organization && sentryExtra.organization.length > 0,
      "expo.extra.sentry.organization must be a non-empty string",
    );
    assert.ok(
      sentryExtra.project && sentryExtra.project.length > 0,
      "expo.extra.sentry.project must be a non-empty string",
    );
  });

  it("app.json plugin org/project match expo.extra.sentry org/project", () => {
    const appJson = JSON.parse(read("app.json")) as {
      expo: {
        plugins?: Array<unknown>;
        extra?: { sentry?: { organization?: string; project?: string } };
      };
    };
    const plugins = appJson.expo.plugins ?? [];
    const sentry = plugins.find(
      (p) =>
        Array.isArray(p) &&
        typeof p[0] === "string" &&
        p[0] === "@sentry/react-native/expo",
    ) as [string, { organization?: string; project?: string }] | undefined;
    assert.ok(sentry, "plugin entry missing");
    assert.equal(
      sentry[1].organization,
      appJson.expo.extra?.sentry?.organization,
      "plugin organization must match expo.extra.sentry.organization",
    );
    assert.equal(
      sentry[1].project,
      appJson.expo.extra?.sentry?.project,
      "plugin project must match expo.extra.sentry.project",
    );
  });

  it("APPSTORE-SUBMISSION.md documents SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT EAS secrets", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    for (const name of ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"]) {
      assert.match(
        src,
        new RegExp(
          `eas secret:create[^\\n]*--name\\s+${name}\\b`,
          "i",
        ),
        `APPSTORE-SUBMISSION.md must document an eas secret:create entry for ${name}`,
      );
    }
  });

  it("APPSTORE-SUBMISSION.md still lists the SENTRY runtime EAS secrets", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    for (const name of ["EXPO_PUBLIC_SENTRY_DSN", "EXPO_PUBLIC_SENTRY_ENV"]) {
      assert.match(
        src,
        new RegExp(`--name\\s+${name}\\b`),
        `APPSTORE-SUBMISSION.md must keep the eas secret:create entry for ${name}`,
      );
    }
  });
});
