import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LIGHT_LABEL_THRESHOLD,
  LUMA_MAX,
  findBandOverlaps,
  findLuminanceBreak,
  isLightHex,
  isRedDominant,
  luminance,
  luminanceBand,
  rankByLuminance,
  rgbChannels,
} from "@/lib/color-luminance";

describe("rgbChannels", () => {
  it("parses 6-digit hex with and without the leading #", () => {
    assert.deepEqual(rgbChannels("#d92f2f"), [217, 47, 47]);
    assert.deepEqual(rgbChannels("d92f2f"), [217, 47, 47]);
  });

  it("is case-insensitive", () => {
    assert.deepEqual(rgbChannels("#D92F2F"), rgbChannels("#d92f2f"));
  });

  it("expands the 3-digit shorthand so #fff ranks as #ffffff", () => {
    // The palette carries a few shorthands; treating them as unparseable would
    // make them sort last in a ranking rather than first.
    assert.deepEqual(rgbChannels("#fff"), [255, 255, 255]);
    assert.deepEqual(rgbChannels("#abc"), [170, 187, 204]);
  });

  it("returns null for anything that is not a hex colour", () => {
    for (const bad of ["", "#", "#ff", "#fffff", "#gggggg", "rgba(0,0,0,0.5)", "transparent"]) {
      assert.equal(rgbChannels(bad), null, `${bad} should not parse`);
    }
  });
});

describe("luminance", () => {
  it("puts black at 0 and white at the documented maximum", () => {
    assert.equal(luminance("#000000"), 0);
    assert.equal(luminance("#ffffff"), LUMA_MAX);
  });

  it("weights green above red above blue, per Rec. 601", () => {
    // The ordering of the three weights is the entire content of the formula —
    // a transposed pair would still return plausible-looking numbers.
    assert.ok(luminance("#00ff00") > luminance("#ff0000"));
    assert.ok(luminance("#ff0000") > luminance("#0000ff"));
  });

  it("returns NaN for a non-colour instead of coercing it to black", () => {
    // Coercing to 0 would rank an unparseable value as the darkest shade in a
    // family, which reads as a legitimate result and hides the typo.
    assert.ok(Number.isNaN(luminance("nope")));
  });
});

describe("isLightHex", () => {
  it("splits at the documented threshold", () => {
    assert.equal(isLightHex("#ffffff"), true);
    assert.equal(isLightHex("#000000"), false);
    assert.equal(LIGHT_LABEL_THRESHOLD, 160);
  });

  it("accepts a custom threshold", () => {
    assert.equal(isLightHex("#808080", 200), false);
    assert.equal(isLightHex("#808080", 100), true);
  });

  it("treats a non-colour as light so the fallback label stays readable", () => {
    assert.equal(isLightHex("transparent"), true);
  });
});

describe("isRedDominant", () => {
  it("accepts a red where red leads both other channels", () => {
    assert.equal(isRedDominant("#d92f2f"), true);
    assert.equal(isRedDominant("#3d1a11"), true);
  });

  it("rejects a cool or neutral value", () => {
    assert.equal(isRedDominant("#94a3b8"), false);
    assert.equal(isRedDominant("#808080"), false, "a perfect grey has no dominant channel");
    assert.equal(isRedDominant("nope"), false);
  });
});

describe("rankByLuminance", () => {
  const family = [
    { name: "mid", value: "#808080" },
    { name: "light", value: "#ffffff" },
    { name: "dark", value: "#000000" },
  ];

  it("sorts lightest → darkest", () => {
    assert.deepEqual(
      rankByLuminance(family).map((entry) => entry.name),
      ["light", "mid", "dark"],
    );
  });

  it("attaches the computed luma to each entry", () => {
    assert.equal(rankByLuminance(family)[0].luma, LUMA_MAX);
  });

  it("does not mutate or reorder its input", () => {
    const input = [...family];
    rankByLuminance(input);
    assert.deepEqual(
      input.map((entry) => entry.name),
      ["mid", "light", "dark"],
    );
  });

  it("sorts non-colours last rather than treating them as black", () => {
    const ranked = rankByLuminance([{ name: "bad", value: "nope" }, ...family]);
    assert.equal(ranked[ranked.length - 1].name, "bad");
  });
});

describe("luminanceBand", () => {
  it("reports the lightest and darkest members", () => {
    const band = luminanceBand([
      { name: "mid", value: "#808080" },
      { name: "light", value: "#ffffff" },
      { name: "dark", value: "#000000" },
    ]);
    assert.equal(band?.lightest.name, "light");
    assert.equal(band?.darkest.name, "dark");
  });

  it("returns null for an empty family", () => {
    assert.equal(luminanceBand([]), null);
  });

  it("ignores non-colours when picking the darkest", () => {
    const band = luminanceBand([
      { name: "bad", value: "nope" },
      { name: "dark", value: "#000000" },
    ]);
    assert.equal(band?.darkest.name, "dark");
  });
});

describe("findLuminanceBreak", () => {
  it("returns null for a list that darkens monotonically", () => {
    assert.equal(
      findLuminanceBreak([
        { name: "a", value: "#ffffff" },
        { name: "b", value: "#808080" },
        { name: "c", value: "#000000" },
      ]),
      null,
    );
  });

  it("names both sides of the first offending pair", () => {
    // This is the scenario the danger-family backlog entry described: someone
    // appends a shade that is lighter than the one before it.
    const broken = findLuminanceBreak([
      { name: "DANGER_DEEP_8", value: "#3d1a11" },
      { name: "DANGER_DEEP_9", value: "#ff8888" },
    ]);
    assert.equal(broken?.lighter.name, "DANGER_DEEP_8");
    assert.equal(broken?.darker.name, "DANGER_DEEP_9");
  });

  it("reports the FIRST break, not the last", () => {
    const broken = findLuminanceBreak([
      { name: "a", value: "#000000" },
      { name: "b", value: "#ffffff" },
      { name: "c", value: "#111111" },
      { name: "d", value: "#ffffff" },
    ]);
    assert.equal(broken?.lighter.name, "a");
  });

  it("counts an exact tie as a break", () => {
    // Two indistinguishable shades under different names is a naming bug even
    // though the ordering is not strictly violated.
    const broken = findLuminanceBreak([
      { name: "a", value: "#808080" },
      { name: "b", value: "#808080" },
    ]);
    assert.equal(broken?.darker.name, "b");
  });

  it("flags a non-colour rather than skipping past it", () => {
    const broken = findLuminanceBreak([
      { name: "a", value: "#ffffff" },
      { name: "b", value: "nope" },
    ]);
    assert.equal(broken?.darker.name, "b");
  });

  it("is vacuously satisfied by lists of fewer than two entries", () => {
    assert.equal(findLuminanceBreak([]), null);
    assert.equal(findLuminanceBreak([{ name: "a", value: "#ffffff" }]), null);
  });
});

describe("findBandOverlaps", () => {
  const soft = [{ name: "SOFT", value: "#e0bcb3" }];
  const deep = [{ name: "DEEP", value: "#a13434" }];

  it("returns an empty list when the bands are cleanly separated", () => {
    assert.deepEqual(findBandOverlaps(soft, deep), []);
  });

  it("flags a member of the light band that is darker than the dark band", () => {
    const overlaps = findBandOverlaps([{ name: "SOFT_X", value: "#500000" }], deep);
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0].lighter.name, "SOFT_X");
    assert.ok(overlaps[0].gap < 0);
  });

  it("enforces minGap so a one-unit sliver does not pass as separation", () => {
    const barely = [{ name: "SOFT_X", value: "#a23434" }];
    assert.deepEqual(findBandOverlaps(barely, deep), []);
    assert.equal(findBandOverlaps(barely, deep, 20).length, 1);
  });

  it("reports every offending pair, not just the first", () => {
    const overlaps = findBandOverlaps(
      [
        { name: "a", value: "#000000" },
        { name: "b", value: "#010101" },
      ],
      deep,
    );
    assert.equal(overlaps.length, 2);
  });

  it("flags a non-colour on either side, since NaN comparisons are never satisfied", () => {
    assert.equal(findBandOverlaps([{ name: "bad", value: "nope" }], deep).length, 1);
    assert.equal(findBandOverlaps(soft, [{ name: "bad", value: "nope" }]).length, 1);
  });
});
