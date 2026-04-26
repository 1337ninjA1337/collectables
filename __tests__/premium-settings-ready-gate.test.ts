import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("settings screen gates the premium card on usePremium().ready", () => {
  const src = read("app/settings.tsx");

  it("destructures `ready` from usePremium()", () => {
    assert.match(src, /ready\s*:\s*premiumReady/);
  });

  it("renders the skeleton when ready=false", () => {
    assert.match(src, /testID=["']premium-card-skeleton["']/);
    assert.match(src, /premiumCardSkeleton/);
  });

  it("renders the real premium card branch only when ready=true", () => {
    assert.match(
      src,
      /\{premiumReady\s*\?\s*\(\s*<View\s+style=\{isPremium\s*\?\s*styles\.premiumCardActive\s*:\s*styles\.premiumCard\}/,
    );
  });

  it("declares the skeleton styles needed for the placeholder", () => {
    assert.match(src, /premiumCardSkeleton:\s*{/);
    assert.match(src, /premiumSkeletonTitle:\s*{/);
    assert.match(src, /premiumSkeletonLine:\s*{/);
    assert.match(src, /premiumSkeletonLineShort:\s*{/);
    assert.match(src, /premiumSkeletonButton:\s*{/);
  });

  it("does not render the Activate CTA inside the skeleton fallback", () => {
    const skeletonBlock = src.match(
      /testID=["']premium-card-skeleton["'][\s\S]*?<\/View>\s*\)\}/,
    );
    assert.ok(skeletonBlock, "skeleton block not found");
    assert.doesNotMatch(skeletonBlock![0], /premiumActivate\b/);
    assert.doesNotMatch(skeletonBlock![0], /premiumCancel\b/);
  });
});
