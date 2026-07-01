import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural tests over the bundled font assets. The design brief asked to keep
 * only the font weights that `app/_layout.tsx` actually loads and to remove
 * every other `.ttf` from `assets/fonts`. These tests pin that invariant so a
 * future font re-download (which drops the whole variable-weight family back
 * into the tree) fails CI instead of silently bloating the web bundle.
 */

const ROOT = process.cwd();
const FONTS_DIR = path.join(ROOT, "assets", "fonts");

const LAYOUT_SOURCE = readFileSync(
  path.join(ROOT, "app", "_layout.tsx"),
  "utf8",
);

function requiredFontPaths(): string[] {
  const matches = [
    ...LAYOUT_SOURCE.matchAll(/require\(\s*["'](\.\.\/assets\/fonts\/[^"']+\.ttf)["']\s*\)/g),
  ];
  return matches.map((m) => m[1].replace(/^\.\.\//, ""));
}

function allTtfOnDisk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...allTtfOnDisk(full));
    } else if (entry.name.endsWith(".ttf")) {
      out.push(path.relative(ROOT, full));
    }
  }
  return out;
}

describe("font assets", () => {
  it("loads exactly the six declared font weights in _layout", () => {
    const required = requiredFontPaths();
    assert.equal(required.length, 6, "expected six font require() calls");
    const expected = [
      "assets/fonts/Syne/static/Syne-Bold.ttf",
      "assets/fonts/Syne/static/Syne-ExtraBold.ttf",
      "assets/fonts/DM_Sans/static/DMSans-Regular.ttf",
      "assets/fonts/DM_Sans/static/DMSans-SemiBold.ttf",
      "assets/fonts/DM_Sans/static/DMSans-Bold.ttf",
      "assets/fonts/DM_Sans/static/DMSans-ExtraBold.ttf",
    ];
    for (const p of expected) {
      assert.ok(required.includes(p), `_layout should require ${p}`);
    }
  });

  it("keeps every required font file present on disk", () => {
    for (const rel of requiredFontPaths()) {
      assert.ok(existsSync(path.join(ROOT, rel)), `missing font asset ${rel}`);
    }
  });

  it("ships no unreferenced .ttf files (cleanup invariant)", () => {
    const required = new Set(requiredFontPaths());
    const orphans = allTtfOnDisk(FONTS_DIR).filter((f) => !required.has(f));
    assert.deepEqual(
      orphans,
      [],
      `unreferenced font files should be removed: ${orphans.join(", ")}`,
    );
  });

  it("retains the OFL license files for the bundled families", () => {
    for (const family of ["Syne", "DM_Sans"]) {
      assert.ok(
        existsSync(path.join(FONTS_DIR, family, "OFL.txt")),
        `OFL.txt must be retained for ${family}`,
      );
    }
  });

  it("keeps lib/fonts constants aligned with the loaded file basenames", () => {
    const fontsSource = readFileSync(path.join(ROOT, "lib", "fonts.ts"), "utf8");
    const basenames = requiredFontPaths().map((p) => path.basename(p, ".ttf"));
    // Every loaded weight's basename (e.g. "Syne-Bold") must appear as a
    // family-name constant so styles reference a real, bundled face.
    for (const name of basenames) {
      assert.match(
        fontsSource,
        new RegExp(`"${name}"`),
        `lib/fonts.ts should declare the "${name}" family`,
      );
    }
  });
});
