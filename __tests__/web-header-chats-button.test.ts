import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural test for the new "Chats" entry point in the desktop/web header.
 *
 * The bottom nav is mobile-only (`if (!isMobile) return null` in
 * `components/bottom-nav.tsx`), and the only other path to /chats is the
 * link inside `app/friends.tsx` which itself lives behind the bottom nav.
 * Web users were therefore left with no UI affordance for chats; this test
 * pins the new header button so it can't silently disappear.
 */

const LAYOUT_SRC = readFileSync(
  path.join(process.cwd(), "app", "_layout.tsx"),
  "utf8",
);

describe("web header chats button", () => {
  it("imports useChat to read unread count for the badge", () => {
    assert.match(
      LAYOUT_SRC,
      /import\s*\{[^}]*\buseChat\b[^}]*\}\s*from\s*"@\/lib\/chat-context"/,
    );
  });

  it("imports formatBadgeCount for the count pill", () => {
    assert.match(
      LAYOUT_SRC,
      /import\s*\{[^}]*formatBadgeCount[^}]*\}\s*from\s*"@\/lib\/chat-helpers"/,
    );
  });

  it("calls useChat() inside AppShell and reads unreadTotal", () => {
    assert.match(LAYOUT_SRC, /const\s*\{[^}]*\bunreadTotal\b[^}]*\}\s*=\s*useChat\(\)/);
  });

  it("renders a chatbubbles icon button that pushes /chats", () => {
    assert.match(LAYOUT_SRC, /chatbubbles-outline/);
    assert.match(LAYOUT_SRC, /router\.push\("\/chats"\)/);
  });

  it("hides the chats button when the user is already on /chats", () => {
    // The button is wrapped in `pathname !== "/chats" ? (...) : null` so it
    // doesn't redundantly link to the current page.
    assert.match(LAYOUT_SRC, /pathname\s*!==\s*"\/chats"/);
  });

  it("renders the chats button only on non-mobile (under the showMobileNav gate)", () => {
    // The whole headerRight block returns null when showMobileNav is true,
    // so the chats button inherits that gate. The other gate must remain.
    assert.match(LAYOUT_SRC, /showMobileNav\s*\?\s*null\s*:/);
  });

  it("renders an unread badge when unreadTotal > 0 using formatBadgeCount", () => {
    assert.match(LAYOUT_SRC, /unreadTotal\s*>\s*0/);
    assert.match(LAYOUT_SRC, /formatBadgeCount\(unreadTotal\)/);
  });

  it("declares headerBadge / headerBadgeText styles for the unread pill", () => {
    assert.match(LAYOUT_SRC, /headerBadge:\s*\{/);
    assert.match(LAYOUT_SRC, /headerBadgeText:\s*\{/);
  });
});
