import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { installNativeModuleStubs, render, styleOf, type RenderResult } from "./helpers/render";
import {
  DESTRUCTIVE_ICON_FOREGROUND,
  DESTRUCTIVE_ICON_SURFACE,
  SOFT_DESTRUCTIVE_FOREGROUND,
  SOFT_DESTRUCTIVE_SURFACE,
} from "@/lib/danger-surface";
import { CARD_BG_8, DANGER_DEEP_3, DANGER_SOFT, RADIUS_PILL } from "@/lib/design-tokens";
import { readRepoFile as read } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

installNativeModuleStubs();

/**
 * `<DangerIconButton>` is the icon-only member of the destructive family — the
 * row-end trash button, no room for a label. It was extracted from the single
 * declaration of the recipe (`app/wishlist.tsx`'s `deleteButton`), so the two
 * things worth pinning are:
 *
 *   1. it is a REFACTOR — every rendered value is the one the wishlist row
 *      shipped with, since repainting a row is a design decision and this was
 *      not one;
 *   2. the split the family agreed on holds — colours in
 *      `lib/danger-surface.ts`, geometry in the component — and no screen has
 *      re-grown a private copy of either.
 *
 * The colour assertions are RUNTIME: the component is mounted through
 * `__tests__/helpers/render.ts` and the rendered style compared against the
 * imported constants, which is what catches a token applied to the wrong
 * element or a style array whose later entry wins. See that file for why the
 * component has to come in through a dynamic `import()`.
 */

type MountOptions = {
  icon?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
};

async function mountButton(
  options: MountOptions = {},
): Promise<{ tree: RenderResult; presses: number }> {
  const { DangerIconButton } = await import("@/components/danger-icon-button");

  const counter = { presses: 0 };
  const element = createElement(DangerIconButton, {
    onPress: () => {
      counter.presses += 1;
    },
    accessibilityLabel: options.accessibilityLabel ?? "Delete item",
    ...(options.icon ? { icon: options.icon } : {}),
    ...(options.disabled === undefined ? {} : { disabled: options.disabled }),
  } as never) as ReactElement;

  const tree = render(element);
  return {
    tree,
    get presses() {
      return counter.presses;
    },
  };
}

describe("DESTRUCTIVE_ICON_SURFACE", () => {
  it("is the CARD_BG_8 / DANGER_SOFT / DANGER_DEEP_3 trio and nothing else", () => {
    assert.deepEqual(DESTRUCTIVE_ICON_SURFACE, {
      backgroundColor: CARD_BG_8,
      borderWidth: 1,
      borderColor: DANGER_SOFT,
    });
    assert.equal(DESTRUCTIVE_ICON_FOREGROUND, DANGER_DEEP_3);
  });

  it("carries no geometry, so a second consumer at another size stays possible", () => {
    for (const key of ["paddingHorizontal", "paddingVertical", "borderRadius", "gap"]) {
      assert.ok(
        !(key in DESTRUCTIVE_ICON_SURFACE),
        `${key} belongs to the component, not the shared surface`,
      );
    }
  });

  it("is a DISTINCT surface from the soft one, on every slot", () => {
    // The two are one channel apart on all three values, which is the whole
    // reason each needs a name: an edit that "tidies" one into the other
    // repaints shipped UI, and this is the assertion that says so out loud.
    // Unifying them is a design decision, filed as a suggestion.
    assert.notEqual(DESTRUCTIVE_ICON_SURFACE.backgroundColor, SOFT_DESTRUCTIVE_SURFACE.backgroundColor);
    assert.notEqual(DESTRUCTIVE_ICON_SURFACE.borderColor, SOFT_DESTRUCTIVE_SURFACE.borderColor);
    assert.notEqual(DESTRUCTIVE_ICON_FOREGROUND, SOFT_DESTRUCTIVE_FOREGROUND);
    // …and identical where they agree, so the shape stays comparable.
    assert.equal(DESTRUCTIVE_ICON_SURFACE.borderWidth, SOFT_DESTRUCTIVE_SURFACE.borderWidth);
  });
});

describe("<DangerIconButton> renders the surface it was lifted from", () => {
  it("paints the button with CARD_BG_8 + DANGER_SOFT at borderWidth 1", async () => {
    const { tree } = await mountButton();
    const style = styleOf(tree.findByType("Pressable"));
    assert.equal(style.backgroundColor, CARD_BG_8);
    assert.equal(style.borderColor, DANGER_SOFT);
    assert.equal(style.borderWidth, 1);
  });

  it("keeps the geometry the wishlist row shipped with", async () => {
    const { tree } = await mountButton();
    const style = styleOf(tree.findByType("Pressable"));
    assert.equal(style.borderRadius, RADIUS_PILL);
    assert.equal(style.paddingHorizontal, 10);
    assert.equal(style.paddingVertical, 8);
    assert.ok(
      !("borderRadius" in DESTRUCTIVE_ICON_SURFACE),
      "geometry in the shared surface would resize any future second consumer",
    );
  });

  it("tints the icon with the foreground token — the tint is a prop, not a style", async () => {
    const { tree } = await mountButton();
    const icon = tree.findByType("Ionicons");
    assert.equal(icon.props.color, DANGER_DEEP_3);
    assert.equal(icon.props.size, 16);
  });

  it("routes both colours through lib/danger-surface, not a second copy of the trio", async () => {
    const { tree } = await mountButton();
    const style = styleOf(tree.findByType("Pressable"));
    assert.equal(style.backgroundColor, DESTRUCTIVE_ICON_SURFACE.backgroundColor);
    assert.equal(style.borderColor, DESTRUCTIVE_ICON_SURFACE.borderColor);
    assert.equal(tree.findByType("Ionicons").props.color, DESTRUCTIVE_ICON_FOREGROUND);
  });

  it("defaults the icon to the trash every current caller wanted", async () => {
    const { tree } = await mountButton();
    assert.equal(tree.findByType("Ionicons").props.name, "trash-outline");
  });

  it("renders whatever icon it is handed, so a non-delete destructive row can use it", async () => {
    const { tree } = await mountButton({ icon: "close-circle" });
    assert.equal(tree.findByType("Ionicons").props.name, "close-circle");
  });

  it("renders no text at all — that is what makes the a11y label mandatory", async () => {
    const { tree } = await mountButton();
    assert.deepEqual(tree.texts(), []);
  });
});

describe("<DangerIconButton> announces itself", () => {
  it("is a button and speaks the caller's label", async () => {
    const { tree } = await mountButton({ accessibilityLabel: "Remove from wishlist" });
    const button = tree.findByType("Pressable");
    assert.equal(button.props.accessibilityRole, "button");
    assert.equal(button.props.accessibilityLabel, "Remove from wishlist");
  });

  it("types accessibilityLabel as required, unlike the label-bearing widgets", () => {
    // An icon-only control has no text to fall back on, so the optional-with-
    // fallback shape <SoftDestructiveChip> uses would announce nothing here.
    const src = read("components/danger-icon-button.tsx");
    assert.match(src, /^ {2}accessibilityLabel: string;$/m);
    assert.doesNotMatch(src, /accessibilityLabel\?: string/);
  });
});

describe("<DangerIconButton> disabled state", () => {
  it("is enabled and pressable by default", async () => {
    const mounted = await mountButton();
    const button = mounted.tree.findByType("Pressable");
    assert.equal(button.props.disabled, false);
    assert.deepEqual(button.props.accessibilityState, { disabled: false });
    assert.equal(styleOf(button).opacity, undefined);
    mounted.tree.press(button);
    assert.equal(mounted.presses, 1);
  });

  it("dims to 0.6, blocks presses and says so to a screen reader when disabled", async () => {
    const mounted = await mountButton({ disabled: true });
    const button = mounted.tree.findByType("Pressable");
    assert.equal(styleOf(button).opacity, 0.6);
    assert.equal(button.props.disabled, true);
    assert.deepEqual(button.props.accessibilityState, { disabled: true });
  });

  it("keeps the surface underneath the dimming, rather than swapping colours", async () => {
    // The disabled treatment is opacity only — a second colour pair for the
    // greyed state is exactly the drift the shared surface exists to prevent.
    const { tree } = await mountButton({ disabled: true });
    const style = styleOf(tree.findByType("Pressable"));
    assert.equal(style.backgroundColor, CARD_BG_8);
    assert.equal(style.borderColor, DANGER_SOFT);
  });
});

describe("adoption", () => {
  it("app/wishlist.tsx renders the widget instead of its own recipe", () => {
    const src = read("app/wishlist.tsx");
    assert.match(src, /<DangerIconButton\s+onPress=\{\(\) => confirmDelete\(item\)\}/);
    assert.match(src, /accessibilityLabel=\{t\("deleteItem"\)\}/);
    assert.doesNotMatch(src, /deleteButton/, "the inline deleteButton styles should be gone");
  });

  it("is the only declaration of the trio outside lib/danger-surface.ts", () => {
    // A screen importing CARD_BG_8 + DANGER_SOFT together is a screen building
    // this button by hand, which is the drift the extraction exists to stop.
    const importers: string[] = [];
    for (const file of sourceFiles("app", "components")) {
      const source = read(file);
      const importBlock = source.match(/import \{[\s\S]*?\} from "@\/lib\/design-tokens";/)?.[0] ?? "";
      if (/\bCARD_BG_8\b/.test(importBlock) && /\bDANGER_SOFT\b/.test(importBlock)) {
        importers.push(file);
      }
    }
    assert.deepEqual(importers, []);
  });

  it("is memoized, like every other row-level widget", () => {
    assert.match(read("components/danger-icon-button.tsx"), /memo\(function DangerIconButton/);
  });
});
