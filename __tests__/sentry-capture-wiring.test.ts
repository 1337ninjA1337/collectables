import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const profilesSrc = readFileSync(
  path.join(process.cwd(), "lib", "supabase-profiles.ts"),
  "utf8",
);
const chatSrc = readFileSync(
  path.join(process.cwd(), "lib", "supabase-chat.ts"),
  "utf8",
);
const marketplaceSrc = readFileSync(
  path.join(process.cwd(), "lib", "supabase-marketplace.ts"),
  "utf8",
);

describe("Crash #7 — capture in supabase-profiles.ts", () => {
  it("imports captureException", () => {
    assert.match(
      profilesSrc,
      /import\s*\{\s*captureException\s*\}\s*from\s*["']@\/lib\/sentry["']/,
    );
  });

  it("captures fetchCollectionsSharedWithUser failures", () => {
    assert.match(
      profilesSrc,
      /captureException\(err,\s*\{\s*context:\s*["']supabase-profiles\.fetchCollectionsSharedWithUser["']\s*\}\)/,
    );
  });

  it("captures registerSharedCollectionViewer failures", () => {
    assert.match(
      profilesSrc,
      /captureException\(err,\s*\{\s*context:\s*["']supabase-profiles\.registerSharedCollectionViewer["']\s*\}\)/,
    );
  });
});

describe("Crash #7 — capture in supabase-chat.ts", () => {
  it("imports captureException", () => {
    assert.match(
      chatSrc,
      /import\s*\{\s*captureException\s*\}\s*from\s*["']@\/lib\/sentry["']/,
    );
  });

  it("captures realtime inbox listener errors", () => {
    assert.match(
      chatSrc,
      /captureException\(err,\s*\{\s*context:\s*["']supabase-chat\.subscribeToInbox\.handler["']\s*\}\)/,
    );
  });
});

describe("Crash #7 — capture in supabase-marketplace.ts", () => {
  it("imports captureException", () => {
    assert.match(
      marketplaceSrc,
      /import\s*\{\s*captureException\s*\}\s*from\s*["']@\/lib\/sentry["']/,
    );
  });

  it("captures realtime listings listener errors", () => {
    assert.match(
      marketplaceSrc,
      /captureException\(err,\s*\{\s*context:\s*["']supabase-marketplace\.subscribeToListings\.handler["']\s*\}\)/,
    );
  });
});

describe("Crash #7 — preserves silent cleanup catches", () => {
  it("channel removal catches stay silent (best-effort cleanup)", () => {
    // We deliberately do NOT capture exceptions in the unsubscribe paths
    // because errors there are expected when the socket is already closed.
    // Assert there is no captureException directly inside the unsubscribe blocks.
    const removeChannelBlocks = chatSrc.match(
      /try\s*\{\s*void\s+client\.removeChannel\([\s\S]*?\}\s*catch[\s\S]*?\}/g,
    );
    assert.ok(removeChannelBlocks && removeChannelBlocks.length > 0);
    for (const block of removeChannelBlocks) {
      assert.doesNotMatch(
        block,
        /captureException/,
        "channel removal cleanup should not capture (errors are expected)",
      );
    }
  });
});
