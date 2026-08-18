import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";

import { RADIUS_CARD_SM, SPACING_SECTION } from "@/lib/design-tokens";
import { readRepoFile as read, repoPath } from "./helpers/repo-file";

/**
 * Structural pins for `<DashboardBanner>` — the "icon disc + title + hint +
 * chevron" row extracted from the home screen's two copies (the wishlist row
 * and the stats row), which were the same ~40 lines of stylesheet twice over.
 *
 * The most load-bearing pin here is not the markup: it is the `<Link asChild>`
 * style-flattening rule. An array style in that position crashed the entire
 * deployed web build once already (see `link-aschild-style-flatten.test.ts`),
 * and both extracted call sites were previously flattened by hand — a property
 * that is easy to lose when markup moves between files.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(repoPath(dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(repoPath(rel)).isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

const COMPONENT = "components/dashboard-banner.tsx";
const UI_FILES = ["app", "components"].flatMap(walk);

describe("components/dashboard-banner.tsx — markup", () => {
  const src = read(COMPONENT);

  it("renders disc → body → chevron in that order", () => {
    const icon = src.indexOf("styles.icon,");
    const title = src.indexOf("styles.title,");
    const hint = src.indexOf("styles.hint,");
    const arrow = src.indexOf("styles.arrow,");
    assert.ok(icon > 0 && title > 0 && hint > 0 && arrow > 0, "one of the four slots is missing");
    assert.ok(icon < title, "the disc leads the row");
    assert.ok(title < hint, "the hint follows the title");
    assert.ok(hint < arrow, "the chevron trails the row");
  });

  it("owns its <Link asChild> rather than expecting the caller to wrap it", () => {
    // As a bare child of a caller's <Link asChild>, the component would be
    // cloned with href/onPress props it has no obligation to forward — and a
    // forgotten forward is a dead row, not a type error.
    assert.match(src, /<Link href=\{href\} asChild>/);
    assert.match(src, /href: Href;/);
  });

  it("passes an OBJECT style to the Pressable, never an array", () => {
    // `Slot.mergeProps` spreads styles with a plain object spread, so an array
    // reaches the DOM as {0: …, 1: …} and React DOM throws on node.style[0].
    // This is the crash that took the deployed web build down.
    const pressable = src.match(/<Pressable[\s\S]*?\n {6}>/)?.[0] ?? "";
    assert.ok(pressable.length > 0, "could not parse the <Pressable> element");
    assert.match(pressable, /style=\{\{/, "the Pressable style must be an object literal");
    assert.doesNotMatch(pressable, /style=\{\[/, "an array style here crashes react-native-web");
  });

  it("reads its surface colours from the theme, not from fixed tokens", () => {
    // Both originals already did; the row sits between themed cards and would
    // be the only surface that ignores the theme if this regressed.
    assert.match(src, /useAppTheme\(\)/);
    assert.match(src, /theme\.bannerBg/);
    assert.match(src, /theme\.card/);
    assert.match(src, /theme\.text/);
    assert.match(src, /theme\.meta/);
  });

  it("stays presentational — no state, no i18n", () => {
    assert.doesNotMatch(src, /useState|useEffect/);
    assert.doesNotMatch(src, /useI18n|\bt\(/);
  });

  it("is memoized", () => {
    assert.match(src, /export const DashboardBanner = memo\(function DashboardBanner\(/);
  });
});

describe("components/dashboard-banner.tsx — resolved drift", () => {
  const src = read(COMPONENT);
  const banner = src.match(/ {2}banner: \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
  const iconText = src.match(/ {2}iconText: \{[\s\S]*?\n {2}\}/)?.[0] ?? "";

  it("parsed both style blocks (guards every assertion below from passing vacuously)", () => {
    assert.ok(banner.length > 0, "could not parse the `banner` style block");
    assert.ok(iconText.length > 0, "could not parse the `iconText` style block");
  });

  it("routes the radius through RADIUS_CARD_SM rather than the bare 20 both copies inlined", () => {
    assert.match(banner, /borderRadius: RADIUS_CARD_SM,/);
    assert.equal(RADIUS_CARD_SM, 20, "the inlined copies were 20 — keep the swap lossless");
  });

  it("routes the gap through SPACING_SECTION rather than the bare 14 both copies inlined", () => {
    // `gap: 14` slipped past `lint:radius`, which only bans 10 / 12 / 8.
    assert.match(banner, /gap: SPACING_SECTION,/);
    assert.equal(SPACING_SECTION, 14);
  });

  it("gives both glyphs one size — the 22-vs-20 split had nothing behind it", () => {
    assert.match(iconText, /fontSize: 22,/);
  });

  it("keys surface, border and disc off ONE tone flag", () => {
    // Three coupled values; three independent props would let a caller mix a
    // dark disc into an amber row and still type-check.
    assert.match(src, /const amber = tone === "amber";/);
    assert.match(src, /backgroundColor: amber \? theme\.bannerBg : theme\.card,/);
    assert.match(src, /borderColor: amber \? AMBER_SOFT : theme\.border,/);
    assert.match(src, /backgroundColor: amber \? AMBER_ACCENT : HERO_DARK/);
  });
});

describe("dashboard-banner — adoption across the UI", () => {
  it("the home screen renders both rows through the shared component", () => {
    const src = read("app/index.tsx");
    assert.match(src, /import \{ DashboardBanner \} from "@\/components\/dashboard-banner";/);
    assert.match(src, /<DashboardBanner\s*\n\s*href="\/wishlist"\s*\n\s*tone="amber"/);
    assert.match(src, /<DashboardBanner\s*\n\s*href="\/stats"\s*\n\s*icon="⊞"/);
    assert.equal(src.match(/<DashboardBanner\b/g)?.length, 2);
  });

  it("the stats row passes no tone, so the default stays exercised", () => {
    const src = read("app/index.tsx");
    const stats = src.match(/<DashboardBanner\s*\n\s*href="\/stats"[\s\S]*?\/>/)?.[0] ?? "";
    assert.ok(stats.length > 0, "could not parse the stats row");
    assert.doesNotMatch(stats, /tone=/);
  });

  it("the home screen keeps no private copy of the banner styles", () => {
    const src = read("app/index.tsx");
    assert.doesNotMatch(src, /wishlistBanner/);
    assert.doesNotMatch(src, /statsBanner/);
  });

  it("no other file hand-rolls a navigational chevron row", () => {
    // The trailing "›" is the tell for this shape. Anchored on the glyph rather
    // than on the 44x44 disc, which is generic enough that a send button
    // (`app/chat/[id].tsx`) and a search-result thumb (`search-overlay.tsx`)
    // share its geometry without being this row at all.
    //
    // `app/settings.tsx` is the one allowed non-consumer: its currency chevron
    // trails a settings list row with no icon disc, no hint line and no route —
    // it opens a sheet.
    const ALLOWED = new Set(["app/settings.tsx"]);
    const offenders = UI_FILES.filter(
      (f) => f !== COMPONENT && !ALLOWED.has(f) && /<Text style=\{[^}]*\}>›<\/Text>/.test(read(f)),
    );
    assert.deepEqual(offenders, [], "these files render their own chevron row — use <DashboardBanner> instead");
  });
});
