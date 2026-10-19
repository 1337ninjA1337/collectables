import assert from "node:assert/strict";

import { readRepoFile } from "./repo-file";

/**
 * Reading `clearAllUserData`'s body out of `lib/storage-keys.ts`, said once.
 *
 * Four suites had the same two lines — `src.match(/clearAllUserData[\s\S]*?\n\}/)`
 * followed by an `assert.ok(clearBlock, …)` — because each owns one storage key
 * and wants to assert that the account-deletion wipe removes it
 * (`CURRENCY_KEY`, `ENTRY_CURRENCY_KEY`, `PINNED_CURRENCIES_KEY`,
 * `CURRENCY_RATES_KEY`). The claims are right and belong where they are; the
 * READING was written four times, and on 2026-10-19 all four broke at once.
 *
 * They broke for the reason the regex was always going to: it anchors on the
 * NAME rather than on the declaration, so the moment the function grew a doc
 * comment mentioning its own name the match started at the comment and ended
 * at the first `\n}` inside it — a "body" containing prose and no keys, which
 * fails with a diff full of documentation and says nothing about the wipe.
 *
 * Anchored on `export async function` and brace-counted to the matching close,
 * which is the shape `helpers/migration-schema.ts`' `tableBody` settled on for
 * the same reason: a block that nests (an array literal, a `.map()` callback)
 * cannot be read by "up to the next closing brace at column zero".
 */
export function clearAllUserDataBody(): string {
  const source = readRepoFile("lib/storage-keys.ts");
  const opener = /export async function clearAllUserData\([^)]*\)\s*:[^{]*\{/.exec(source);
  assert.ok(opener, "lib/storage-keys.ts no longer declares clearAllUserData");
  const open = opener.index + opener[0].length - 1;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error("unterminated clearAllUserData body");
}
