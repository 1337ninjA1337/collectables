import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readI18nSource } from "./helpers/i18n-source-file";
import {
  assertDeclaredInEveryLocale,
  assertMatchesInEveryLocale,
} from "./helpers/i18n-locales";

/**
 * Trading-card `<ItemCard>` + the fullscreen `<PhotoLightbox>` gallery.
 *
 * Both modules pull in react-native peers, so these are source-level structural
 * assertions (the repo's established shape for component guards — see
 * `item-card-style-prop.test.ts`). They pin the invariants that are easy to
 * break by accident:
 *
 *  - the gallery is only mounted for items that actually have a photo, and it
 *    is a SIBLING of the `<Link asChild>` block, never its child (a Modal
 *    inside the Slot-merged child would be swallowed by the link);
 *  - the art window cancels the web click before the `<a>` navigates, so
 *    tapping the art opens the gallery instead of the item screen;
 *  - the lightbox writes its index only on momentum-scroll end and measures
 *    pages off `useWindowDimensions()` (a frozen `Dimensions.get()` width would
 *    mis-page after a web resize / rotation);
 *  - every user-visible string goes through `t()`.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const cardSrc = read("components/item-card.tsx");
const lightboxSrc = read("components/photo-lightbox.tsx");
const itemDetailSrc = read("app/item/[id].tsx");
const i18nSrc = readI18nSource();

const GALLERY_KEYS = [
  "galleryOpen",
  "galleryClose",
  "galleryPrevious",
  "galleryNext",
  "galleryCounter",
] as const;

describe("<PhotoLightbox> — fullscreen gallery", () => {
  it("pages horizontally one viewport at a time", () => {
    assert.match(lightboxSrc, /<ScrollView[\s\S]*?horizontal[\s\S]*?pagingEnabled/);
  });

  it("measures pages off useWindowDimensions, not a frozen Dimensions.get()", () => {
    assert.match(lightboxSrc, /const \{ width, height \} = useWindowDimensions\(\)/);
    assert.doesNotMatch(lightboxSrc, /Dimensions\.get\(/);
  });

  it("writes the active index only on momentum end (no mid-drag flicker)", () => {
    assert.match(lightboxSrc, /onMomentumScrollEnd=\{handleMomentumEnd\}/);
    assert.doesNotMatch(lightboxSrc, /onScroll=\{/);
  });

  it("clamps the initial index into range and scrolls to it when opened", () => {
    assert.match(
      lightboxSrc,
      /const clampedInitial = Math\.min\(Math\.max\(initialIndex, 0\), Math\.max\(photos\.length - 1, 0\)\)/,
    );
    assert.match(lightboxSrc, /scrollTo\(\{ x: clampedInitial \* width, y: 0, animated: false \}\)/);
    // The effect must re-run when the gallery is (re-)opened, otherwise a
    // second open lands on whatever page the previous session left behind.
    assert.match(lightboxSrc, /\}, \[visible, clampedInitial, width\]\)/);
  });

  it("renders the counter, dots and chevrons only for multi-photo items", () => {
    assert.match(lightboxSrc, /const multi = photos\.length > 1;/);
    assert.match(lightboxSrc, /\{multi \? \(/);
    // ...and renders nothing at all with an empty photo list.
    assert.match(lightboxSrc, /if \(photos\.length === 0\) return null;/);
  });

  it("disables the chevron at each end instead of scrolling past it", () => {
    assert.match(lightboxSrc, /disabled=\{index === 0\}/);
    assert.match(lightboxSrc, /disabled=\{index === photos\.length - 1\}/);
  });

  it("closes on the hardware/browser back affordance too", () => {
    assert.match(lightboxSrc, /onRequestClose=\{onClose\}/);
  });

  it("labels every control through t() — no hard-coded copy", () => {
    for (const key of ["galleryClose", "galleryPrevious", "galleryNext", "galleryCounter"]) {
      assert.match(lightboxSrc, new RegExp(`t\\("${key}"`), `${key} must be used`);
    }
    assert.doesNotMatch(lightboxSrc, /accessibilityLabel="[^"]/);
  });
});

describe("<ItemCard> — trading-card layout", () => {
  it("keeps the name bar, art window, type band, flavour box and footer", () => {
    for (const style of ["nameBar", "artWindow", "typeBand", "flavorBox", "footerRow"]) {
      assert.match(cardSrc, new RegExp(`styles\\.${style}\\b`), `styles.${style} must be rendered`);
      assert.match(cardSrc, new RegExp(`\\n  ${style}: \\{`), `styles.${style} must be declared`);
    }
  });

  it("nests the frame inside the card so the double border reads as card stock", () => {
    assert.match(cardSrc, /<View style=\{styles\.frame\}>/);
    assert.match(cardSrc, /\n  frame: \{[\s\S]*?borderColor: AMBER_MUTED_7[\s\S]*?\}/);
  });

  it("prints a stable card number derived from the item id", () => {
    assert.match(
      cardSrc,
      /const cardNumber = item\.id\.replace\(\/\[\^a-zA-Z0-9\]\/g, ""\)\.slice\(0, 6\)\.toUpperCase\(\)/,
    );
    assert.match(cardSrc, /№ \{cardNumber\}/);
  });

  it("surfaces a photo-count badge only when the item has more than one photo", () => {
    const guards = cardSrc.match(/\{photoCount > 1 \? \(/g) ?? [];
    assert.equal(guards.length, 2, "both the compact and full art windows carry the badge");
    // Counts only non-blank URIs — a photos array padded with "" must not
    // promise a gallery the lightbox would render as blank pages.
    assert.match(cardSrc, /const photoCount = item\.photos\.filter\(Boolean\)\.length;/);
  });
});

describe("<ItemCard> — gallery wiring", () => {
  it("mounts the lightbox as a sibling of the Link, not inside it", () => {
    assert.match(cardSrc, /import \{ PhotoLightbox \} from "@\/components\/photo-lightbox";/);
    // `gallery` is rendered after </Link> in both branches.
    const siblings = cardSrc.match(/<\/Link>\s*\n\s*\{gallery\}/g) ?? [];
    assert.equal(siblings.length, 2, "compact and full branches both render {gallery} after </Link>");
  });

  it("only builds the gallery for items that actually have a photo", () => {
    assert.match(cardSrc, /const gallery = hasPhoto \? \(/);
    assert.match(cardSrc, /photos=\{item\.photos\.filter\(Boolean\)\}/);
  });

  it("cancels the web link navigation before opening the gallery", () => {
    assert.match(cardSrc, /domEvent\?\.preventDefault\?\.\(\);/);
    assert.match(cardSrc, /domEvent\?\.stopPropagation\?\.\(\);/);
    assert.match(cardSrc, /setGalleryOpen\(true\)/);
  });

  it("leaves the art window inert for photo-less items", () => {
    const disabled = cardSrc.match(/disabled=\{!hasPhoto\}/g) ?? [];
    assert.equal(disabled.length, 2, "both branches disable the art press without a photo");
    const handlers = cardSrc.match(/onPress=\{hasPhoto \? openGallery : undefined\}/g) ?? [];
    assert.equal(handlers.length, 2);
  });
});

describe("item detail — hero opens the same gallery", () => {
  it("imports the shared component instead of re-rolling a modal", () => {
    assert.match(itemDetailSrc, /import \{ PhotoLightbox \} from "@\/components\/photo-lightbox";/);
  });

  it("opens at the tapped hero photo and closes back to null", () => {
    assert.match(itemDetailSrc, /const \[galleryIndex, setGalleryIndex\] = useState<number \| null>\(null\);/);
    assert.match(itemDetailSrc, /onPress=\{\(\) => setGalleryIndex\(photoIndex\)\}/);
    assert.match(itemDetailSrc, /visible=\{galleryIndex !== null\}/);
    assert.match(itemDetailSrc, /initialIndex=\{galleryIndex \?\? 0\}/);
    assert.match(itemDetailSrc, /onClose=\{\(\) => setGalleryIndex\(null\)\}/);
  });
});

describe("gallery i18n keys", () => {
  it("is declared in every one of the six locales", () => {
    // Asked of each map. The `^  key:` count this replaces leaned on prettier's
    // two-space indent AND summed to six, so it was both formatting-dependent
    // and blind to a locale declaring one key twice while another declared none.
    for (const key of GALLERY_KEYS) assertDeclaredInEveryLocale(i18nSrc, key);
  });

  it("renders the counter from current/total params in every locale", () => {
    assertMatchesInEveryLocale(
      i18nSrc,
      /galleryCounter: \(params\?: TranslationParams\) => `\$\{params\?\.current \?\? 1\} \/ \$\{params\?\.total \?\? 1\}`/,
      "galleryCounter renders current / total",
    );
  });
});

describe("<ItemCard> — printed card geometry", () => {
  it("exports the 600x800 cap and derives the aspect ratio from it", () => {
    assert.match(cardSrc, /export const CARD_MAX_WIDTH = 600;/);
    assert.match(cardSrc, /export const CARD_MAX_HEIGHT = 800;/);
    // Derived, never hand-typed as 0.75 — a future cap change must move the
    // ratio with it or the card stops being the shape it advertises.
    assert.match(cardSrc, /export const CARD_ASPECT_RATIO = CARD_MAX_WIDTH \/ CARD_MAX_HEIGHT;/);
  });

  it("caps the card and centres it instead of stretching to the column", () => {
    const card = cardSrc.match(/\n  card: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    assert.match(card, /width: "100%"/);
    assert.match(card, /maxWidth: CARD_MAX_WIDTH/);
    assert.match(card, /maxHeight: CARD_MAX_HEIGHT/);
    assert.match(card, /aspectRatio: CARD_ASPECT_RATIO/);
    assert.match(card, /alignSelf: "center"/);
  });

  it("lets the art window absorb the leftover height so the frame stays full", () => {
    const frame = cardSrc.match(/\n  frame: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    assert.match(frame, /flex: 1/);
    const art = cardSrc.match(/\n  artWindow: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    assert.match(art, /flex: 1/);
    assert.match(cardSrc, /\n  art: \{[\s\S]*?height: "100%"[\s\S]*?\n  \},/);
  });
});

describe("app/collection/[id].tsx — grid by default, reorder on demand", () => {
  const collectionSrc = read("app/collection/[id].tsx");

  it("owners land in the virtualized card grid unless they opt into reordering", () => {
    assert.match(collectionSrc, /const \[reorderMode, setReorderMode\] = useState\(false\);/);
    assert.match(
      collectionSrc,
      /const isDragBranch = isOwner && !selectionMode && reorderMode && itemFilters\.sort === "default";/,
    );
    assert.match(
      collectionSrc,
      /const isViewerFlatListBranch =\s*\n\s*items\.length > 0 && \(!isOwner \|\| \(!selectionMode && !isDragBranch\)\);/,
    );
  });

  it("exposes the toggle in the owner actions row with a selected a11y state", () => {
    assert.match(collectionSrc, /onPress=\{\(\) => setReorderMode\(\(on\) => !on\)\}/);
    assert.match(collectionSrc, /accessibilityState=\{\{ selected: reorderMode \}\}/);
    assert.match(collectionSrc, /\{reorderMode \? t\("reorderItemsDone"\) : t\("reorderItems"\)\}/);
  });

  it("declares reorderItems/reorderItemsDone in every locale", () => {
    for (const key of ["reorderItems", "reorderItemsDone"]) {
      assertDeclaredInEveryLocale(i18nSrc, key);
    }
  });
});

describe("CSP — web photo uploads read blob:/data: URIs through fetch()", () => {
  const cspSrc = read("lib/web-security-headers.ts");

  it("allow-lists blob: and data: in connect-src, not just img-src", () => {
    const connect = cspSrc.match(/export const CSP_CONNECT_SRC[\s\S]*?\n\];/)?.[0] ?? "";
    assert.match(connect, /"blob:"/);
    assert.match(connect, /"data:"/);
  });

  it("the readers that need them still go through fetch()", () => {
    assert.match(read("lib/cloudinary.ts"), /await fetch\(uri\)/);
    assert.match(read("lib/ai-vision.ts"), /await fetch\(uri\)/);
  });
});
