import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for the shared deep-link share sheet
 * (`components/share-sheet.tsx`), extracted from `app/item/[id].tsx` so the
 * collection sheet — and the profile sheet that follows — layer their own
 * sections in via `children` instead of re-declaring ~150 LOC of chrome.
 *
 * These are source-level assertions (the repo has no React mounting harness —
 * see the `[needs-dev-dep]` tasks in .tasks/.tasks.md), so they pin the
 * contract: where the chrome lives, where the copy state lives, that the timer
 * is cleaned up, and that no consumer re-implements any of it.
 */
function read(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const shareSheetSrc = () => read("components", "share-sheet.tsx");
const itemSrc = () => read("app", "item", "[id].tsx");
const collectionSheetSrc = () => read("components", "collection-share-sheet.tsx");

describe("ShareSheet — shared deep-link sheet", () => {
  it("exports a named-form memo component", () => {
    const src = shareSheetSrc();
    assert.match(src, /export\s+const\s+ShareSheet\s*=\s*(?:React\.)?memo\(\s*function\s+ShareSheet\b/);
    assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/);
  });

  it("takes the documented prop contract (url / hint / message / onClose / onCopy / children)", () => {
    const src = shareSheetSrc();
    const props = src.match(/type Props = \{[\s\S]*?\n\};/);
    assert.ok(props, "Props type not found");
    for (const prop of [
      /\bvisible: boolean;/,
      /\burl: string;/,
      /\bhint: string;/,
      /\bmessage\?: string;/,
      /\bonClose: \(\) => void;/,
      /\bonCopy\?: \(url: string\) => void;/,
      /\bchildren\?: ReactNode;/,
    ]) {
      assert.match(props[0], prop, `missing prop ${prop}`);
    }
  });

  it("owns the chrome markup and its styles", () => {
    const src = shareSheetSrc();
    for (const style of [
      "shareBackdrop:",
      "shareSheet:",
      "shareHandle:",
      "shareTitle:",
      "shareHint:",
      "shareLinkBox:",
      "shareLinkText:",
      "shareActions:",
      "shareCopyButton:",
      "shareNativeButton:",
      "shareCancelButton:",
    ]) {
      assert.match(src, new RegExp(style.replace(":", "\\s*:")), `${style} must live in components/share-sheet.tsx`);
    }
    // Consumer sections render between the actions row and Cancel.
    assert.match(src, /\{children\}[\s\S]*?styles\.shareCancelButton/);
  });

  it("routes every chrome string through t()", () => {
    const src = shareSheetSrc();
    for (const key of ["shareTitle", "linkCopied", "copyLink", "shareVia", "cancel"]) {
      assert.match(src, new RegExp(`t\\("${key}"`), `missing t("${key}")`);
    }
    assert.match(src, /useI18n\(\)/);
    // The per-screen hint is a prop, not a hard-coded key.
    assert.doesNotMatch(src, /t\("share(Item|Collection|Profile)Hint"\)/);
  });

  it("owns the copied state and clears the 2s reset timer on unmount", () => {
    const src = shareSheetSrc();
    assert.match(src, /const\s+\[copied,\s*setCopied\]\s*=\s*useState\(false\)/);
    assert.match(src, /setTimeout\(\(\)\s*=>\s*setCopied\(false\),\s*2000\)/);
    assert.match(src, /useRef<ReturnType<typeof setTimeout>\s*\|\s*null>\(null\)/);
    assert.match(src, /useEffect\([\s\S]*?clearTimeout\(resetTimer\.current\)[\s\S]*?\[\],?\s*\)/);
  });

  it("fires onCopy only after a successful clipboard write", () => {
    const src = shareSheetSrc();
    const handler = src.match(/const handleCopy = useCallback\([\s\S]*?\}, \[onCopy, url\]\);/);
    assert.ok(handler, "handleCopy useCallback not found");
    assert.match(handler[0], /navigator\.clipboard\.writeText\(url\)\.then\(\(\) => \{[\s\S]*?onCopy\?\.\(url\)/);
  });

  it("copy and native-share are platform-exclusive (no dead copy button on native)", () => {
    const src = shareSheetSrc();
    assert.match(
      src,
      /Platform\.OS === "web" \? \([\s\S]*?styles\.shareCopyButton[\s\S]*?\) : \([\s\S]*?styles\.shareNativeButton/,
      "web renders copy, native renders share-via — never both",
    );
    assert.match(src, /Share\.share\(\{ message: message \? `\$\{message\}\\n\$\{url\}` : url, url \}\)/);
  });

  it("puts the section gap on the ScrollView contentContainerStyle, not the wrapper", () => {
    const src = shareSheetSrc();
    assert.match(src, /contentContainerStyle=\{styles\.shareSheetContent\}/);
    const content = src.match(/shareSheetContent:\s*\{[\s\S]*?\},/);
    assert.ok(content, "shareSheetContent style not found");
    assert.match(content[0], /gap: SPACING_CARD/);
    // A gap on the sheet wrapper only ever spaced its single ScrollView child.
    const sheet = src.match(/\n  shareSheet:\s*\{[\s\S]*?\n  \},/);
    assert.ok(sheet, "shareSheet style not found");
    assert.doesNotMatch(sheet[0], /\bgap:/);
  });
});

describe("ShareSheet — consumers", () => {
  it("the item screen renders <ShareSheet> with a stable onClose and no local copy state", () => {
    const src = itemSrc();
    const site = src.match(/<ShareSheet\s[\s\S]*?\/>/);
    assert.ok(site, "<ShareSheet> call site not found in app/item/[id].tsx");
    assert.match(site[0], /visible=\{shareOpen\}/);
    assert.match(site[0], /url=\{buildDeepLink\(`item\/\$\{activeItem\.id\}`\)\}/);
    assert.match(site[0], /hint=\{t\("shareItemHint"\)\}/);
    assert.match(site[0], /message=\{activeItem\.title\}/);
    assert.match(site[0], /onClose=\{closeShareSheet\}/);
    assert.match(src, /const closeShareSheet = useCallback\(\(\) => setShareOpen\(false\), \[\]\);/);
    assert.doesNotMatch(src, /linkCopied/, "copy-feedback state belongs to <ShareSheet>");
  });

  it("the item screen dropped the chrome styles it no longer owns", () => {
    const src = itemSrc();
    for (const style of ["shareLinkBox:", "shareLinkText:", "shareNativeButton:", "shareCopyButtonDone:"]) {
      assert.doesNotMatch(src, new RegExp(style.replace(":", "\\s*:")), `${style} must live in components/share-sheet.tsx`);
    }
    assert.doesNotMatch(src, /\bShare\b\s*,/, "react-native Share import must be gone from the item screen");
    // The marketplace listing sheet still reuses the generic bottom-sheet
    // chrome styles, so those stay behind.
    assert.match(src, /shareSheet\s*:/);
    assert.match(src, /styles\.shareCancelButton\b/);
  });

  it("the collection sheet composes <ShareSheet> rather than duplicating it", () => {
    const src = collectionSheetSrc();
    assert.match(src, /import\s*\{\s*ShareSheet\s*\}\s*from\s*"@\/components\/share-sheet"/);
    assert.match(src, /<ShareSheet\b[\s\S]*?<\/ShareSheet>/);
    const rnImport = src.match(/import \{([^}]*)\} from "react-native";/);
    assert.ok(rnImport, "react-native import not found");
    assert.doesNotMatch(rnImport[1], /\bModal\b/, "the Modal wrapper belongs to <ShareSheet>");
    assert.doesNotMatch(rnImport[1], /\bShare\b/, "Share.share() belongs to <ShareSheet>");
  });

  it("no screen re-implements the sheet chrome outside components/share-sheet.tsx", () => {
    for (const [label, src] of [
      ["app/item/[id].tsx", itemSrc()],
      ["components/collection-share-sheet.tsx", collectionSheetSrc()],
    ] as const) {
      assert.doesNotMatch(src, /t\("copyLink"\)/, `${label} must not re-render the copy button`);
      assert.doesNotMatch(src, /t\("linkCopied"\)/, `${label} must not re-render the copied label`);
      assert.doesNotMatch(src, /t\("shareVia"\)/, `${label} must not re-render the native share button`);
      assert.doesNotMatch(src, /navigator\.clipboard/, `${label} must not re-implement the clipboard write`);
    }
  });
});
