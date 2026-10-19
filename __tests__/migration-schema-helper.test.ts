import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_MIGRATIONS_SQL,
  columnsOf,
  tableBody,
  uniqueIndexesOn,
} from "./helpers/migration-schema";

/**
 * The reader three suites now argue from.
 *
 * Every claim below is about THIS tree's committed SQL rather than about a
 * fixture, because that is what the callers rely on: `PROFILE_FIELDS`' rows,
 * `PROFILE_EXACT_SEARCH_LIMIT`'s premise and the REST builders' column parity
 * are all assertions whose other side is this function. A reader that silently
 * answered with an empty set would make all three vacuously agreeable, which
 * is the failure mode every derived rule in this repository has had once.
 */
describe("the migration read is not vacuous", () => {
  it("concatenated something", () => {
    assert.ok(ALL_MIGRATIONS_SQL.length > 10_000);
    assert.match(ALL_MIGRATIONS_SQL, /create\s+table/i);
  });

  it("strips comments, so prose cannot satisfy a schema assertion", () => {
    // `20260619_integrity_checks.sql` opens with a header listing the
    // constraints Postgres would not let it add — including a UNIQUE. Read
    // unstripped, that file asserts a constraint the database does not have,
    // which is the whole reason the strip is not optional.
    assert.ok(
      !ALL_MIGRATIONS_SQL.includes("undirected"),
      "a comment survived the strip — a documented constraint can now pass as a real one",
    );
  });
});

describe("tableBody", () => {
  it("isolates the CREATE TABLE block rather than any line naming the table", () => {
    const body = tableBody("profiles");
    assert.match(body, /\bpublic_id\b/);
    assert.ok(
      !/create\s+unique\s+index/i.test(body),
      "the index lines below the table leaked into its body",
    );
  });

  it("counts parens, so a nested DEFAULT does not end the block early", () => {
    // `created_at timestamptz NOT NULL DEFAULT now()` is the first nesting in
    // every table here, and a non-counting reader stops at its closing paren.
    const body = tableBody("profiles");
    assert.match(body, /default\s+now\(\)/i);
    assert.match(body, /\bcreated_at\b/);
  });

  it("names the table it could not find", () => {
    assert.throws(() => tableBody("not_a_table"), /CREATE TABLE public\.not_a_table/);
  });
});

describe("columnsOf", () => {
  it("reads the declared columns of public.profiles", () => {
    const columns = columnsOf("profiles");
    for (const column of ["id", "email", "display_name", "username", "public_id", "bio", "created_at"]) {
      assert.ok(columns.has(column), `${column} is declared and was not read`);
    }
  });

  it("includes a column a later ALTER TABLE added", () => {
    // `display_currency` arrives as an `ADD COLUMN IF NOT EXISTS`, and
    // `is_admin` only ever existed as one.
    assert.ok(columnsOf("profiles").has("display_currency"));
    assert.ok(columnsOf("profiles").has("is_admin"));
  });

  it("does not report a table-level constraint as a column", () => {
    const columns = columnsOf("profiles");
    for (const keyword of ["primary", "unique", "check", "constraint", "foreign"]) {
      assert.ok(!columns.has(keyword), `"${keyword}" was read as a column name`);
    }
  });
});

describe("uniqueIndexesOn", () => {
  it("finds the two unique lookup keys on profiles", () => {
    const unique = uniqueIndexesOn("profiles");
    assert.ok(unique.has("public_id"));
    assert.ok(unique.has("username"));
  });

  it("leaves display_name out, which is the whole point of the band split", () => {
    assert.ok(!uniqueIndexesOn("profiles").has("display_name"));
  });

  it("refuses to report a member of a COMPOSITE unique index", () => {
    // `friend_requests_pair_key` is UNIQUE on `(from_user_id, to_user_id)`,
    // which makes the PAIR unique and neither column. Counting its members
    // would be wrong rather than incomplete: one person can have many
    // outgoing requests.
    const unique = uniqueIndexesOn("friend_requests");
    assert.ok(!unique.has("from_user_id"));
    assert.ok(!unique.has("to_user_id"));
  });

  it("does not report the primary key, which answers a different question", () => {
    // `id` is unique and is also the thing every caller already knows is
    // unique. Including it would make the set mean "columns with at most one
    // row per value" rather than "columns a UNIQUE index was added for".
    assert.ok(!uniqueIndexesOn("profiles").has("id"));
  });
});
