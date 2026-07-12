import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("lib/premium-context.tsx — lastPremiumIntent ref", () => {
  const src = read("lib/premium-context.tsx");

  it("exposes activatePremium(source?) and consumeLastPremiumIntent on the context value", () => {
    assert.match(
      src,
      /activatePremium:\s*\(source\?:\s*PremiumIntentSource\)\s*=>\s*void/,
      "activatePremium must accept an optional PremiumIntentSource",
    );
    assert.match(
      src,
      /consumeLastPremiumIntent:\s*\(\)\s*=>\s*PremiumIntentSource/,
      "the context must expose the one-shot intent reader",
    );
  });

  it("records the intent BEFORE flipping state so the transition hook can read it", () => {
    const activateIdx = src.indexOf("const activatePremium = useCallback(");
    assert.ok(activateIdx >= 0, "activatePremium callback not found");
    const body = src.slice(activateIdx, src.indexOf("}, []", activateIdx));
    const refWrite = body.indexOf("lastPremiumIntentRef.current = source");
    const stateFlip = body.indexOf("setState(");
    assert.ok(refWrite >= 0, "activatePremium must record the source in the intent ref");
    assert.ok(stateFlip >= 0, "activatePremium must still flip the premium state");
    assert.ok(
      refWrite < stateFlip,
      "the ref write must precede setState — the isPremium transition effect reads it on the flip's render",
    );
  });

  it("consume is one-shot: reading resets the intent to server_sync", () => {
    const consumeIdx = src.indexOf("const consumeLastPremiumIntent = useCallback(");
    assert.ok(consumeIdx >= 0, "consumeLastPremiumIntent callback not found");
    const body = src.slice(consumeIdx, src.indexOf("}, []", consumeIdx));
    assert.match(
      body,
      /lastPremiumIntentRef\.current\s*=\s*["']server_sync["']/,
      "consuming must reset to server_sync so a later cloud-merge flip can't inherit a stale screen",
    );
  });

  it("the resting value is server_sync and untagged callers surface as unknown", () => {
    assert.match(
      src,
      /useRef<PremiumIntentSource>\(\s*["']server_sync["']\s*\)/,
      "the ref must rest at server_sync (a flip with no local intent is the cloud validation merge)",
    );
    assert.match(
      src,
      /activatePremium = useCallback\(\(source:\s*PremiumIntentSource\s*=\s*["']unknown["']\)/,
      "an untagged activatePremium() call must be visible on dashboards as unknown, not mislabelled",
    );
  });
});

describe("premium_activated.source — call-site tagging", () => {
  it("bottom-nav consumes the intent instead of hardcoding a screen", () => {
    const src = read("components/bottom-nav.tsx");
    assert.match(
      src,
      /const\s*\{[^}]*consumeLastPremiumIntent[^}]*\}\s*=\s*usePremium\(\)/,
      "bottom-nav must pull consumeLastPremiumIntent from usePremium()",
    );
    assert.match(
      src,
      /trackEvent\(\s*["']premium_activated["']\s*,\s*\{\s*source:\s*consumeLastPremiumIntent\(\)\s*,?\s*\}\s*\)/,
      "premium_activated.source must be the consumed intent",
    );
    assert.doesNotMatch(
      src,
      /source:\s*["']settings["']/,
      "the hardcoded settings tag must be gone",
    );
  });

  it("settings tags itself", () => {
    assert.match(
      read("app/settings.tsx"),
      /activatePremium\(\s*["']settings["']\s*\)/,
      "the settings upgrade button must tag source=settings",
    );
  });

  it("the upsell sheet tags its caller's source with an upsell_sheet fallback", () => {
    const src = read("components/premium-upsell-sheet.tsx");
    assert.match(
      src,
      /source\?:\s*PremiumIntentSource/,
      "the sheet must accept an optional source prop",
    );
    assert.match(
      src,
      /activatePremium\(\s*source\s*\?\?\s*["']upsell_sheet["']\s*\)/,
      "activation must use the caller's source, falling back to upsell_sheet",
    );
  });

  it("create-collection passes the same source as its premium_upsell_shown event", () => {
    const src = read("app/create-collection.tsx");
    assert.match(
      src,
      /source=["']create_collection["']/,
      "the sheet's source must match the screen's upsell_shown source so the funnel joins",
    );
    assert.match(
      src,
      /source:\s*["']create_collection["']/,
      "premium_upsell_shown must keep the matching source",
    );
  });

  it("taxonomy documents the intent-ref sources", () => {
    const desc = ANALYTICS_EVENTS.premium_activated.description;
    for (const source of ["settings", "create_collection", "upsell_sheet", "server_sync", "unknown"]) {
      assert.ok(
        desc.includes(source),
        `premium_activated description must document the ${source} source`,
      );
    }
  });
});
