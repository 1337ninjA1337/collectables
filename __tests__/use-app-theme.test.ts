import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const src = readFileSync(path.join(REPO_ROOT, "components/use-app-theme.ts"), "utf8");

describe("useAppTheme", () => {
  it("imports useColorScheme from react-native", () => {
    assert.match(src, /from\s+"react-native"/);
    assert.match(src, /useColorScheme/);
  });

  it("does NOT import any context — pure hook only", () => {
    assert.doesNotMatch(src, /from\s+"@\/lib\/.*-context/);
  });

  it("uses only design-token imports for colors (no inline hex)", () => {
    // Same regex as lib/check-inline-hex.ts — file must be free of hex literals.
    assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/);
  });

  it("exports both LIGHT and DARK paths", () => {
    assert.match(src, /isDark:\s*false/);
    assert.match(src, /isDark:\s*true/);
  });
});
