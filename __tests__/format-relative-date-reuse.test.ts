import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readI18nSource } from "./helpers/i18n-source-file";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("formatRelativeDate reuse", () => {
  it("chats screen renders preview.lastMessageAt via formatChatPreviewTimestamp from useI18n", () => {
    const src = read("app/chats.tsx");
    assert.match(src, /formatChatPreviewTimestamp\s*\}\s*=\s*useI18n\(\)/);
    assert.match(src, /formatChatPreviewTimestamp\(preview\.lastMessageAt\)/);
    // The bespoke formatWhen helper should be gone now.
    assert.doesNotMatch(src, /function\s+formatWhen\s*\(/);
  });

  it("listing detail renders listing.createdAt as a localised 'Listed X ago' hint", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /formatRelativeDate[\s\S]*?\}\s*=\s*useI18n\(\)/);
    assert.match(src, /marketplaceListedAt/);
    assert.match(src, /formatRelativeDate\(listing\.createdAt\)/);
  });

  it("listing detail price-history rows render recordedAt via formatRelativeDate", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /formatRelativeDate\(entry\.recordedAt\)/);
    // The raw ISO slice fallback should be removed.
    assert.doesNotMatch(src, /entry\.recordedAt\.slice\(0,\s*10\)/);
  });
});

describe("marketplaceListedAt translations", () => {
  it("declares marketplaceListedAt in English with a {when} placeholder", () => {
    const src = readI18nSource();
    assert.match(
      src,
      /marketplaceListedAt:\s*\(params\?:\s*TranslationParams\)\s*=>\s*`[^`]*\$\{params\?\.when[^`]*`/,
    );
  });
});
