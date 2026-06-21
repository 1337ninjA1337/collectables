import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// BE-36 — structural guard for the executable pgTAP FK/cascade test that runs
// in the BE-31 `supabase test db` harness (Docker runner only). This offline
// test asserts the SQL file exists and exercises the right surface; the actual
// referential-integrity assertions are validated on the PR's Supabase-test CI,
// not here (mirrors core-tables-rls-pgtap.test.ts).

const sql = readFileSync(
  path.join(process.cwd(), "supabase", "tests", "02_fk_cascade.sql"),
  "utf8",
);

describe("BE-36 — FK / cascade pgTAP test", () => {
  it("is a self-contained pgTAP plan", () => {
    assert.match(sql, /^\s*begin;/im);
    assert.match(sql, /select plan\(\d+\)/i);
    assert.match(sql, /select \* from finish\(\)/i);
    assert.match(sql, /rollback;/i);
  });

  it("declares a plan count matching the number of assertions", () => {
    const planMatch = sql.match(/select plan\((\d+)\)/i);
    assert.ok(planMatch, "plan(N) must be present");
    const declared = Number(planMatch![1]);
    const assertions = (sql.match(/select\s+(is|throws_ok|lives_ok)\(/gi) ?? [])
      .length;
    assert.equal(
      assertions,
      declared,
      `plan(${declared}) must equal the ${assertions} assertions present`,
    );
  });

  it("seeds auth.users so the FKs to auth resolve, then deletes the account", () => {
    assert.match(sql, /insert into auth\.users/i);
    assert.match(sql, /delete from auth\.users where id =/i);
  });

  it("rejects orphan inserts via 23503 (foreign_key_violation)", () => {
    assert.match(sql, /throws_ok/i);
    assert.match(sql, /'23503'/);
  });

  it("covers the collection -> items cascade", () => {
    assert.match(sql, /delete from public\.collections where id =/i);
    assert.match(sql, /cascades to its items/i);
  });

  it("asserts the account delete CASCADEs through every owned table", () => {
    for (const table of [
      "profiles",
      "collections",
      "items",
      "friend_requests",
      "chat_messages",
      "chat_reads",
      "marketplace_listings",
      "subscriptions",
    ]) {
      assert.match(
        sql,
        new RegExp(`cascades to (owned )?${table}`, "i"),
        `must assert the user-delete cascade for ${table}`,
      );
    }
  });

  it("asserts audit/analytics rows survive with their user id SET NULL", () => {
    assert.match(sql, /buyer_user_id is null/i);
    assert.match(sql, /owner_user_id is null/i);
    assert.match(sql, /analytics_events where name = 'app_open' and user_id is null/i);
  });
});
