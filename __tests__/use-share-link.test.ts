import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/env-inlining";
import { COPIED_RESET_MS, buildSharePayload } from "@/lib/share-link-helpers";
import { readRepoFile } from "./helpers/repo-file";

/**
 * `lib/use-share-link.ts` holds the share-a-deep-link ceremony every share
 * surface used to repeat inline: the `Share.share()` payload, the clipboard
 * write, the `copied` flag and its reset timer.
 *
 * The pure half (`buildSharePayload`, `COPIED_RESET_MS`) is exercised
 * directly; the hook half is pinned structurally, since the repo has no React
 * mounting harness — see the `[needs-dev-dep]` tasks in .tasks/.tasks.md.
 * The pure exports live in `lib/share-link-helpers.ts` precisely so they stay
 * importable under plain `tsx --test` — `lib/use-share-link.ts` itself pulls
 * in `Platform`/`Share` and cannot be loaded outside a react-native runtime.
 */
function readHookSrc(): string {
  return readRepoFile("lib/use-share-link.ts");
}

describe("buildSharePayload", () => {
  it("prefixes the message with the entity name when one is given", () => {
    assert.deepEqual(buildSharePayload("https://example.com/item/1", "Blue Penny"), {
      message: "Blue Penny\nhttps://example.com/item/1",
      url: "https://example.com/item/1",
    });
  });

  it("falls back to the bare url when no name is given", () => {
    assert.deepEqual(buildSharePayload("https://example.com/item/1"), {
      message: "https://example.com/item/1",
      url: "https://example.com/item/1",
    });
  });

  it("treats an empty name as absent rather than emitting a leading newline", () => {
    assert.equal(buildSharePayload("https://example.com/c/1", "").message, "https://example.com/c/1");
  });

  it("keeps the url on both fields so native sheets that ignore `url` still carry the link", () => {
    const payload = buildSharePayload("https://example.com/profile/abc", "Anton");
    assert.equal(payload.url, "https://example.com/profile/abc");
    assert.ok(payload.message.endsWith("https://example.com/profile/abc"));
  });

  it("does not mangle a url that already contains a newline-unsafe query string", () => {
    const url = "https://example.com/item/1?ref=share&x=a%20b";
    assert.equal(buildSharePayload(url, "T").message, `T\n${url}`);
  });
});

describe("COPIED_RESET_MS", () => {
  it("is the 2s window the copy-feedback label has always used", () => {
    assert.equal(COPIED_RESET_MS, 2000);
  });
});

describe("useShareLink — structure", () => {
  it("exports the hook, the pure payload builder and the platform capability flag", () => {
    const src = readHookSrc();
    assert.match(src, /export function useShareLink\(/);
    assert.match(src, /export \{ COPIED_RESET_MS, buildSharePayload \};/);
    assert.match(src, /export const CAN_COPY_TO_CLIPBOARD = Platform\.OS === "web";/);
    const helpers = readRepoFile("lib/share-link-helpers.ts");
    assert.match(helpers, /export const COPIED_RESET_MS = 2000;/);
    assert.match(helpers, /export function buildSharePayload\(/);
    assert.doesNotMatch(helpers, /from "react-native"/, "the pure half must stay node-importable");
    assert.doesNotMatch(helpers, /from "react"/, "the pure half must stay node-importable");
  });

  it("clears the pending reset timer on unmount", () => {
    const src = readHookSrc();
    assert.match(src, /useRef<ReturnType<typeof setTimeout>\s*\|\s*null>\(null\)/);
    assert.match(src, /useEffect\(\s*\(\) => \(\) => \{\s*if \(resetTimer\.current\) clearTimeout\(resetTimer\.current\);\s*\},\s*\[\],?\s*\)/);
  });

  it("only flips `copied` (and fires onCopy) after the clipboard write resolves", () => {
    const src = readHookSrc();
    const copy = src.match(/const copyLink = useCallback\([\s\S]*?\}, \[onCopy, url\]\);/);
    assert.ok(copy, "copyLink useCallback not found");
    assert.match(copy[0], /if \(!CAN_COPY_TO_CLIPBOARD \|\| !navigator\.clipboard\) return;/);
    assert.match(copy[0], /navigator\.clipboard\.writeText\(url\)\.then\(\(\) => \{[\s\S]*?setCopied\(true\);[\s\S]*?onCopy\?\.\(url\);/);
    // Restarting the timer on a repeat copy must not leave the old one armed.
    assert.match(copy[0], /if \(resetTimer\.current\) clearTimeout\(resetTimer\.current\);\s*resetTimer\.current = setTimeout\(/);
  });

  it("routes the native share through the pure payload builder", () => {
    const src = readHookSrc();
    assert.match(src, /const shareNative = useCallback\(\(\) => \{\s*Share\.share\(buildSharePayload\(url, message\)\);\s*\}, \[message, url\]\);/);
  });

  it("returns the documented shape", () => {
    const src = readHookSrc();
    assert.match(src, /return \{ copied, canCopy: CAN_COPY_TO_CLIPBOARD, copyLink, shareNative \};/);
    const shape = src.match(/export type ShareLink = \{[\s\S]*?\n\};/);
    assert.ok(shape, "ShareLink type not found");
    for (const field of [/\bcopied: boolean;/, /\bcanCopy: boolean;/, /\bcopyLink: \(\) => void;/, /\bshareNative: \(\) => void;/]) {
      assert.match(shape[0], field, `missing field ${field}`);
    }
  });

  it("pulls in no navigation, i18n or design-token dependencies (stays a pure behaviour hook)", () => {
    const code = stripComments(readHookSrc());
    for (const forbidden of [/@\/lib\/design-tokens/, /@\/lib\/i18n-context/, /expo-router/, /StyleSheet/]) {
      assert.doesNotMatch(code, forbidden, `${forbidden} does not belong in a behaviour hook`);
    }
  });
});
