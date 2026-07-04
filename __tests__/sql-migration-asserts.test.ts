import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertColumns,
  assertCreatesTable,
  assertIndex,
  assertManualTasksDocuments,
  assertNoPolicies,
  assertRlsEnabled,
  loadMigrationSource,
} from "./helpers/sql-migration-asserts";

/**
 * Functional coverage for the shared migration-assert helpers, so a future
 * regex tweak can't silently weaken every migration test at once. Each helper
 * is exercised both ways: passes on a conforming synthetic migration, throws
 * on a non-conforming one.
 */

const GOOD_SQL = `
CREATE TABLE IF NOT EXISTS public.widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS widgets_owner_created_idx
  ON public.widgets (owner_id, created_at DESC);

ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;
`;

const POLICY_SQL = `${GOOD_SQL}
CREATE POLICY "widgets_select_owner" ON public.widgets FOR SELECT USING (true);
`;

describe("sql-migration-asserts helpers", () => {
  it("assertCreatesTable passes on the idempotent shape and rejects a bare CREATE TABLE", () => {
    assertCreatesTable(GOOD_SQL, "widgets");
    assert.throws(
      () => assertCreatesTable("CREATE TABLE public.widgets (id uuid);", "widgets"),
      /missing idempotent CREATE TABLE/,
    );
    // A table whose name merely prefixes another must not match (word boundary).
    assert.throws(() => assertCreatesTable(GOOD_SQL, "widget"), /widget/);
  });

  it("assertColumns passes when every column is present and names the missing one", () => {
    assertColumns(GOOD_SQL, ["id", "owner_id", "label", "created_at"]);
    assert.throws(
      () => assertColumns(GOOD_SQL, ["id", "deleted_at"]),
      /missing column declaration for 'deleted_at'/,
    );
  });

  it("assertIndex matches name + literal column expression, in order", () => {
    assertIndex(GOOD_SQL, "widgets_owner_created_idx", "owner_id, created_at DESC");
    assert.throws(
      () => assertIndex(GOOD_SQL, "widgets_label_idx", "label"),
      /missing index 'widgets_label_idx'/,
    );
    // Right name, wrong column expression must also fail.
    assert.throws(
      () => assertIndex(GOOD_SQL, "widgets_owner_created_idx", "label DESC"),
      /missing index/,
    );
  });

  it("assertRlsEnabled requires the exact ALTER TABLE ... ENABLE shape", () => {
    assertRlsEnabled(GOOD_SQL, "widgets");
    assert.throws(
      () => assertRlsEnabled(GOOD_SQL, "gadgets"),
      /missing ENABLE ROW LEVEL SECURITY for 'public\.gadgets'/,
    );
  });

  it("assertNoPolicies passes on default-deny SQL and rejects a named policy", () => {
    assertNoPolicies(GOOD_SQL, "widgets");
    assert.throws(
      () => assertNoPolicies(POLICY_SQL, "widgets"),
      /unexpected CREATE POLICY mentioning 'widgets'/,
    );
  });

  it("assertManualTasksDocuments checks MANUAL-TASKS.md for the filename and extra mentions", () => {
    // A migration that is genuinely documented today.
    assertManualTasksDocuments("20260508_analytics_events.sql", [
      "analytics_events",
    ]);
    assert.throws(
      () => assertManualTasksDocuments("20990101_not_a_real_migration.sql"),
      /does not document '20990101_not_a_real_migration\.sql'/,
    );
    assert.throws(
      () =>
        assertManualTasksDocuments("20260508_analytics_events.sql", [
          "definitely_not_mentioned_anywhere_zz",
        ]),
      /does not mention 'definitely_not_mentioned_anywhere_zz'/,
    );
  });

  it("loadMigrationSource reads from supabase/migrations and throws on a missing file", () => {
    const viaHelper = loadMigrationSource("20260424_chat_messages.sql");
    const direct = readFileSync(
      path.join(process.cwd(), "supabase", "migrations", "20260424_chat_messages.sql"),
      "utf8",
    );
    assert.equal(viaHelper, direct);
    assert.throws(() => loadMigrationSource("20990101_missing.sql"));
  });

  it("special regex characters in inputs are treated literally", () => {
    // A dot in the expression must not act as a wildcard.
    const sql = "CREATE INDEX IF NOT EXISTS x_idx ON t (lower(name));";
    assertIndex(sql, "x_idx", "lower(name)");
    assert.throws(() => assertIndex(sql, "x_idx", "lower(nameX"), /missing index/);
  });

  it("is adopted by the two seed migration tests", () => {
    for (const file of [
      "analytics-events-migration.test.ts",
      "chat-messages-migration.test.ts",
    ]) {
      const source = readFileSync(
        path.join(process.cwd(), "__tests__", file),
        "utf8",
      );
      assert.match(
        source,
        /from "\.\/helpers\/sql-migration-asserts"/,
        `${file} does not import the shared migration asserts`,
      );
      assert.doesNotMatch(
        source,
        /new RegExp\(`\\\\b\$\{column\}/,
        `${file} still re-rolls the per-column regex locally`,
      );
    }
  });
});
