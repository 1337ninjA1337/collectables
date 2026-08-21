import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ensureUniquePublicId,
  ensureUniqueUsername,
  FALLBACK_SLUG_SEED,
  normalizeProfile,
  slugifyProfileId,
  slugifyUsername,
  slugSuffixFromSeed,
  stableSuffix,
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
  it("no file writes the fallback word out by hand", () => {
    // `buildFallbackProfile`, `normalizeProfile` and both slugifiers all invent
    // a name for a profile that has none. They agreed by three separate
    // literals until each moved onto the constant; this is what says none of
    // them drifted back. Both files are checked because the functions have
    // been migrating between them all evening.
    for (const file of ["lib/social-context.tsx", "lib/social-helpers.ts"]) {
      assert.doesNotMatch(
        readRepoFile(file),
        /\|\| "collector"/,
        `${file} writes the fallback word out by hand instead of reading FALLBACK_SLUG_SEED`,
      );
    }
    // And the constant is genuinely what the survivors read.
    assert.match(readRepoFile("lib/social-helpers.ts"), /\|\| FALLBACK_SLUG_SEED;/);
  });

  it("both slugifiers build their last resort from the same seed", () => {
    assert.ok(slugifyProfileId("", FIXED).startsWith(FALLBACK_SLUG_SEED));
    assert.ok(slugifyUsername("", FIXED).startsWith(FALLBACK_SLUG_SEED));
  });
});

/**
 * `normalizeProfile` runs on every profile the app holds, and it used to reach
 * for the email address.
 *
 * The chain was `publicId || username || displayName || email`. That last term
 * was reachable, not theoretical: `coerceProfileRow` turns a NULL column into
 * `""`, so a cloud row with no `public_id`, no `username` and no
 * `display_name` but a real address produced a public profile ID slugified
 * straight out of the address — `ada-lovelace-example-com`. `publicId` is the
 * identifier the app invites people to SHARE so others can find them, and it
 * is written back to the cloud row on the next save, so the address would
 * stick to the profile permanently.
 */
describe("normalizing a profile never derives a public ID from an email", () => {
  const sparse = {
    id: "u1",
    email: "ada.lovelace@example.com",
    displayName: "",
    username: "",
    publicId: "",
    bio: "",
    avatar: "",
  };

  it("gives a profile with nothing to name it the anonymous seed", () => {
    const normalized = normalizeProfile(sparse, FIXED);
    assert.equal(normalized.publicId, `${FALLBACK_SLUG_SEED}-9999`);
  });

  it("leaks no part of the address into the public ID", () => {
    // Asserted piece by piece rather than as one string, because a partial
    // leak — the local part without the domain, say — is the shape a careless
    // "fix" produces, and equality against the seed alone would not name it.
    const normalized = normalizeProfile(sparse, FIXED);
    for (const fragment of ["ada", "lovelace", "example", "com"]) {
      assert.ok(
        !normalized.publicId.includes(fragment),
        `'${fragment}' from the email address reached the public profile ID: ${normalized.publicId}`,
      );
    }
  });

  it("still prefers a real public ID, username or display name, in that order", () => {
    assert.equal(
      normalizeProfile({ ...sparse, publicId: "Chosen ID", username: "u", displayName: "D" }, FIXED)
        .publicId,
      "chosen-id",
    );
    assert.equal(
      normalizeProfile({ ...sparse, username: "ada_l", displayName: "Ada L" }, FIXED).publicId,
      "ada-l",
    );
    assert.equal(
      normalizeProfile({ ...sparse, displayName: "Ada Lovelace" }, FIXED).publicId,
      "ada-lovelace",
    );
  });

  it("normalizes the username without a suffix, which is the shipped behaviour", () => {
    // Deliberately unchanged: several nameless profiles share the username
    // `collector`, and adding a suffix here would rename profiles already
    // stored under it. `ensureUniqueUsername` resolves a clash when somebody
    // actually picks a name.
    assert.equal(normalizeProfile(sparse, FIXED).username, FALLBACK_SLUG_SEED);
    assert.equal(normalizeProfile({ ...sparse, username: "  Ada L! " }, FIXED).username, "ada_l");
  });

  it("leaves every other field alone", () => {
    const normalized = normalizeProfile({ ...sparse, bio: "hi", avatar: "a.png" }, FIXED);
    assert.equal(normalized.id, "u1");
    assert.equal(normalized.email, "ada.lovelace@example.com");
    assert.equal(normalized.bio, "hi");
    assert.equal(normalized.avatar, "a.png");
  });
});

/**
 * The suffix a name that slugifies to nothing gets, and why it is no longer the
 * clock.
 *
 * `String(Date.now())` was wrong in two directions at once. It is 13 digits in
 * an identifier the app asks a person to SHARE (`collector-1755823419233`), and
 * — the actual bug — it is a different value on every call. `normalizeProfile`
 * runs on every profile in a `useMemo` that recomputes on a language change or
 * an arriving friend request, and `buildFallbackProfile` runs inside the same
 * memo, so a user whose display name and email local part are both Cyrillic was
 * handed a NEW public ID every recompute. Nobody could find them by the ID on
 * their own screen, and the next save would write whichever one happened to be
 * current into the cloud row.
 *
 * Seeding the suffix on the account ID keeps the one property the clock was
 * there for — two such accounts must not collide — while making the result the
 * same on every call and on every device.
 */
describe("the seeded suffix for a name that slugifies to nothing", () => {
  const CYRILLIC = "Коллекционер";

  it("is the same value every time, which the wall clock was not", () => {
    assert.equal(slugSuffixFromSeed("user-1"), slugSuffixFromSeed("user-1"));
    assert.equal(stableSuffix("user-1")(), stableSuffix("user-1")());
  });

  it("differs between accounts, which is the collision the clock prevented", () => {
    const seeds = [
      "9f8a1c2e-0000-4000-8000-000000000001",
      "9f8a1c2e-0000-4000-8000-000000000002",
      "user-1",
      "user-2",
      "",
    ];
    const tokens = new Set(seeds.map(slugSuffixFromSeed));
    assert.equal(tokens.size, seeds.length);
  });

  it("is six characters of [a-z0-9], the alphabet the slugifier keeps", () => {
    // Anything outside `[a-z0-9]` would be appended AFTER slugification and so
    // would survive into the ID unstripped — a `-` or a `_` in the token would
    // read as a separator and a `+` would need percent-encoding in a URL.
    for (const seed of ["", "a", "user-1", "9f8a1c2e-0000-4000-8000-000000000001", "Коллекционер"]) {
      const token = slugSuffixFromSeed(seed);
      assert.match(token, /^[a-z0-9]{6}$/, `seed ${JSON.stringify(seed)} produced ${token}`);
    }
  });

  it("gives the same account the same public ID twice in a row", () => {
    // The regression, stated as directly as it can be: two calls, no injected
    // suffix, one profile. With the clock underneath this failed whenever the
    // two calls landed in different milliseconds.
    const anonymous = {
      id: "u1",
      email: "коллекционер@example.com",
      displayName: CYRILLIC,
      username: "",
      publicId: "",
      bio: "",
      avatar: "",
    };
    assert.equal(normalizeProfile(anonymous).publicId, normalizeProfile(anonymous).publicId);
    assert.match(normalizeProfile(anonymous).publicId, new RegExp(`^${FALLBACK_SLUG_SEED}-[a-z0-9]{6}$`));
  });

  it("still separates two accounts with equally unslugifiable names", () => {
    const one = normalizeProfile({
      id: "u1",
      email: "",
      displayName: CYRILLIC,
      username: "",
      publicId: "",
      bio: "",
      avatar: "",
    });
    const two = normalizeProfile({
      id: "u2",
      email: "",
      displayName: CYRILLIC,
      username: "",
      publicId: "",
      bio: "",
      avatar: "",
    });
    assert.notEqual(one.publicId, two.publicId);
  });

  it("no longer stamps a 13-digit timestamp into a shareable ID", () => {
    const id = slugifyProfileId(CYRILLIC, stableSuffix("u1"));
    assert.doesNotMatch(id, /\d{13}/);
    assert.ok(id.length <= FALLBACK_SLUG_SEED.length + 1 + 6, `too long to share: ${id}`);
  });

  it("does not leak the account ID it was seeded on", () => {
    // The seed is the auth UUID and the ID goes in a URL, so the one-way step
    // is load-bearing rather than incidental.
    const accountId = "9f8a1c2e-0000-4000-8000-000000000001";
    const id = slugifyProfileId(CYRILLIC, stableSuffix(accountId));
    for (const chunk of accountId.split("-")) {
      assert.ok(!id.includes(chunk), `${chunk} of the account ID reached the public ID: ${id}`);
    }
  });
});

describe("a public profile ID is safe to put in a URL", () => {
  it("survives encodeURIComponent unchanged, whatever the name was", () => {
    // The constraint the two slug alphabets exist to satisfy, asserted where it
    // can be checked — rather than as a comparison against `slugifyUsername`,
    // which is a second function that could drift in the same direction.
    const names = [
      "Ada Lovelace",
      "ada@example.com",
      "  ../../etc/passwd  ",
      "Коллекционер",
      "a?b&c=d#e",
      "100% Мой + твой",
      "",
    ];
    for (const name of names) {
      const id = slugifyProfileId(name, stableSuffix("u1"));
      assert.equal(encodeURIComponent(id), id, `${JSON.stringify(name)} produced ${id}`);
      assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${JSON.stringify(name)} produced ${id}`);
    }
  });
});

describe("the uniqueness walks read the profile list once", () => {
  it("still lands on the right suffix across a long run of collisions", () => {
    // The walk re-scanned the whole list per iteration, so 200 collisions cost
    // 200 full passes. Reading the list once is the same answer — this is the
    // case that says so at a size where an off-by-one in the rewrite shows.
    const others = Array.from({ length: 200 }, (_, i) =>
      profile(`p${i}`, { publicId: i === 0 ? "ada-lovelace" : `ada-lovelace-${i + 1}` }),
    );
    assert.equal(ensureUniquePublicId("Ada Lovelace", others), "ada-lovelace-201");
    assert.equal(
      ensureUniqueUsername(
        "Ada Lovelace",
        others.map((p, i) => profile(p.id, { username: i === 0 ? "ada_lovelace" : `ada_lovelace_${i + 1}` })),
      ),
      "ada_lovelace_201",
    );
  });

  it("does not treat a profile with an empty slug as holding one", () => {
    // `coerceProfileRow` turns a NULL column into `""`, so empty slugs are
    // normal in this list. A set built without skipping them would hold `""`,
    // which no candidate can equal — but a later `taken.has(base)` on an empty
    // base would then walk when it should not.
    const others = [profile("b", { publicId: "" }), profile("c", { username: "" })];
    assert.equal(ensureUniquePublicId("Ada Lovelace", others), "ada-lovelace");
    assert.equal(ensureUniqueUsername("Ada Lovelace", others), "ada_lovelace");
  });

  it("excludes every profile row carrying the self id, not just the first", () => {
    // The exclusion moved out of the loop condition and into the set build; a
    // duplicated self row is the shape that would catch a `find`-style rewrite.
    const me = [profile("me", { publicId: "ada-lovelace" }), profile("me", { publicId: "ada-lovelace-2" })];
    assert.equal(ensureUniquePublicId("Ada Lovelace", me, "me"), "ada-lovelace");
  });
});

describe("the fallback profile does not read the clock", () => {
  it("seeds its public-ID suffix on the account id", () => {
    // `buildFallbackProfile` is behind the React Native import wall, so this is
    // asserted about its source text. The behaviour it delegates to is covered
    // by the cases above; what this pins is that the call site still passes a
    // seed rather than falling back to `wallClockSuffix` by omission.
    const source = readRepoFile("lib/social-context.tsx");
    assert.match(source, /slugifyProfileId\(identity\.slugSeed,\s*stableSuffix\(user\.id\)\)/);
    assert.doesNotMatch(source, /slugifyProfileId\(identity\.slugSeed\)/);
  });

  it("seeds the edit path too, so a saved ID does not renumber per save", () => {
    const source = readRepoFile("lib/social-context.tsx");
    assert.match(source, /ensureUniquePublicId\(input\.publicId, profiles, user\.id, seeded\)/);
    assert.match(source, /ensureUniqueUsername\(input\.username, profiles, user\.id, seeded\)/);
  });
});
