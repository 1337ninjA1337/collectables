import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CARD_BG_10,
  CARD_BG_11,
  DANGER_DEEP_2,
  DANGER_DEEP_4,
  DANGER_DEEP_5,
  DANGER_MEDIUM,
  DANGER_SOFT_2,
  DANGER_SOFT_3,
  TEXT_ON_DARK_4,
} from "@/lib/design-tokens";
import { readRepoFile as read } from "./helpers/repo-file";
import { tsxFiles } from "./helpers/source-files";

/**
 * Structural pins for `<DangerSection>` — the destructive-action widget
 * extracted from `app/settings.tsx`, which declared both of its tones inline:
 * a "soft" sign-out pill (pale surface, red outline, red label) and a "hard"
 * delete-account zone (bordered card + heading + hint + filled red button).
 *
 * Two classes of pin live here:
 *   1. the component still renders both tones with the right token per slot,
 *      since it is now the only declaration of either;
 *   2. no screen has re-grown a private copy — the recipe is wanted by
 *      collection delete, profile delete and premium cancel, and each of those
 *      re-deriving it by hand is how the seven tokens drift apart.
 *
 * The provider pulls react-native and cannot be mounted under `tsx --test`, so
 * the assertions are source-level.
 */

const COMPONENT = "components/danger-section.tsx";
const UI_FILES = tsxFiles("app", "components");

describe("<DangerSection> owns both destructive tones", () => {
  const src = read(COMPONENT);

  it("exports the component and its tone union", () => {
    assert.match(src, /export const DangerSection = memo\(function DangerSection\(/);
    assert.match(src, /export type DangerTone = "soft" \| "hard";/);
    // Defaulting to the reversible tone means a call site that forgets the prop
    // gets the safe treatment, not a filled red delete button.
    assert.match(src, /tone = "soft"/);
  });

  it("takes the soft pill's surface and foreground from the shared recipe", () => {
    // The three tokens moved to <SoftDestructiveChip>, which owns the same
    // treatment at chip size; spreading the shared constant is what keeps the
    // two from drifting when one gets a design tweak. Their VALUES are pinned
    // in soft-destructive-chip.test.ts — pinning them here too would just be
    // two places to update.
    assert.match(src, /softButton: \{[\s\S]*?\.\.\.SOFT_DESTRUCTIVE_SURFACE,/);
    assert.match(src, /softButtonText: \{\s*color: SOFT_DESTRUCTIVE_FOREGROUND,/);
    assert.match(
      src,
      /import \{[\s\S]*?SOFT_DESTRUCTIVE_SURFACE[\s\S]*?\} from "@\/lib\/danger-surface";/,
    );
  });

  it("separates the shape seam from the tone, so colour and geometry cannot drift together", () => {
    // The split that let the last holdout in: tone entries carry colour and
    // alignment, shape entries carry radius and padding, and every button
    // spreads one of each. A shape that restated the colours would be a third
    // home for the trio `lib/danger-surface.ts` exists to keep in one place.
    assert.match(src, /export type DangerShape = "pill" \| "block";/);
    assert.match(src, /shape = "pill"/, "a call site that forgets the prop should get the capsule");
    assert.match(src, /\.\.\.\(shape === "block" \? styles\.block : styles\.pill\),/);
    assert.match(src, /pill: \{\s*borderRadius: RADIUS_PILL,/);
    assert.match(src, /block: \{\s*borderRadius: RADIUS_CARD,/);
    for (const entry of ["pill", "block"]) {
      const body = new RegExp(`${entry}: \\{([\\s\\S]*?)\\},`).exec(src)?.[1] ?? "";
      assert.ok(body.length > 0, `no ${entry} style entry to check`);
      assert.doesNotMatch(
        body,
        /color|SURFACE|border(?!Radius)/,
        `styles.${entry} carries a colour — geometry only, or the two tones grow a shape-shaped copy each`,
      );
    }
  });

  it("keeps the hard button filled with DANGER_DEEP_2 and cream-on-red text", () => {
    assert.match(src, /hardButton: \{[\s\S]*?backgroundColor: DANGER_DEEP_2,/);
    assert.match(src, /hardButtonText: \{\s*color: TEXT_ON_DARK_4,/);
    // The hard button hugs its content inside the zone card; the soft one
    // stretches and centres its label. That asymmetry came from settings and is
    // easy to "tidy up" into a regression.
    assert.match(src, /hardButton: \{\s*alignSelf: "flex-start",/);
    assert.match(src, /softButton: \{[\s\S]*?alignItems: "center",/);
  });

  it("keeps the danger-zone card's surface, border, title and hint tokens", () => {
    assert.match(src, /zone: \{[\s\S]*?backgroundColor: CARD_BG_11,/);
    assert.match(src, /zone: \{[\s\S]*?borderColor: DANGER_SOFT_3,/);
    assert.match(src, /zoneTitle: \{[\s\S]*?color: DANGER_DEEP_5,/);
    assert.match(src, /zoneHint: \{\s*color: DANGER_MEDIUM,/);
  });

  it("renders the button bare when there is no title and no hint", () => {
    // Settings' sign-out pill sits directly in the page flow. Wrapping it in an
    // empty zone card would draw a red box around a routine action.
    assert.match(src, /if \(!title && !hint\) return button;/);
  });

  it("applies one shared disabled treatment and blocks the press", () => {
    assert.match(src, /disabled: \{\s*opacity: 0\.6,\s*\},/);
    assert.match(src, /disabled=\{disabled\}/);
    assert.match(src, /accessibilityState=\{\{ disabled \}\}/);
  });

  it("carries no inline hex literal", () => {
    assert.ok(
      !/(["'`])#[0-9a-fA-F]{3,8}\1/.test(src),
      "route every colour through lib/design-tokens.ts",
    );
  });

  it("imports every token it references", () => {
    for (const name of [
      // CARD_BG_10 / DANGER_DEEP_4 / DANGER_SOFT_2 left with the shared soft
      // recipe in <SoftDestructiveChip>; what remains is the hard tone and the
      // zone card, which this component still owns outright.
      "CARD_BG_11",
      "DANGER_DEEP_2",
      "DANGER_DEEP_5",
      "DANGER_MEDIUM",
      "DANGER_SOFT_3",
      // Both radii, since the shape seam landed: a `block` entry that lost its
      // import would fall back to square corners, which no design asked for.
      "RADIUS_CARD",
      "RADIUS_PILL",
      "TEXT_ON_DARK_4",
    ]) {
      assert.match(src, new RegExp(`^\\s+${name},$`, "m"), `${name} is not imported`);
    }
  });
});

describe("app/collection/[id].tsx consumes the block shape", () => {
  const src = read("app/collection/[id].tsx");

  it("renders the widget instead of its own copy of the soft recipe", () => {
    assert.match(src, /import \{ DangerSection \} from "@\/components\/danger-section";/);
    assert.match(
      src,
      /<DangerSection\s+shape="block"\s+actionLabel=\{t\("deleteCollection"\)\}\s+onAction=\{handleDeleteCollection\}\s*\/>/,
    );
    // No `tone` prop: the default is the reversible one, and deleting a
    // collection here goes through a confirm dialog rather than a danger zone.
    assert.doesNotMatch(src, /<DangerSection[\s\S]{0,120}tone=/);
  });

  it("dropped the styles and the three tokens the widget absorbed", () => {
    for (const name of ["deleteButton", "deleteButtonText"]) {
      assert.ok(
        !src.includes(`${name}:`),
        `app/collection/[id].tsx still declares styles.${name} — dead after adopting the widget`,
      );
    }
    // The point of the whole family: these three travel together, and a screen
    // holding them by hand is one design tweak away from being a shade off.
    for (const token of ["CARD_BG_10", "DANGER_SOFT_2", "DANGER_DEEP_4"]) {
      assert.ok(!src.includes(token), `app/collection/[id].tsx still reaches for ${token}`);
    }
  });
});

describe("app/settings.tsx consumes the component", () => {
  const src = read("app/settings.tsx");

  it("renders the soft pill for sign-out and the hard zone for delete-account", () => {
    assert.match(src, /import \{ DangerSection \} from "@\/components\/danger-section";/);
    assert.match(
      src,
      /<DangerSection\s+actionLabel=\{t\("signOut"\)\}\s+onAction=\{\(\) => void signOut\(\)\}\s+disabled=\{pending\}/,
    );
    assert.match(
      src,
      /<DangerSection\s+tone="hard"\s+title=\{t\("deleteAccountSection"\)\}\s+hint=\{t\("deleteAccountHint"\)\}/,
    );
  });

  it("keeps the delete button's in-flight label and its double disable condition", () => {
    // `deleting` swaps the label AND disables alongside `pending`; losing either
    // lets a user fire a second delete while the first is in flight.
    assert.match(
      src,
      /actionLabel=\{deleting \? t\("deleteAccountDeleting"\) : t\("deleteAccount"\)\}/,
    );
    assert.match(src, /disabled=\{pending \|\| deleting\}/);
  });

  it("dropped every style entry the widget absorbed", () => {
    for (const name of [
      "signOutButton",
      "signOutButtonDisabled",
      "signOutButtonText",
      "dangerZone",
      "dangerTitle",
      "dangerText",
      "deleteButton",
      "deleteButtonDisabled",
      "deleteButtonText",
    ]) {
      assert.ok(
        !src.includes(`${name}:`),
        `app/settings.tsx still declares styles.${name} — dead after the extraction`,
      );
    }
  });
});

describe("no screen re-grows a private copy of the recipe", () => {
  const TOKENS: Record<string, string> = {
    CARD_BG_10,
    CARD_BG_11,
    DANGER_DEEP_2,
    DANGER_DEEP_4,
    DANGER_DEEP_5,
    DANGER_MEDIUM,
    DANGER_SOFT_2,
    DANGER_SOFT_3,
    TEXT_ON_DARK_4,
  };

  it("nobody inlines the hex values the widget owns", () => {
    // The named tokens may legitimately be imported elsewhere; the raw hex
    // never should be. This is the check that catches a copy-paste of the
    // stylesheet rather than of the import.
    for (const file of UI_FILES) {
      const src = read(file);
      for (const [name, value] of Object.entries(TOKENS)) {
        assert.ok(
          !src.includes(value),
          `${file} inlines ${value} — import ${name} (or use <DangerSection>)`,
        );
      }
    }
  });

  it("the zone card's surface + border pair appears only in the component", () => {
    // CARD_BG_11 + DANGER_SOFT_3 together ARE the danger-zone card. A second
    // file naming both is re-deriving it.
    const owners = UI_FILES.filter((file) => {
      const src = read(file);
      return src.includes("CARD_BG_11") && src.includes("DANGER_SOFT_3");
    });
    assert.deepEqual(owners, [COMPONENT]);
  });
});
