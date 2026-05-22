import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("EXPO_PUBLIC_PROFILE_CACHE_TTL_MS is discoverable in operator docs", () => {
  it("README-DEPLOY.md lists the variable in its secrets table", () => {
    const src = read("README-DEPLOY.md");
    assert.match(src, /`EXPO_PUBLIC_PROFILE_CACHE_TTL_MS`/);
    // The row should mention the default + the 30s soft floor so an operator
    // can decide a value without spelunking the source.
    assert.match(src, /600000/);
    assert.match(src, /30000|30 s/);
  });

  it("README-DEPLOY.md points the reader at the tracked .env.example", () => {
    const src = read("README-DEPLOY.md");
    assert.match(src, /\.env\.example/);
  });

  it(".env.example exists at the repo root and includes the variable", () => {
    const src = read(".env.example");
    assert.match(src, /EXPO_PUBLIC_PROFILE_CACHE_TTL_MS=/);
  });

  it(".env.example documents the 10-minute default + 30-second soft floor", () => {
    const src = read(".env.example");
    assert.match(src, /600000|10 minutes?/i);
    assert.match(src, /30000|30 seconds?/i);
  });

  it(".env.example does NOT carry real secret values (placeholders only)", () => {
    const src = read(".env.example");
    // Real Supabase URLs end in `.supabase.co` and real publishable keys start
    // with `eyJ`. The example file must use placeholders so a copy-paste mistake
    // never leaks credentials into git.
    assert.doesNotMatch(src, /\.supabase\.co/);
    assert.doesNotMatch(src, /\bey[A-Za-z0-9_-]{20,}\b/);
  });

  it(".env.example covers every EXPO_PUBLIC_* row documented in README-DEPLOY.md", () => {
    const readme = read("README-DEPLOY.md");
    const example = read(".env.example");
    const readmeVars = Array.from(readme.matchAll(/`(EXPO_PUBLIC_[A-Z0-9_]+)`/g)).map((m) => m[1]);
    const uniqueVars = Array.from(new Set(readmeVars));
    assert.ok(uniqueVars.length > 0, "expected README-DEPLOY.md to list EXPO_PUBLIC_* variables");
    for (const name of uniqueVars) {
      assert.match(
        example,
        new RegExp(`^${name}=`, "m"),
        `expected ${name} to be present in .env.example (mirrors README-DEPLOY.md)`,
      );
    }
  });

  it(".env.example is no longer gitignored (so the placeholders ship in the repo)", () => {
    const gitignore = read(".gitignore");
    // A bare `.env.example` rule would silence the tracked file; we must
    // un-ignore it so the example lives in git alongside README-DEPLOY.md.
    assert.doesNotMatch(gitignore, /^\.env\.example\s*$/m);
    // The plain `.env` rule must remain so real secrets never get committed.
    assert.match(gitignore, /^\.env\s*$/m);
  });
});
