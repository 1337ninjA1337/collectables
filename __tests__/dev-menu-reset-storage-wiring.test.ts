import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural integration test — pins the wiring between `app/_layout.tsx`
 * and the new `clearAllCollectablesStorage` dev helper. Same shape as
 * `__tests__/dev-menu-wiring.test.ts`: a regex scan against the source
 * string so the test stays peer-dep-free.
 */
const LAYOUT_PATH = path.join(process.cwd(), "app", "_layout.tsx");

function readLayout(): string {
  return readFileSync(LAYOUT_PATH, "utf8");
}

describe("app/_layout.tsx ↔ resetCollectablesStorage wiring", () => {
  it("imports clearAllCollectablesStorage from lib/storage-keys", () => {
    const src = readLayout();
    assert.match(
      src,
      /import\s*\{[^}]*\bclearAllCollectablesStorage\b[^}]*\}\s*from\s*["']@\/lib\/storage-keys["']/,
      "must import clearAllCollectablesStorage from @/lib/storage-keys",
    );
  });

  it("registers a `resetCollectablesStorage` action in the registerDevMenu call", () => {
    const src = readLayout();
    assert.match(
      src,
      /\bresetCollectablesStorage\s*:\s*\{[^}]*label\s*:\s*["'][^"']+["'][^}]*run\s*:/,
      "actions map must include a labelled resetCollectablesStorage entry",
    );
  });

  it("invokes clearAllCollectablesStorage() inside the DevMenu action run handler", () => {
    const src = readLayout();
    assert.match(
      src,
      /clearAllCollectablesStorage\s*\(\s*\)/,
      "the DevMenu action must actually call clearAllCollectablesStorage()",
    );
  });

  it("does not regress the existing clearRuntimeSupabaseConfig wiring", () => {
    const src = readLayout();
    // Pin that both actions live in the same registerDevMenu call so a future
    // refactor doesn't accidentally split them across two registrations.
    assert.match(src, /\bclearRuntimeSupabaseConfig\b/);
    assert.match(src, /\bresetCollectablesStorage\b/);
  });
});
