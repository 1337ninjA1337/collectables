import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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

const COMPONENT = "components/danger-section.tsx";
const UI_FILES = ["app", "components"].flatMap(walk);

describe("<DangerSection> owns both destructive tones", () => {
  const src = read(COMPONENT);

  it("exports the component and its tone union", () => {
    assert.match(src, /export const DangerSection = memo\(function DangerSection\(/);
    assert.match(src, /export type DangerTone = "soft" \| "hard";/);
    // Defaulting to the reversible tone means a call site that forgets the prop
    // gets the safe treatment, not a filled red delete button.
    assert.match(src, /tone = "soft"/);
  });

  it("keeps the soft pill's three tokens on the slots settings used", () => {
    assert.match(src, /softButton: \{[\s\S]*?borderColor: DANGER_SOFT_2,/);
    assert.match(src, /softButton: \{[\s\S]*?backgroundColor: CARD_BG_10,/);
    assert.match(src, /softButtonText: \{\s*color: DANGER_DEEP_4,/);
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
      "CARD_BG_10",
      "CARD_BG_11",
      "DANGER_DEEP_2",
      "DANGER_DEEP_4",
      "DANGER_DEEP_5",
      "DANGER_MEDIUM",
      "DANGER_SOFT_2",
      "DANGER_SOFT_3",
      "TEXT_ON_DARK_4",
    ]) {
      assert.match(src, new RegExp(`^\\s+${name},$`, "m"), `${name} is not imported`);
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
