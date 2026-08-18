import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  findBandOverlaps,
  findLuminanceBreak,
  isRedDominant,
  luminance,
  luminanceBand,
  rankByLuminance,
  type ColorEntry,
} from "@/lib/color-luminance";
import { designTokens } from "@/lib/design-tokens";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * The `DANGER_*` family — 17 red shades whose suffixes carry a promise.
 *
 * The backlog entry that filed this asked for strict luminance monotonicity by
 * suffix: `DANGER` > `DANGER_DEEP` > `_2` > `_3` … That is not what the palette
 * says, and asserting it would fail on values that are all correct. `_3`
 * (`#a5402d`, an orange-leaning deep) is lighter than `_2`; `_7` (`#c94a2a`,
 * the toast accent) is lighter than the unsuffixed base. The numbers are
 * arrival order — an ID, not a rank — because each landed with the screen that
 * needed it, and renaming 17 tokens to make the digits sort would be a large
 * mechanical diff that buys a convention nobody reads a colour from anyway.
 *
 * What the names DO promise, and what these tests pin instead:
 *
 *   1. the `_SOFT` and `_DEEP` BANDS do not overlap, with a wide margin;
 *   2. the unsuffixed `DANGER` / `_MEDIUM` / `_DEEP` trio darkens in that
 *      order, which is the one place the words claim a ranking;
 *   3. every member is actually red;
 *   4. the full light → dark ranking is pinned, so any insert or edit has to
 *      be looked at rather than appended.
 *
 * (1) is what catches the regression the backlog entry cared about — a
 * `DANGER_DEEP_9 = "#ff8888"` lands 64 luma units above the deep band's
 * ceiling and fails immediately, with a message naming the token.
 *
 * The helpers all come from `lib/color-luminance.ts`, so the same shape extends
 * to `MUTED_*` / `HERO_DARK_*` / `CARD_BG_*` — see the cross-family block at
 * the bottom, which pins the three-band ladder those families form.
 */

const HEX = /^#[0-9a-f]{6}$/;

/** Every string token whose name starts with `prefix`, in declaration order. */
function family(prefix: string): ColorEntry[] {
  return (Object.entries(designTokens) as [string, unknown][])
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[0].startsWith(prefix),
    )
    .map(([name, value]) => ({ name, value }));
}

const DANGER_FAMILY = family("DANGER");
const SOFT = DANGER_FAMILY.filter((entry) => entry.name.includes("_SOFT"));
const DEEP = DANGER_FAMILY.filter((entry) => entry.name.includes("_DEEP"));
const BASE = DANGER_FAMILY.filter(
  (entry) => !entry.name.includes("_SOFT") && !entry.name.includes("_DEEP"),
);

describe("DANGER_* family shape", () => {
  it("has grown to the 17 shades this suite was written against", () => {
    // A bare count, so adding an 18th shade lands here first and the author has
    // to place it in the ranking below rather than discovering it drifted.
    assert.equal(DANGER_FAMILY.length, 17);
    assert.equal(SOFT.length, 7);
    assert.equal(DEEP.length, 8);
    assert.deepEqual(
      BASE.map((entry) => entry.name),
      ["DANGER", "DANGER_MEDIUM"],
    );
  });

  it("declares every member as a 6-digit lowercase hex", () => {
    for (const { name, value } of DANGER_FAMILY) {
      assert.match(value, HEX, `${name} (${value}) is not a 6-digit lowercase hex`);
    }
  });

  it("carries no duplicate values inside the family", () => {
    // Two names for one red means the next contributor picks by coin flip.
    const seen = new Map<string, string>();
    for (const { name, value } of DANGER_FAMILY) {
      const previous = seen.get(value);
      assert.equal(previous, undefined, `${name} duplicates ${previous} (${value})`);
      seen.set(value, name);
    }
  });
});

describe("DANGER_* is actually red", () => {
  it("keeps red the dominant channel on every shade", () => {
    // The family exists to signal destruction. A shade that drifted neutral or
    // brown would still compile, still pass every ordering check here, and
    // silently stop reading as a warning.
    for (const { name, value } of DANGER_FAMILY) {
      assert.ok(isRedDominant(value), `${name} (${value}) is not red-dominant`);
    }
  });

  it("keeps the deepest shade red rather than letting it fall into HERO_DARK", () => {
    // DANGER_DEEP_8 (#3d1a11) is the darkest member and sits in the same luma
    // range as the hero browns; what separates them is the red channel.
    const darkest = luminanceBand(DANGER_FAMILY)?.darkest;
    assert.equal(darkest?.name, "DANGER_DEEP_8");
    assert.ok(isRedDominant(darkest.value));
  });
});

describe("DANGER_* band separation", () => {
  it("keeps every _SOFT lighter than every _DEEP, with room to spare", () => {
    // THE regression guard. Suffix numbering cannot be made monotonic (see the
    // header), but the soft/deep split is a real, wide gap: the darkest soft is
    // DANGER_SOFT_4 at ~168 luma, the lightest deep is DANGER_DEEP_7 at ~108.
    // A 50-unit floor accepts today's 60-unit gap and rejects a new shade that
    // lands in the no-man's-land between the bands.
    const overlaps = findBandOverlaps(SOFT, DEEP, 50);
    assert.deepEqual(
      overlaps.map(({ lighter, darker, gap }) => `${lighter.name} is only ${gap.toFixed(1)} above ${darker.name}`),
      [],
    );
  });

  it("would reject a _DEEP shade lighter than the soft band", () => {
    // The exact insert the backlog entry named. Proving the guard fires beats
    // trusting that it would.
    const overlaps = findBandOverlaps(SOFT, [...DEEP, { name: "DANGER_DEEP_9", value: "#ff8888" }], 50);
    assert.ok(
      overlaps.some(({ darker }) => darker.name === "DANGER_DEEP_9"),
      "a #ff8888 DANGER_DEEP_9 must break the band separation",
    );
  });

  it("would reject a _SOFT shade darker than the deep band", () => {
    const overlaps = findBandOverlaps([...SOFT, { name: "DANGER_SOFT_8", value: "#4a1010" }], DEEP, 50);
    assert.ok(overlaps.some(({ lighter }) => lighter.name === "DANGER_SOFT_8"));
  });

  it("puts the unsuffixed base below the soft band, where a signal colour belongs", () => {
    // DANGER is the loud one — it must not read as one of the pale surfaces.
    const softFloor = luminanceBand(SOFT)?.darkest.luma ?? 0;
    assert.ok(
      luminance(designTokens.DANGER) < softFloor,
      "DANGER should be darker than every DANGER_SOFT_*",
    );
  });
});

describe("DANGER / _MEDIUM / _DEEP is the one ladder the names claim", () => {
  it("darkens base → medium → deep", () => {
    // Unlike the numbered variants, these three words ARE a ranking, and the
    // values honour it (~98 → ~90 → ~85). This is the assertion the backlog
    // entry was reaching for; it just does not survive contact with `_2`…`_8`.
    const ladder = [
      { name: "DANGER", value: designTokens.DANGER },
      { name: "DANGER_MEDIUM", value: designTokens.DANGER_MEDIUM },
      { name: "DANGER_DEEP", value: designTokens.DANGER_DEEP },
    ];
    const broken = findLuminanceBreak(ladder);
    assert.equal(
      broken && `${broken.lighter.name} is not lighter than ${broken.darker.name}`,
      null,
    );
  });
});

describe("DANGER_* ranking is pinned", () => {
  it("orders lightest → darkest exactly as reviewed", () => {
    // The snapshot that makes an edit visible. Changing any red — or adding
    // one — moves a name in this list, so it cannot land without a reviewer
    // agreeing where in the family it sits.
    assert.deepEqual(
      rankByLuminance(DANGER_FAMILY).map((entry) => entry.name),
      [
        "DANGER_SOFT_5",
        "DANGER_SOFT_6",
        "DANGER_SOFT_7",
        "DANGER_SOFT",
        "DANGER_SOFT_3",
        "DANGER_SOFT_2",
        "DANGER_SOFT_4",
        "DANGER_DEEP_7",
        "DANGER",
        "DANGER_DEEP_3",
        "DANGER_MEDIUM",
        "DANGER_DEEP",
        "DANGER_DEEP_2",
        "DANGER_DEEP_4",
        "DANGER_DEEP_6",
        "DANGER_DEEP_5",
        "DANGER_DEEP_8",
      ],
    );
  });

  it("documents in the palette header that DANGER_* suffixes are IDs, not ranks", () => {
    // Without this note the next contributor reads `_2` … `_8` as a ramp and
    // picks the wrong shade — or "fixes" the ordering and breaks 17 call sites.
    assert.match(read("lib/design-tokens.ts"), /suffix.*(is|are) (an? )?ID/i);
  });
});

describe("the helper extends to the other numbered families", () => {
  // The backlog entry's closing line: "same shape would extend to MUTED_*,
  // HERO_DARK_*, CARD_BG_* once we ship the helper." Those families are no more
  // internally monotonic than DANGER_* is, but together they form a ladder —
  // hero surfaces, then secondary text, then card surfaces — and THAT holds.
  const HERO = family("HERO_DARK");
  const MUTED = family("MUTED");
  const CARD = family("CARD_BG");

  it("keeps every MUTED_* darker than every CARD_BG_*", () => {
    // A muted label that drifted lighter than a card surface is invisible text.
    assert.deepEqual(findBandOverlaps(CARD, MUTED, 20), []);
  });

  it("keeps every HERO_DARK_* darker than every MUTED_*", () => {
    // Hero surfaces carry cream text; one drifting up into the muted range
    // would fail that contrast without any single token looking wrong.
    assert.deepEqual(findBandOverlaps(MUTED, HERO, 20), []);
  });

  it("covers all three families, so the ladder is not vacuously true", () => {
    assert.ok(HERO.length >= 9 && MUTED.length >= 29 && CARD.length >= 15);
  });
});
