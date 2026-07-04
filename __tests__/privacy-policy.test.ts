import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * PRIVACY.md is the public, user-facing privacy policy. It must consume the
 * "Suggested public privacy policy paragraphs" from APPSTORE-SUBMISSION.md §6
 * and the analytics "Privacy and opt-out" story from
 * docs/analytics-platform.md so the three disclosures never drift.
 */
describe("PRIVACY.md — public privacy policy", () => {
  const policy = read("PRIVACY.md");

  it("names every sub-processor", () => {
    for (const name of ["Supabase", "Cloudinary", "Sentry", "PostHog", "Microsoft Clarity"]) {
      assert.ok(policy.includes(name), `PRIVACY.md must name sub-processor ${name}`);
    }
  });

  it("consumes the drafted Sentry paragraph from APPSTORE-SUBMISSION.md §6", () => {
    for (const sentence of [
      "Functional Software, Inc., d/b/a Sentry",
      "stripped client-side",
      "https://sentry.io/legal/dpa/",
    ]) {
      assert.ok(policy.includes(sentence), `Sentry paragraph must include: ${sentence}`);
    }
  });

  it("consumes the drafted PostHog paragraph (EU region + closed event set)", () => {
    for (const sentence of [
      "fixed, closed set of interaction events",
      "eu.posthog.com",
      "https://posthog.com/dpa",
    ]) {
      assert.ok(policy.includes(sentence), `PostHog paragraph must include: ${sentence}`);
    }
  });

  it("consumes the drafted Clarity paragraph (anonymous, DNT-gated, web-only)", () => {
    for (const sentence of [
      "navigator.doNotTrack",
      "masks input fields by default",
      "not used on the iOS or Android app",
    ]) {
      assert.ok(policy.includes(sentence), `Clarity paragraph must include: ${sentence}`);
    }
  });

  it("translates the analytics opt-out story from docs/analytics-platform.md", () => {
    for (const marker of [
      "Diagnostics & analytics",
      "Do Not Track",
      "GDPR Art. 7",
      "deny-by-default",
    ]) {
      assert.ok(policy.includes(marker), `opt-out section must include: ${marker}`);
    }
  });

  it("discloses the server-side retention windows (13 months / 30 days / 90-day)", () => {
    for (const window of ["**13 months**", "**30 days**", "**90-day**"]) {
      assert.ok(policy.includes(window), `retention section must include ${window}`);
    }
  });

  it("gives users a deletion contact", () => {
    assert.match(policy, /1337\.antoxa@gmail\.com/);
  });

  it("declares no tracking / no data sale", () => {
    assert.match(policy, /sold/);
    assert.match(policy, /data brokers/);
  });
});

describe("PRIVACY.md — stays in sync with the engineering docs", () => {
  it("the Sentry/PostHog/Clarity paragraphs match APPSTORE-SUBMISSION.md §6 verbatim anchors", () => {
    const policy = read("PRIVACY.md");
    const submission = read("APPSTORE-SUBMISSION.md");
    // Anchor sentences that must exist in BOTH files — editing one without
    // the other breaks this test instead of silently drifting.
    for (const anchor of [
      "personally identifying fields (email address, IP",
      "rate-limited\n> client-side",
      "Clarity recordings are **not** linked to your",
      "no Power BI software is\n> included in the app",
      "permanently removed after a **90-day** grace period",
    ]) {
      assert.ok(policy.includes(anchor), `PRIVACY.md missing anchor: ${JSON.stringify(anchor)}`);
      assert.ok(submission.includes(anchor), `APPSTORE-SUBMISSION.md missing anchor: ${JSON.stringify(anchor)}`);
    }
  });

  it("mirrors the DNT default described in docs/analytics-platform.md", () => {
    const platform = read("docs/analytics-platform.md");
    assert.match(platform, /doNotTrack/);
    assert.match(read("PRIVACY.md"), /doNotTrack/);
  });
});
