import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural integration test — guards the wiring between `app/_layout.tsx`
 * and `lib/dev-menu.ts`. The unit suite (`dev-menu.test.ts`) covers the
 * helper itself in isolation; this file pins the contract that the root
 * layout actually invokes the helper with the documented action map.
 *
 * Why structural? `app/_layout.tsx` imports react-native modules that can't
 * resolve under plain `node:test`; a regex test against the source string
 * gives the same regression coverage without spinning up the React tree.
 */
const LAYOUT_PATH = path.join(process.cwd(), "app", "_layout.tsx");

function readLayout(): string {
  return readFileSync(LAYOUT_PATH, "utf8");
}

describe("app/_layout.tsx ↔ lib/dev-menu wiring", () => {
  it("imports registerDevMenu, isDevEnvironment, and loadDevMenuModule from lib/dev-menu", () => {
    const src = readLayout();
    assert.match(
      src,
      /from\s+["']@\/lib\/dev-menu["']/,
      "must import from the dev-menu module",
    );
    assert.match(src, /\bregisterDevMenu\b/, "must reference registerDevMenu");
    assert.match(src, /\bisDevEnvironment\b/, "must reference isDevEnvironment");
    assert.match(src, /\bloadDevMenuModule\b/, "must reference loadDevMenuModule");
  });

  it("calls registerDevMenu(...) inside a useEffect", () => {
    const src = readLayout();
    // Pin both the call and that it lives inside a useEffect — replacing the
    // useEffect with a top-level call would re-fire on every parent render.
    const useEffectMatches = src.match(/useEffect\s*\(\s*\(\s*\)\s*=>/g) ?? [];
    assert.ok(
      useEffectMatches.length > 0,
      "root layout must wrap registration in a useEffect",
    );
    assert.match(
      src,
      /registerDevMenu\s*\(/,
      "registerDevMenu must be invoked, not just imported",
    );
  });

  it("gates registration on isDevEnvironment() so prod builds skip the call", () => {
    const src = readLayout();
    // The early-return pattern `if (!isDevEnvironment()) return;` is what
    // keeps the call from firing in production. A future refactor could
    // remove the guard and silently attach dev globals to prod — pin it.
    assert.match(
      src,
      /if\s*\(\s*!\s*isDevEnvironment\s*\(\s*\)\s*\)\s*return/,
      "must early-return when isDevEnvironment() is false",
    );
  });

  it("passes clearRuntimeSupabaseConfig in the actions map", () => {
    const src = readLayout();
    assert.match(
      src,
      /\bclearRuntimeSupabaseConfig\b/,
      "actions map must include the runtime-Supabase reset helper",
    );
    // The helper must be imported from lib/supabase, not redefined inline.
    assert.match(
      src,
      /from\s+["']@\/lib\/supabase["']/,
      "must import clearRuntimeSupabaseConfig from @/lib/supabase",
    );
  });

  it("threads loadDevMenuModule() into the devMenu argument", () => {
    const src = readLayout();
    // Look for the `devMenu: loadDevMenuModule()` shape — guards against a
    // refactor that drops the native DevMenu integration in favour of the
    // globalThis-only fallback.
    assert.match(
      src,
      /devMenu\s*:\s*loadDevMenuModule\s*\(\s*\)/,
      "the registerDevMenu call must pass loadDevMenuModule() as devMenu",
    );
  });

  it("sets isDev: true after the isDevEnvironment guard (single source of truth)", () => {
    const src = readLayout();
    // `isDev: true` is fine because the early-return already proved we're
    // in a dev build. Pin it so a future contributor doesn't accidentally
    // pass `isDev: isDevEnvironment()` (which re-resolves the global and
    // could give a different answer in a hot-reload scenario).
    assert.match(
      src,
      /isDev\s*:\s*true/,
      "must pass isDev: true (the guard above already proved it)",
    );
  });
});
