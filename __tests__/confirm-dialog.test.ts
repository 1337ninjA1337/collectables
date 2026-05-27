import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

/**
 * `lib/confirm-dialog.ts` can't be imported under `node:test` because it
 * pulls in `react-native`'s `Alert`/`Platform`. Same pattern as the other
 * react-native-touching helpers in this suite: structurally pin the source
 * so a future refactor that drops the web fallback or the native Alert
 * branch is caught at CI without spinning up the RN bundler.
 */

describe("confirmDialog helper", () => {
  it("exports a confirmDialog function with the documented options shape", () => {
    const src = read("lib/confirm-dialog.ts");
    assert.match(src, /export\s+type\s+ConfirmOptions\s*=/);
    assert.match(src, /title:\s*string/);
    assert.match(src, /body:\s*string/);
    assert.match(src, /confirmLabel:\s*string/);
    assert.match(src, /cancelLabel:\s*string/);
    assert.match(src, /destructive\?:\s*boolean/);
    assert.match(
      src,
      /export\s+function\s+confirmDialog\(options:\s*ConfirmOptions\):\s*Promise<boolean>/,
    );
  });

  it("forks on Platform.OS === 'web' between window.confirm and Alert.alert", () => {
    const src = read("lib/confirm-dialog.ts");
    assert.match(src, /Platform\.OS\s*===\s*"web"/);
    assert.match(src, /window\.confirm/);
    assert.match(src, /Alert\.alert\(/);
  });

  it("resolves to a boolean on both branches", () => {
    const src = read("lib/confirm-dialog.ts");
    // Web branch: synchronous resolve.
    assert.match(src, /Promise\.resolve\(ok\)/);
    // Native branch: Alert callbacks resolve to false (cancel) / true (confirm).
    assert.match(src, /onPress:\s*\(\)\s*=>\s*resolve\(false\)/);
    assert.match(src, /onPress:\s*\(\)\s*=>\s*resolve\(true\)/);
  });

  it("falls back to true when window.confirm is unavailable (SSR / sandboxed RN-web)", () => {
    const src = read("lib/confirm-dialog.ts");
    // The SSR-safe guard is the same shape as in the original screen.
    assert.match(
      src,
      /typeof\s+window\s*!==\s*"undefined"\s*&&\s*typeof\s+window\.confirm\s*===\s*"function"/,
    );
  });

  it("uses 'destructive' button style only when ConfirmOptions.destructive is true", () => {
    const src = read("lib/confirm-dialog.ts");
    assert.match(src, /style:\s*destructive\s*\?\s*"destructive"\s*:\s*"default"/);
  });
});

describe("listing detail uses confirmDialog instead of inline web fork", () => {
  it("imports confirmDialog and awaits its result before calling performClaim", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /import\s+\{\s*confirmDialog\s*\}\s+from\s+"@\/lib\/confirm-dialog"/);
    assert.match(src, /const\s+ok\s*=\s*await\s+confirmDialog\(/);
    assert.match(src, /if\s*\(ok\)\s*void\s+performClaim\(\)/);
  });

  it("no longer references Alert directly on the listing detail screen", () => {
    const src = read("app/listing/[id].tsx");
    // The Alert import is gone; only window.confirm / Alert.alert references
    // would be inside the now-deleted handleClaimPress branches.
    assert.doesNotMatch(src, /\bAlert\.alert\(/);
    assert.doesNotMatch(src, /window\.confirm/);
    assert.doesNotMatch(
      src,
      /import\s*\{[^}]*\bAlert\b[^}]*\}\s+from\s+"react-native"/,
      "react-native Alert import must be removed once handleClaimPress routes through confirmDialog",
    );
  });
});
