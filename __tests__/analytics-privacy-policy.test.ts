import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function rowFor(src: string, label: string): string {
  const m = src.match(
    new RegExp(`${label}[\\s\\S]*?\\n(?=\\| [A-Za-z(])`),
  );
  assert.ok(m, `App Privacy row for "${label}" not found`);
  return m[0];
}

describe("Analytics #19 — privacy declarations (PostHog / Clarity / Power BI)", () => {
  it("App Privacy table adds a PostHog product-analytics row (Yes | Yes | No)", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    assert.match(
      src,
      /Product analytics events\s*\|\s*\*\*Yes\*\*\s*\|\s*Yes\s*\|\s*No\s*\|/,
      "PostHog row must read 'Yes | Yes | No' (collected, linked, not tracking)",
    );
    const row = rowFor(src, "Product analytics events");
    assert.match(row, /PostHog/, "row must name PostHog");
    assert.match(
      row,
      /lib\/analytics\.ts/,
      "row must cite lib/analytics.ts so reviewers can audit the event set",
    );
  });

  it("App Privacy table adds a Microsoft Clarity row (Yes | No | No — not linked)", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    assert.match(
      src,
      /Session replay \/ heatmaps\s*\|\s*\*\*Yes\*\*\s*\|\s*No\s*\|\s*No\s*\|/,
      "Clarity row must read 'Yes | No | No' — anonymous, not linked to the user",
    );
    const row = rowFor(src, "Session replay \\/ heatmaps");
    assert.match(row, /Clarity/, "row must name Microsoft Clarity");
    assert.match(
      row,
      /doNotTrack/,
      "row must note the Do-Not-Track gate so the GDPR story is auditable",
    );
  });

  it("App Privacy table records Power BI as no-in-app-SDK", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    const row = rowFor(src, "Reporting \\/ BI");
    assert.match(row, /Power BI/, "row must name Power BI");
    assert.match(
      row,
      /no SDK/i,
      "Power BI row must clarify no SDK ships in the app (operator-side only)",
    );
  });

  it("public privacy paragraphs cover each sub-processor with its policy link", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    assert.match(
      src,
      /Suggested public privacy policy paragraphs/i,
      "section heading must pluralise to cover all sub-processors",
    );
    assert.match(
      src,
      /https:\/\/posthog\.com\/privacy/,
      "must link PostHog's privacy policy",
    );
    assert.match(
      src,
      /https:\/\/privacy\.microsoft\.com\/privacystatement/,
      "must link Microsoft's privacy statement for Clarity",
    );
    assert.match(
      src,
      /\*\*Reporting\.\*\*[\s\S]*Power BI/,
      "must include a Reporting paragraph clarifying Power BI is operator-side",
    );
  });

  it("opt-out section documents the single toggle covers analytics + replay", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    assert.match(
      src,
      /initAnalytics\(\)/,
      "opt-out section must note initAnalytics short-circuits when opted out",
    );
    assert.match(
      src,
      /shutdownClarity\(\)/,
      "opt-out section must note Clarity is torn down on opt-out",
    );
  });
});
