import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  relationshipActions,
  SURFACE_RELATIONSHIPS,
  type ProfileSurface,
} from "@/lib/relationship-actions";
import { stripComments } from "@/lib/strip-comments";
import type { ProfileRelationship } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";

/**
 * `<RelationshipActionRow>` — the presentation half of the relationship table.
 *
 * `lib/relationship-actions.ts` made the DECISION single and left the RENDER
 * in three files: `app/people.tsx`, `app/profile/[id].tsx` and `app/friends.tsx`
 * each declared `primaryAction`, `secondaryAction` and their label styles with
 * the same values, then wrote the same map-and-render block underneath. One
 * layer down from the duplication the table removed.
 *
 * These are structural assertions over source TEXT, like every other component
 * suite here: `tsx --test` has no DOM and importing the component would pull
 * react-native. What that CANNOT see is the pixel, which is exactly how the
 * font drift below survived — so the cases that matter most are the ones
 * pinning that the three screens no longer own any of this.
 */

const COMPONENT = "components/relationship-action-row.tsx";
const SCREENS = ["app/people.tsx", "app/profile/[id].tsx", "app/friends.tsx"] as const;

function read(rel: string): string {
  return readRepoFile(rel);
}

/**
 * Code only. Two of the cases below say "this word must not appear in the
 * component", and both of the words — `ACTION_METHOD` and "admin" — appear in
 * its doc comment, which EXPLAINS why they are elsewhere. A rule that fires on
 * prose about itself is a rule that gets exempted rather than fixed; the
 * quotation-mark guard learnt the same lesson on the i18n file.
 */
function readCode(rel: string): string {
  return stripComments(read(rel));
}

describe("components/relationship-action-row.tsx — shape", () => {
  const src = read(COMPONENT);

  it("exports a named-form memo component", () => {
    // Named form rather than `memo((props) => …)`: an anonymous memo shows as
    // "Memo" in a stack trace and in the React devtools tree.
    assert.match(
      src,
      /export\s+const\s+RelationshipActionRow\s*=\s*(?:React\.)?memo\(\s*function\s+RelationshipActionRow\b/,
    );
    assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/);
  });

  it("asks the table rather than restating it", () => {
    assert.match(src, /relationshipActions\(relationship,\s*surface\)/);
    // A `kind`/`labelKey` read is the table's vocabulary; a relationship
    // comparison would be the ternary chain growing back inside the component.
    assert.doesNotMatch(src, /relationship === "/);
  });

  it("hands the caller an intent, not a context method", () => {
    // `ACTION_METHOD` resolution stays on the screens: which profile id an
    // intent runs against is theirs, and the people list's dispatcher throws
    // on `chat` where the profile screen navigates.
    assert.match(src, /onAction\(action\.id\)/);
    assert.doesNotMatch(readCode(COMPONENT), /ACTION_METHOD/);
    assert.doesNotMatch(readCode(COMPONENT), /useSocial/);
  });

  it("renders badges as text and everything else as a button", () => {
    assert.match(src, /action\.kind === "badge"/);
    assert.match(src, /accessibilityRole="button"/);
  });

  it("localizes through t() and never takes a rendered label", () => {
    assert.match(src, /useI18n\(\)/);
    assert.match(src, /t\(action\.labelKey\)/);
  });
});

describe("components/relationship-action-row.tsx — the styles that moved", () => {
  const src = read(COMPONENT);

  it("owns all six style names, once", () => {
    for (const name of [
      "actions",
      "primaryAction",
      "primaryActionText",
      "secondaryAction",
      "secondaryActionText",
      "statusBadge",
      "statusBadgeText",
    ]) {
      const declarations = src.match(new RegExp(`^\\s{2}${name}:\\s*\\{`, "gm")) ?? [];
      assert.equal(declarations.length, 1, `${name} should be declared exactly once`);
    }
  });

  it("names every colour and radius through a token", () => {
    for (const token of [
      "AMBER_SOFT",
      "BORDER_2",
      "CARD_BG_3",
      "HERO_DARK",
      "HERO_DARK_2",
      "MUTED_8",
      "RADIUS_PILL",
      "SPACING_LIST",
      "TEXT_ON_DARK_4",
    ]) {
      assert.match(src, new RegExp(`\\b${token}\\b`), `missing ${token}`);
    }
    const hexLiterals = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
    assert.deepEqual(hexLiterals, [], `unexpected inline hex literals: ${hexLiterals.join(", ")}`);
  });

  it("gives all three label styles the named font, which is the drift that was fixed", () => {
    // The two copies had already parted: `app/people.tsx` set
    // `fontFamily: FONT_BODY_EXTRABOLD` on all three, `app/profile/[id].tsx`
    // set none — so the same button rendered in DM Sans on the list and in the
    // platform's default face on the detail screen. Both files typechecked and
    // both passed every guard; one property present in one file is not
    // something anything here can see. Asserting the count is what stops the
    // merged style losing it again to a "the weight already says bold" edit.
    const labelStyles = src.match(/fontWeight: "800",\n\s*fontFamily: FONT_BODY_EXTRABOLD,/g) ?? [];
    assert.equal(labelStyles.length, 3, "primary, secondary and badge labels each need the font");
  });
});

describe("all three profile surfaces render through the row", () => {
  it("no screen declares the styles any more", () => {
    for (const rel of SCREENS) {
      const src = read(rel);
      for (const name of ["primaryAction", "secondaryAction", "statusBadge"]) {
        assert.doesNotMatch(
          src,
          new RegExp(`^\\s{2}${name}:\\s*\\{`, "m"),
          `${rel} still declares ${name} — the presentation belongs to ${COMPONENT}`,
        );
      }
    }
  });

  it("no screen maps the action list itself", () => {
    for (const rel of SCREENS) {
      const src = read(rel);
      assert.doesNotMatch(src, /action\.labelKey/, `${rel} still renders actions by hand`);
      assert.doesNotMatch(src, /action\.kind/, `${rel} still branches on an action kind`);
    }
  });

  it("each screen names its own surface", () => {
    assert.match(read("app/people.tsx"), /surface="row"/);
    assert.match(read("app/profile/[id].tsx"), /surface="detail"/);
    assert.match(read("app/friends.tsx"), /surface="tab"/);
  });

  it("the admin button goes through children rather than into the table", () => {
    // Deleting a profile is an admin capability, not a relationship action —
    // it shares this row's layout and nothing else. `children` is what keeps
    // it out of `lib/relationship-actions.ts`, where the people list would
    // then have to decide what to do with an intent it cannot service.
    const src = read("app/profile/[id].tsx");
    const site = src.match(/<RelationshipActionRow[\s\S]*?<\/RelationshipActionRow>/);
    assert.ok(site, "<RelationshipActionRow> call site not found");
    assert.match(site[0], /adminDeleteProfile/);
    assert.doesNotMatch(readCode(COMPONENT), /admin/i);
  });
});

describe("the row shows what the table says, for every relationship", () => {
  const RELATIONSHIPS: readonly ProfileRelationship[] = [
    "self",
    "friend",
    "following",
    "request_sent",
    "request_received",
    "none",
  ];
  const SURFACES: readonly ProfileSurface[] = ["detail", "row", "tab"];

  it("never renders an empty row for a relationship its surface actually shows", () => {
    // An empty `<View style={styles.actions}>` is invisible in a screenshot
    // and takes up a gap, so nothing here would catch one. The set of
    // relationships a surface actually shows is `SURFACE_RELATIONSHIPS` — not
    // "everything except self", which stopped being true when the friends tab
    // arrived and brought two relationships it has no list for.
    for (const surface of SURFACES) {
      assert.deepEqual(relationshipActions("self", surface), []);
      for (const relationship of SURFACE_RELATIONSHIPS[surface]) {
        assert.ok(
          relationshipActions(relationship, surface).length > 0,
          `${relationship} on ${surface} would render an empty row`,
        );
      }
    }
  });

  it("never asks the component for a kind it cannot draw", () => {
    // The component branches on `badge` and treats everything else as a
    // button, so a fourth kind would render as a `secondary` press target
    // silently. This is the case that fails instead.
    const drawable = new Set(["primary", "secondary", "badge"]);
    for (const relationship of RELATIONSHIPS) {
      for (const surface of SURFACES) {
        for (const action of relationshipActions(relationship, surface)) {
          assert.ok(drawable.has(action.kind), `${action.kind} has no branch in ${COMPONENT}`);
        }
      }
    }
  });
});
