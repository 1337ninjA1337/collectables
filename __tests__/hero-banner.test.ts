import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { RADIUS_HERO_LG, SPACING_CARD, SPACING_GUTTER, SPACING_LIST } from "@/lib/design-tokens";

/**
 * Structural pins for `<HeroBanner>` — the dark banner extracted from the
 * EIGHT screens that had each hand-rolled it: three with the dark gradient
 * (home, settings, login) and five with the flat `HERO_DARK` fill (people,
 * friends, chats, marketplace, collections feed).
 *
 * Two classes of pin live here:
 *   1. the component still renders the full shape, since it is now the ONLY
 *      declaration — a regression here changes all eight screens at once;
 *   2. no consumer has re-grown a private copy, which is exactly how the eight
 *      originals drifted apart on every axis before the extraction.
 *
 * The drift-resolution decisions are asserted by value rather than left in a
 * comment, because "which of the eight shapes won" is the one thing a future
 * contributor cannot recover from the diff.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(process.cwd(), rel)).isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

const COMPONENT = "components/hero-banner.tsx";
const UI_FILES = ["app", "components"].flatMap(walk);

/** Every screen that renders the gradient banner. */
const GRADIENT_CONSUMERS = ["app/index.tsx", "app/settings.tsx", "components/login-screen.tsx"];

/** Every screen that renders the flat `HERO_DARK` banner. */
const SOLID_CONSUMERS = [
  "app/chats.tsx",
  "app/collections-feed.tsx",
  "app/friends.tsx",
  "app/marketplace.tsx",
  "app/people.tsx",
];

const CONSUMERS = [...GRADIENT_CONSUMERS, ...SOLID_CONSUMERS];

describe("components/hero-banner.tsx — markup", () => {
  const src = read(COMPONENT);

  it("renders eyebrow → headerSlot → title → subtitle → children in that order", () => {
    // The order IS the recipe. The home screen's account row has to sit above
    // the headline (it used to, inline); appending it after the copy via
    // `children` would push the sign-out control below the fold on a short
    // viewport while looking like a faithful port in review.
    const eyebrow = src.indexOf("styles.eyebrow");
    const slot = src.indexOf("{headerSlot}");
    const title = src.indexOf("styles.title");
    const subtitle = src.indexOf("styles.subtitle");
    const children = src.indexOf("{children}");
    assert.ok(
      eyebrow > 0 && slot > 0 && title > 0 && subtitle > 0 && children > 0,
      "one of the five slots is missing",
    );
    assert.ok(eyebrow < slot, "the eyebrow leads the banner");
    assert.ok(slot < title, "the header slot sits above the headline");
    assert.ok(title < subtitle, "the subtitle follows the title");
    assert.ok(subtitle < children, "children close the banner");
  });

  it("spreads the shared gradient bundle rather than re-declaring colours", () => {
    assert.match(src, /import \{ HERO_DARK_GRADIENT \} from "@\/lib\/gradients";/);
    assert.match(src, /<LinearGradient \{\.\.\.HERO_DARK_GRADIENT\} style=\{styles\.hero\}>/);
    assert.doesNotMatch(src, /colors=\{/, "the recipe belongs in lib/gradients.ts");
  });

  it("renders the same body for both tones, off one shared fragment", () => {
    // Two branches that each re-listed eyebrow/title/subtitle would be the
    // extraction's own drift reintroduced one level down: a slot added to one
    // branch and forgotten in the other is invisible until a screen renders it.
    assert.equal(src.match(/styles\.eyebrow/g)?.length, 1, "the eyebrow is rendered exactly once");
    assert.equal(src.match(/styles\.title/g)?.length, 1, "the title is rendered exactly once");
    assert.match(src, /const body = \(\s*\n\s*<>/);
    assert.match(src, /if \(tone === "solid"\)/);
  });

  it("the solid tone fills with HERO_DARK and draws no gradient", () => {
    assert.match(src, /heroSolid: \{\s*\n\s*backgroundColor: HERO_DARK,/);
    assert.match(src, /<View style=\{\{ \.\.\.styles\.hero, \.\.\.styles\.heroSolid \}\}>\{body\}<\/View>/);
  });

  it("defaults to the gradient tone", () => {
    // Five of the eight consumers are solid, but the default is the flagship
    // banner: a screen that forgets the prop should look like the home hero,
    // not silently lose the gradient.
    assert.match(src, /tone = "gradient",/);
  });

  it("omits the subtitle element entirely when no subtitle is passed", () => {
    // Settings passes none. Rendering an empty <Text> would still consume a
    // `gap` slot and leave the banner taller than its content.
    assert.match(src, /\{subtitle == null \? null : <Text style=\{styles\.subtitle\}>/);
  });

  it("stays presentational — no state, no i18n, no navigation", () => {
    // Every string is caller-supplied and already localized: the eight screens
    // pass six different eyebrows, so a `t()` call inside would only ever be a
    // prop in disguise.
    assert.doesNotMatch(src, /useState|useEffect/);
    assert.doesNotMatch(src, /useI18n|\bt\(/);
    assert.doesNotMatch(src, /expo-router/);
  });

  it("is memoized, since several consumers re-render on every keystroke", () => {
    assert.match(src, /export const HeroBanner = memo\(function HeroBanner\(/);
  });

  it("announces the title as a header", () => {
    // New with the extraction — none of the eight copies had it, so a screen
    // reader had no landmark and had to swipe the banner linearly.
    assert.match(src, /<Text style=\{styles\.title\} accessibilityRole="header">/);
  });

  it("exposes no style override prop", () => {
    // An escape hatch would let the next screen re-open every one of the drifts
    // this extraction just closed, while still reading as an adoption.
    assert.doesNotMatch(src, /\bstyle\??:/, "HeroBanner must not accept a style prop");
    assert.doesNotMatch(src, /StyleProp|ViewStyle|TextStyle/);
  });
});

describe("components/hero-banner.tsx — resolved drift", () => {
  const src = read(COMPONENT);
  const hero = src.match(/hero: \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
  const title = src.match(/ {2}title: \{[\s\S]*?\n {2}\}/)?.[0] ?? "";

  it("parsed both style blocks (guards every assertion below from passing vacuously)", () => {
    assert.ok(hero.length > 0, "could not parse the `hero` style block");
    assert.ok(title.length > 0, "could not parse the `title` style block");
  });

  it("takes the majority gap — SPACING_LIST (6 screens), not SPACING_CARD (home + login)", () => {
    assert.match(hero, /gap: SPACING_LIST,/);
    assert.notEqual(SPACING_CARD, SPACING_LIST, "the two gap tokens must stay distinguishable");
  });

  it("routes the radius through RADIUS_HERO_LG rather than the bare 32 literal", () => {
    // Login, friends and the collections feed each inlined 32. Same number, but
    // a literal is invisible to a future retheme AND to `npm run lint:radius`,
    // which only bans a fixed set of magic values.
    assert.match(hero, /borderRadius: RADIUS_HERO_LG,/);
    assert.equal(RADIUS_HERO_LG, 32, "the inlined copies were 32 — keep the swap lossless");
  });

  it("routes the padding through SPACING_GUTTER rather than the bare 24 every other copy used", () => {
    assert.match(hero, /padding: SPACING_GUTTER,/);
    assert.equal(SPACING_GUTTER, 24);
  });

  it("takes the majority title font — FONT_DISPLAY_EDITORIAL, not FONT_DISPLAY and not nothing", () => {
    // The most visible half of the drift: five screens rendered a serif
    // headline, login + friends a sans one, and the collections feed declared
    // no family at all, so it fell back to the platform default face.
    assert.match(title, /fontFamily: FONT_DISPLAY_EDITORIAL,/);
    assert.doesNotMatch(title, /FONT_DISPLAY,/);
  });

  it("takes the majority title metrics — 28 / 36 / 800", () => {
    // 28/36 on six screens; home was 32/38 and login 30/38.
    assert.match(title, /fontSize: 28,/);
    assert.match(title, /lineHeight: 36,/);
    assert.match(title, /fontWeight: "800",/);
  });

  it("keeps the title on TEXT_ON_DARK_3 rather than marketplace's PAGE_BG", () => {
    // Two near-identical creams; one of them is semantically a page
    // background, and a themed page would have dragged the headline with it.
    assert.match(title, /color: TEXT_ON_DARK_3,/);
    assert.doesNotMatch(src.replace(/\/\*\*[\s\S]*?\*\//g, ""), /PAGE_BG/, "PAGE_BG outside the prose");
  });

  it("declares the subtitle's fontSize instead of inheriting React Native's default", () => {
    // Five of the seven subtitle copies omitted it entirely, so the same
    // "supporting line" rendered at 14 on five screens and 15 on two.
    const subtitle = src.match(/ {2}subtitle: \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    assert.ok(subtitle.length > 0, "could not parse the `subtitle` style block");
    assert.match(subtitle, /fontSize: 15,/);
    assert.match(subtitle, /lineHeight: 22,/);
    assert.match(subtitle, /fontFamily: FONT_BODY,/);
  });
});

describe("hero-banner — adoption across the UI", () => {
  it("all eight hero screens render the shared component", () => {
    for (const file of CONSUMERS) {
      const src = read(file);
      assert.match(src, /import \{ HeroBanner \} from "@\/components\/hero-banner";/, file);
      assert.match(src, /<HeroBanner\b/, file);
    }
  });

  it("no consumer keeps a private copy of the banner styles", () => {
    // The tell that someone ported the markup but left the stylesheet behind,
    // which is how a "shared" component quietly grows a fourth variant.
    for (const file of CONSUMERS) {
      const src = read(file);
      assert.doesNotMatch(src, /\n {2}hero: \{/, `${file} still declares a hero style`);
      assert.doesNotMatch(src, /\n {2}eyebrow: \{/, `${file} still declares an eyebrow style`);
    }
  });

  it("no consumer still imports LinearGradient for a banner it no longer draws", () => {
    for (const file of CONSUMERS) {
      assert.doesNotMatch(read(file), /expo-linear-gradient/, file);
    }
  });

  it("<HeroBanner> is the only file declaring the eyebrow recipe", () => {
    // The uppercase amber kicker is the most copy-pasteable line in the
    // banner; a second declaration anywhere means the extraction leaked.
    // Anchored on the full recipe (amber, 12pt, uppercase, 1.2 tracking) rather
    // than any two of its lines: `app/listing/[id].tsx` renders a legitimately
    // different 11pt amber kicker inside its sold-banner, and a looser regex
    // would flag it forever.
    const offenders = UI_FILES.filter(
      (f) =>
        f !== COMPONENT &&
        /color: AMBER_LIGHT,\s*\n\s*fontSize: 12,\s*\n\s*textTransform: "uppercase",\s*\n\s*letterSpacing: 1\.2,/.test(
          read(f),
        ),
    );
    assert.deepEqual(offenders, [], "these files re-declare the hero eyebrow — render <HeroBanner> instead");
  });

  it("the five secondary screens ask for the solid tone", () => {
    for (const file of SOLID_CONSUMERS) {
      assert.match(read(file), /<HeroBanner\s*\n\s*tone="solid"/, file);
    }
  });

  it("no gradient consumer passes a tone, so the default stays exercised", () => {
    // Scoped to the <HeroBanner> element: `app/index.tsx` also renders
    // <DashboardBanner tone="amber">, which is a different component's tone.
    for (const file of GRADIENT_CONSUMERS) {
      const element = read(file).match(/<HeroBanner[\s\S]*?>/)?.[0] ?? "";
      assert.ok(element.length > 0, `${file} renders no <HeroBanner>`);
      assert.doesNotMatch(element, /tone=/, file);
    }
  });

  it("no screen still fills a container with HERO_DARK behind an eyebrow", () => {
    // The tell that a sixth solid banner was hand-rolled rather than asking
    // for tone="solid".
    const offenders = UI_FILES.filter(
      (f) => f !== COMPONENT && /backgroundColor: HERO_DARK,[\s\S]{0,160}borderRadius: RADIUS_HERO_LG/.test(read(f)),
    );
    assert.deepEqual(offenders, [], "these files re-declare the solid hero — pass tone=\"solid\" instead");
  });

  it("the home screen passes its account row as headerSlot, not as children", () => {
    // Ordering regression guard: as `children` the row would land under the
    // headline and actions, which is a silent layout change.
    const src = read("app/index.tsx");
    assert.match(src, /headerSlot=\{\s*\n\s*<View style=\{styles\.profileRow\}>/);
  });

  it("settings renders the banner with no subtitle and no slots", () => {
    assert.match(
      read("app/settings.tsx"),
      /<HeroBanner eyebrow=\{t\("settings"\)\} title=\{t\("settingsTitle"\)\} \/>/,
    );
  });
});
