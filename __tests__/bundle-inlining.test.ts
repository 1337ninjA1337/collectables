import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  checkBundleInlining,
  formatBundleInliningReport,
  WATCHED_INLINED_VAR_NAMES,
} from "../lib/bundle-inlining";

const ROOT = join(__dirname, "..");

describe("checkBundleInlining", () => {
  it("reports inlined when the set value appears in the bundle", () => {
    const results = checkBundleInlining(
      `x={EXPO_PUBLIC_SENTRY_DSN:"https://abc@o0.ingest.sentry.io/1"}`,
      { EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1" },
      ["EXPO_PUBLIC_SENTRY_DSN"],
    );
    assert.deepStrictEqual(results, [
      { name: "EXPO_PUBLIC_SENTRY_DSN", status: "inlined" },
    ]);
  });

  it("reports inlined for in-place inlining without the key name", () => {
    // babel replaces `process.env.EXPO_PUBLIC_SUPABASE_URL` with the bare
    // string literal — no object key in sight.
    const results = checkBundleInlining(
      `const url="https://proj.supabase.co"||runtime?.url`,
      { EXPO_PUBLIC_SUPABASE_URL: "https://proj.supabase.co" },
      ["EXPO_PUBLIC_SUPABASE_URL"],
    );
    assert.equal(results[0].status, "inlined");
  });

  it("reports missing when a set value is absent from the bundle", () => {
    const results = checkBundleInlining(
      `x={EXPO_PUBLIC_SENTRY_DSN:void 0}`,
      { EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1" },
      ["EXPO_PUBLIC_SENTRY_DSN"],
    );
    assert.equal(results[0].status, "missing");
  });

  it("skips unset and blank values", () => {
    const results = checkBundleInlining(
      "whatever",
      { EXPO_PUBLIC_SENTRY_DSN: "   ", EXPO_PUBLIC_POSTHOG_KEY: undefined },
      ["EXPO_PUBLIC_SENTRY_DSN", "EXPO_PUBLIC_POSTHOG_KEY"],
    );
    assert.equal(results[0].status, "skipped-unset");
    assert.equal(results[1].status, "skipped-unset");
  });

  it("matches values containing regex/JSON special characters literally", () => {
    const value = 'weird"key\\with$pecial.chars';
    const bundle = `k:${JSON.stringify(value)}`;
    const results = checkBundleInlining(bundle, { EXPO_PUBLIC_POSTHOG_KEY: value }, [
      "EXPO_PUBLIC_POSTHOG_KEY",
    ]);
    assert.equal(results[0].status, "inlined");
  });

  it("defaults to the watched var list", () => {
    const results = checkBundleInlining("bundle", {});
    assert.deepStrictEqual(
      results.map((r) => r.name),
      [...WATCHED_INLINED_VAR_NAMES],
    );
    assert.ok(results.every((r) => r.status === "skipped-unset"));
  });
});

describe("formatBundleInliningReport", () => {
  it("fails only when a var is missing, and never leaks values", () => {
    const { report, failed } = formatBundleInliningReport([
      { name: "A", status: "inlined" },
      { name: "B", status: "skipped-unset" },
    ]);
    assert.equal(failed, false);
    assert.match(report, /A: \[inlined\]/);
    assert.match(report, /B: \[not set — skipped\]/);
  });

  it("marks the run failed on a missing var and points at lint:env-inlining", () => {
    const { report, failed } = formatBundleInliningReport([
      { name: "EXPO_PUBLIC_SENTRY_DSN", status: "missing" },
    ]);
    assert.equal(failed, true);
    assert.match(report, /EXPO_PUBLIC_SENTRY_DSN: MISSING/);
    assert.match(report, /lint:env-inlining/);
  });
});

describe("deploy workflow wiring", () => {
  const deployYml = readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8");

  it("runs the verifier after the web build", () => {
    assert.match(deployYml, /scripts\/verify-bundle-inlining\.ts/);
    assert.ok(
      deployYml.indexOf("expo export") < deployYml.indexOf("verify-bundle-inlining"),
      "verification must run after the bundle is exported",
    );
  });

  it("passes the verifier only env vars the build step also received", () => {
    const buildStep = deployYml.slice(
      deployYml.indexOf("- name: Build web"),
      deployYml.indexOf("- name: Verify secret inlining in bundle"),
    );
    const verifyStep = deployYml.slice(
      deployYml.indexOf("- name: Verify secret inlining in bundle"),
      deployYml.indexOf("- name: Upload sourcemaps to Sentry"),
    );
    const verifyVars = [...verifyStep.matchAll(/(EXPO_PUBLIC_[A-Z0-9_]+):/g)].map(
      (m) => m[1],
    );
    assert.ok(verifyVars.length >= 3, "verify step should receive the core secrets");
    for (const name of verifyVars) {
      assert.ok(
        buildStep.includes(`${name}:`),
        `verify step passes ${name} but the build step never received it — this would false-fail the deploy`,
      );
    }
  });
});
