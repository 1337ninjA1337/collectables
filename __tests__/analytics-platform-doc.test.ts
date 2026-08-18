import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import { readRepoFile, repoPath } from "./helpers/repo-file";

const DOC = "docs/analytics-platform.md";

describe("docs/analytics-platform.md decision record", () => {
  it("file exists at the canonical path", () => {
    assert.ok(
      existsSync(repoPath(DOC)),
      "docs/analytics-platform.md must be checked into the repo so the platform decision is auditable",
    );
  });

  it("declares PostHog as the chosen analytics platform with the EU host", () => {
    const src = readRepoFile(DOC);
    assert.match(src, /PostHog/, "Doc must name PostHog as the chosen vendor");
    assert.match(
      src,
      /eu\.posthog\.com/,
      "Doc must reference the EU PostHog host so future engineers know where data lands",
    );
    assert.match(
      src,
      /1\s*M\s*events\/mo|1,?000,?000\s*events\/mo|1M events\/month/i,
      "Doc must cite the 1M events/month free-tier ceiling",
    );
  });

  it("documents Microsoft Clarity as the web-only session-replay layer", () => {
    const src = readRepoFile(DOC);
    assert.match(src, /Microsoft Clarity/, "Doc must name Microsoft Clarity");
    assert.match(
      src,
      /web[- ]only/i,
      "Doc must clarify that Clarity is web-only",
    );
    assert.match(
      src,
      /mask|PII|privacy/i,
      "Doc must call out the input-mask requirement for Clarity",
    );
  });

  it("explains why Power BI Desktop is the BI surface and how data flows through Supabase", () => {
    const src = readRepoFile(DOC);
    assert.match(src, /Power BI/, "Doc must name Power BI as the BI tool");
    assert.match(
      src,
      /Supabase/,
      "Doc must explain how events get into Supabase Postgres before Power BI reads them",
    );
    assert.match(
      src,
      /webhook|mirror/i,
      "Doc must reference the PostHog→Supabase webhook/mirror because there is no native PostHog→Power BI connector",
    );
  });

  it("declares the platform comparison table (Mixpanel, Amplitude, etc.)", () => {
    const src = readRepoFile(DOC);
    // At least three real alternatives must be enumerated so the decision
    // is auditable as "we considered N alternatives, picked PostHog".
    assert.match(src, /Mixpanel/, "Doc must list Mixpanel as a considered alternative");
    assert.match(src, /Amplitude/, "Doc must list Amplitude as a considered alternative");
    assert.match(src, /Plausible/, "Doc must list Plausible as a considered alternative");
  });

  it("captures the cost ceiling so future readers know when to revisit", () => {
    const src = readRepoFile(DOC);
    assert.match(
      src,
      /\$0\/month|cost ceiling|free.tier/i,
      "Doc must document the $0/month free-tier target",
    );
  });
});
