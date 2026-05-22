import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural pins for the iOS Safari "A problem repeatedly occurred" fix in
 * `app/collection/[id].tsx`. The original bug: opening a private collection
 * deep-link on iOS Safari caused the auto-save-as-viewer useEffect to re-fire
 * on every parent-context re-render (because its dependency list includes
 * `t` / `toast` / `saveSharedCollection`, none of which are guaranteed
 * referentially stable). Each iteration mounted a toast and queued a network
 * write, eventually exhausting the tab's memory budget.
 *
 * Fixes pinned here:
 *  - A `useRef<string | null>` gate keyed on `params.id` runs the auto-save
 *    at most once per opened collection.
 *  - `sharedWithUserIds` is memoised via `useMemo` so the `?? []` fallback
 *    doesn't allocate a fresh array on every render.
 *  - Hero `<Image>` URL is routed through `withCloudinaryThumbUrl(...)` so
 *    the (potentially multi-MB) cover photo is fetched at hero-sized
 *    dimensions instead of full resolution.
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("app/collection/[id].tsx — iOS Safari crash guards", () => {
  const src = read("app/collection/[id].tsx");

  it("imports useRef from react alongside useEffect/useMemo/useState", () => {
    assert.match(src, /import\s*\{[^}]*\buseRef\b[^}]*\}\s*from\s*"react"/);
  });

  it("declares a per-id auto-save ref so a re-render cannot fire the save twice", () => {
    assert.match(src, /hasAttemptedShareSaveRef\s*=\s*useRef<\s*string\s*\|\s*null\s*>\s*\(\s*null\s*\)/);
  });

  it("guards the auto-save useEffect on the per-id ref and updates it before kicking the save off", () => {
    assert.match(src, /if\s*\(\s*hasAttemptedShareSaveRef\.current\s*===\s*params\.id\s*\)\s*return;\s*[\r\n]+\s*hasAttemptedShareSaveRef\.current\s*=\s*params\.id;/);
  });

  it("includes params.id in the auto-save effect's dependency array so a navigation between collections resets the gate", () => {
    const effectBlock = src.match(/saveSharedCollection\(remoteCollection\)[\s\S]+?\}\s*,\s*\[([^\]]+)\]/);
    assert.ok(effectBlock, "auto-save useEffect with saveSharedCollection should be present");
    assert.match(effectBlock![1], /params\.id/);
  });

  it("memoises sharedWithUserIds so the `?? []` fallback returns a stable reference between renders", () => {
    assert.match(src, /const sharedWithUserIds = useMemo\(/);
    const declIdx = src.indexOf("const sharedWithUserIds = useMemo(");
    assert.ok(declIdx > -1);
    const slice = src.slice(declIdx, declIdx + 300);
    assert.match(slice, /collection\?\.sharedWithUserIds \?\? \[\]/);
    assert.match(slice, /\[collection\?\.sharedWithUserIds\]/);
  });

  it("routes the hero coverPhoto URL through withCloudinaryThumbUrl so iOS Safari decodes a bounded-size image", () => {
    assert.match(src, /from\s+"@\/lib\/cloudinary-url"/);
    assert.match(
      src,
      /withCloudinaryThumbUrl\(\s*activeCollection\.coverPhoto\s*,\s*\{\s*width:\s*1200/,
    );
  });
});
