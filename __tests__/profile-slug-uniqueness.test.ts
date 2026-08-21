import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ensureUniquePublicId,
  ensureUniqueUsername,
  FALLBACK_SLUG_SEED,
  slugifyProfileId,
  slugifyUsername,
  type ProfileIdentity,
} from "@/lib/social-helpers";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The two walks that pick a free profile ID, and the slugs they walk from.
 *
 * These lived in `lib/social-context.tsx` — behind React Native peers that
 * `tsx --test` cannot transform — so nothing had ever exercised them. The
 * collision loops in particular: a `while` that appends `-2`, `-3`, … had no
 * test at any suffix, and the branch that stamps a unique suffix onto a name
 * that slugifies to nothing could not be reached deterministically at all,
 * because it read the wall clock.
 *
 * The clock is an argument now, defaulted, so the branch has a fixed value to
 * assert. That is the whole reason `UniqueSuffix` exists — it is not
 * configuration anybody wants.
 */

/** A fixed suffix, so the last-resort branch is a value and not a timestamp. */
const FIXED = () => "9999";

const profile = (
  id: string,
  fields: Omit<ProfileIdentity, "id">,
): ProfileIdentity => ({ id, ...fields });

describe("slugifying a public profile ID", () => {
  it("lower-cases and hyphen-separates", () => {
    assert.equal(slugifyProfileId("Ada Lovelace"), "ada-lovelace");
    assert.equal(slugifyProfileId("  Ada   Lovelace  "), "ada-lovelace");
    assert.equal(slugifyProfileId("ada__lovelace!!"), "ada-lovelace");
  });

  it("collapses runs and trims leading and trailing separators", () => {
    assert.equal(slugifyProfileId("---ada---lovelace---"), "ada-lovelace");
  });

  it("falls back to the seed plus a suffix when nothing survives", () => {
    // The branch that could not be asserted before. Reachable in practice: a
    // Cyrillic display name, or an email whose local part is Cyrillic, leaves
    // nothing behind after `[^a-z0-9]` stripping.
    assert.equal(slugifyProfileId("Коллекционер", FIXED), `${FALLBACK_SLUG_SEED}-9999`);
    assert.equal(slugifyProfileId("！！！", FIXED), `${FALLBACK_SLUG_SEED}-9999`);
    assert.equal(slugifyProfileId("", FIXED), `${FALLBACK_SLUG_SEED}-9999`);
  });

  it("keeps digits, which are the only thing a numeric name leaves", () => {
    assert.equal(slugifyProfileId("2026"), "2026");
  });
});

describe("slugifying a username", () => {
  it("separates with underscores, not hyphens", () => {
    // The two slugs differ deliberately — a public ID appears in a URL and a
    // username does not — which is why they are two functions rather than one
    // with a separator parameter. A change that merged them would show here.
    assert.equal(slugifyUsername("Ada Lovelace"), "ada_lovelace");
    assert.equal(slugifyProfileId("Ada Lovelace"), "ada-lovelace");
  });

  it("keeps underscores that were already there, unlike the public ID", () => {
    assert.equal(slugifyUsername("ada_lovelace"), "ada_lovelace");
    assert.equal(slugifyProfileId("ada_lovelace"), "ada-lovelace");
  });

  it("falls back to the seed plus a suffix when nothing survives", () => {
    assert.equal(slugifyUsername("Коллекционер", FIXED), `${FALLBACK_SLUG_SEED}_9999`);
  });
});

describe("walking to a free public ID", () => {
  it("returns the slug itself when nobody has it", () => {
    const others = [profile("b", { publicId: "someone-else" })];
    assert.equal(ensureUniquePublicId("Ada Lovelace", others), "ada-lovelace");
  });

  it("appends -2 on the first collision", () => {
    const others = [profile("b", { publicId: "ada-lovelace" })];
    assert.equal(ensureUniquePublicId("Ada Lovelace", others), "ada-lovelace-2");
  });

  it("keeps walking past a run of taken suffixes", () => {
    // The loop had no test at any suffix. This is the one that would catch an
    // off-by-one, or a counter that stopped incrementing.
    const others = [
      profile("b", { publicId: "ada-lovelace" }),
      profile("c", { publicId: "ada-lovelace-2" }),
      profile("d", { publicId: "ada-lovelace-3" }),
    ];
    assert.equal(ensureUniquePublicId("Ada Lovelace", others), "ada-lovelace-4");
  });

  it("ignores a gap rather than filling it", () => {
    // Deliberate, and worth pinning because "reuse the first free number" is
    // the obvious alternative: the walk stops at the first FREE suffix, so a
    // deleted `-2` is handed out again.
    const others = [
      profile("b", { publicId: "ada-lovelace" }),
      profile("c", { publicId: "ada-lovelace-3" }),
    ];
    assert.equal(ensureUniquePublicId("Ada Lovelace", others), "ada-lovelace-2");
  });

  it("does not collide a profile with itself", () => {
    // The case that matters most in practice: re-saving a profile without
    // changing its ID must not renumber it. Without the `selfId` guard,
    // editing a bio would walk somebody from `ada-lovelace` to `ada-lovelace-2`
    // and again on the next save.
    const me = profile("me", { publicId: "ada-lovelace" });
    assert.equal(ensureUniquePublicId("Ada Lovelace", [me], "me"), "ada-lovelace");
    assert.equal(ensureUniquePublicId("Ada Lovelace", [me]), "ada-lovelace-2");
  });

  it("walks from the suffixed slug when the name survives nothing", () => {
    const others = [profile("b", { publicId: `${FALLBACK_SLUG_SEED}-9999` })];
    assert.equal(
      ensureUniquePublicId("Коллекционер", others, undefined, () => "9999"),
      `${FALLBACK_SLUG_SEED}-9999-2`,
    );
  });

  it("is not confused by profiles carrying no public ID at all", () => {
    const others = [profile("b", {}), profile("c", { username: "ada-lovelace" })];
    assert.equal(ensureUniquePublicId("Ada Lovelace", others), "ada-lovelace");
  });
});

describe("walking to a free username", () => {
  it("appends _2, matching the username separator rather than the ID one", () => {
    const others = [profile("b", { username: "ada_lovelace" })];
    assert.equal(ensureUniqueUsername("Ada Lovelace", others), "ada_lovelace_2");
  });

  it("keeps walking past a run of taken suffixes", () => {
    const others = [
      profile("b", { username: "ada_lovelace" }),
      profile("c", { username: "ada_lovelace_2" }),
    ];
    assert.equal(ensureUniqueUsername("Ada Lovelace", others), "ada_lovelace_3");
  });

  it("does not collide a profile with itself", () => {
    const me = profile("me", { username: "ada_lovelace" });
    assert.equal(ensureUniqueUsername("Ada Lovelace", [me], "me"), "ada_lovelace");
  });

  it("reads usernames and not public IDs", () => {
    // The two walks look identical and read different fields; a copy-paste
    // that left one reading the other's field would pass every case above.
    const others = [profile("b", { publicId: "ada_lovelace" })];
    assert.equal(ensureUniqueUsername("Ada Lovelace", others), "ada_lovelace");
  });
});

describe("the three fallback paths agree on one word", () => {
  it("normalizeProfile reads the shared constant rather than its own literal", () => {
    // `buildFallbackProfile`, `normalizeProfile` and both slugifiers all invent
    // a name for a profile that has none. They agreed by three separate
    // literals; now the constant is imported, so the agreement is structural.
    const source = readRepoFile("lib/social-context.tsx");
    assert.match(source, /\|\| FALLBACK_SLUG_SEED;/);
    assert.doesNotMatch(
      source,
      /\|\| "collector"/,
      "a fourth hand-written copy of the fallback word is back",
    );
  });

  it("both slugifiers build their last resort from the same seed", () => {
    assert.ok(slugifyProfileId("", FIXED).startsWith(FALLBACK_SLUG_SEED));
    assert.ok(slugifyUsername("", FIXED).startsWith(FALLBACK_SLUG_SEED));
  });
});
