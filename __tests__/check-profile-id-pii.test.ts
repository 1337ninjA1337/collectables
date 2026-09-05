import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  findProfileIdPii,
  formatProfileIdPiiReport,
  GUARDED_FIELDS,
} from "@/lib/check-profile-id-pii";

/**
 * The scanner behind `npm run lint:profile-id-pii`.
 *
 * Written the day the bug it describes was fixed, and the shape of the bug is
 * what the fixtures are built from: `normalizeProfile`'s `publicId` fell
 * through a `||` chain to `profile.email`, so a cloud row with NULL name
 * columns came out with its owner's address as a shared, searchable profile ID.
 *
 * The two things this has to get right are the two the bug had: a value
 * expression that WRAPS (the offending one spanned three lines), and the
 * difference between a raw address and a named intermediate carrying part of
 * one.
 */

const scan = (source: string) => findProfileIdPii("lib/x.ts", source);

describe("finding an email in a public identifier", () => {
  it("flags the shape the real bug had", () => {
    const found = scan(
      `const p = { publicId: slugify(profile.publicId || profile.username || profile.email) };`,
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].field, "publicId");
    assert.match(found[0].snippet, /profile\.email/);
  });

  it("reads a value that wraps across lines", () => {
    // The real one spanned three lines inside a call whose own arguments were
    // comma-separated, so "read to the next comma" and "read to end of line"
    // both truncate it before the offending term.
    const found = scan(
      [
        "const p = {",
        "  publicId: slugifyProfileId(",
        "    profile.publicId || profile.displayName || profile.email,",
        "    suffix,",
        "  ),",
        "};",
      ].join("\n"),
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
  });

  it("covers the snake_case column name as well as the camelCase field", () => {
    // `upsertProfileBody` writes `public_id`, so a leak could be introduced on
    // either side of the row/profile boundary.
    assert.equal(scan(`const row = { public_id: user.email };`).length, 1);
    assert.equal(scan(`const row = { publicId: user.email };`).length, 1);
  });

  it("covers username, which is also shared and searched", () => {
    assert.equal(scan(`const p = { username: user.email };`).length, 1);
  });

  it("reports each site rather than the first", () => {
    const found = scan(
      `const a = { publicId: x.email };\nconst b = { username: y.email };`,
    );
    assert.deepEqual(
      found.map((m) => m.field),
      ["publicId", "username"],
    );
  });
});

describe("what the rule deliberately allows", () => {
  it("passes a named intermediate carrying part of an address", () => {
    // The seam, and the reason the rule matches `email` as a whole word. An
    // email's local part DOES legitimately seed a username — but via a name
    // somebody had to write down and a reviewer can see, not inline.
    const found = scan(
      [
        "const emailName = user.email?.split('@')[0];",
        "const slugSeed = emailName ?? FALLBACK_SLUG_SEED;",
        "const p = { publicId: slugifyProfileId(slugSeed), username: slugSeed };",
      ].join("\n"),
    );
    assert.deepEqual(found, []);
  });

  it("does not match a longer identifier that merely contains the word", () => {
    assert.deepEqual(scan(`const p = { publicId: emailName };`), []);
    assert.deepEqual(scan(`const p = { username: userEmail };`), []);
    assert.deepEqual(scan(`const p = { publicId: email_name };`), []);
  });

  it("says nothing about the email field itself", () => {
    // `email: user.email ?? FALLBACK_PROFILE_EMAIL` is the correct code in
    // `resolveFallbackIdentity`. A rule that fired on it would be exempted
    // within a week.
    assert.deepEqual(scan(`const p = { email: user.email ?? FALLBACK };`), []);
  });

  it("says nothing about displayName, which IS meant to come from an address", () => {
    // Deliberately out of scope: somebody signing up as `ada@example.com`
    // should be called "ada" rather than "Collector". A rule that fires on
    // correct code is one somebody exempts and then ignores.
    assert.ok(!GUARDED_FIELDS.includes("displayName" as never));
    assert.deepEqual(scan(`const p = { displayName: user.email };`), []);
  });

  it("ignores comments, so prose about the rule is not a finding", () => {
    // This module's own doc block names the offending shape, and so does the
    // sentence the CLI prints.
    assert.deepEqual(
      scan(`// publicId: profile.email was the bug\nconst p = { publicId: slug };`),
      [],
    );
  });

  it("is not fooled by the word appearing inside a string", () => {
    assert.deepEqual(scan(`const p = { publicId: t("emailPlaceholder") };`), []);
    // …but a real reference in the same expression is still found.
    assert.equal(scan(`const p = { publicId: x("email") || u.email };`).length, 1);
  });
});

describe("what the report says", () => {
  it("names the file, line, field and expression, and what to do instead", () => {
    const report = formatProfileIdPiiReport([
      { file: "lib/x.ts", line: 12, field: "publicId", snippet: "profile.email" },
    ]);
    assert.match(report, /1 place\(s\)/);
    assert.match(report, /lib\/x\.ts:12 {2}publicId: profile\.email/);
    // The half a reader needs in order to fix it rather than silence it.
    assert.match(report, /NAMED intermediate/);
    assert.match(report, /written back to the cloud row/);
  });

  it("lists every finding", () => {
    const report = formatProfileIdPiiReport([
      { file: "a.ts", line: 1, field: "publicId", snippet: "u.email" },
      { file: "b.ts", line: 2, field: "username", snippet: "p.email" },
    ]);
    assert.match(report, /a\.ts:1/);
    assert.match(report, /b\.ts:2/);
  });
});
