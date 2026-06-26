import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * BE-25 — verify `delete-account` cascades through EVERY table that references
 * `auth.users`, and guard against future drift.
 *
 * The `delete-account` Edge Function's terminal step is
 * `auth.admin.deleteUser(userId)`. Every table that references `auth.users`
 * must therefore carry an explicit ON DELETE action so that delete either
 * removes the row (CASCADE — owned data) or scrubs the PII while keeping the
 * audit row (SET NULL — marketplace/analytics history). A NO ACTION FK would
 * make the account un-deletable (23503).
 *
 * The executable proof lives in the Docker-only pgTAP test
 * `supabase/tests/02_fk_cascade.sql` (seeds an account, deletes it, asserts the
 * cascade/SET-NULL outcome per table). This offline test is the *drift guard*:
 * it derives the full set of `auth.users`-referencing (table → ON DELETE
 * action) pairs straight from the migrations, then asserts each one is actually
 * exercised by that pgTAP test. Adding a new table with an `auth.users` FK
 * (like BE-22a's `subscriptions`, which the original BE-36 test missed) now
 * fails here until its cascade coverage is added — the gap BE-25 closes.
 */

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const PGTAP = readFileSync(
  path.join(ROOT, "supabase", "tests", "02_fk_cascade.sql"),
  "utf8",
);
const DELETE_ACCOUNT = readFileSync(
  path.join(ROOT, "supabase", "functions", "delete-account", "index.ts"),
  "utf8",
);

type Action = "cascade" | "set null";

// ---------------------------------------------------------------------------
// Derive { table -> set of ON DELETE actions } for every FK → auth.users by
// scanning the migrations. `currentTable` tracks the most recent CREATE/ALTER
// TABLE target, because a `references auth.users` always appears inside that
// statement (inline column def or ADD COLUMN continuation line).
// ---------------------------------------------------------------------------
function deriveAuthUserFks(): Map<string, Set<Action>> {
  const fks = new Map<string, Set<Action>>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const sql = raw.replace(/--.*$/gm, ""); // strip line comments
    let currentTable: string | null = null;

    for (const line of sql.split("\n")) {
      const create = line.match(/create table (?:if not exists )?public\.(\w+)/i);
      if (create) currentTable = create[1];
      const alter = line.match(/alter table (?:only )?public\.(\w+)/i);
      if (alter) currentTable = alter[1];

      if (!/references\s+auth\.users/i.test(line)) continue;
      assert.ok(currentTable, `auth.users FK with no table context in ${file}: ${line.trim()}`);

      const action: Action = /on delete set null/i.test(line)
        ? "set null"
        : /on delete cascade/i.test(line)
          ? "cascade"
          : (assert.fail(
              `auth.users FK in ${file} has no explicit ON DELETE action (NO ACTION would make accounts un-deletable): ${line.trim()}`,
            ) as never);

      if (!fks.has(currentTable)) fks.set(currentTable, new Set());
      fks.get(currentTable)!.add(action);
    }
  }
  return fks;
}

const FKS = deriveAuthUserFks();

describe("BE-25 — delete-account cascade coverage", () => {
  it("found the expected universe of auth.users FK tables (drift guard)", () => {
    // If a migration adds a NEW table referencing auth.users, this set changes
    // and the assertion fails — forcing the new table into the cascade story.
    const expected = [
      "analytics_events",
      "chat_messages",
      "chat_reads",
      "collections",
      "friend_requests",
      "items",
      "marketplace_listings",
      "marketplace_transfers",
      "profiles",
      "subscriptions",
    ];
    assert.deepEqual([...FKS.keys()].sort(), expected);
  });

  it("every auth.users FK declares an explicit CASCADE or SET NULL action", () => {
    for (const [table, actions] of FKS) {
      assert.ok(actions.size > 0, `${table} has no parsed ON DELETE action`);
      for (const action of actions) {
        assert.ok(
          action === "cascade" || action === "set null",
          `${table} has an unexpected ON DELETE action: ${action}`,
        );
      }
    }
  });

  it("the pgTAP test asserts the CASCADE outcome for every owned table", () => {
    for (const [table, actions] of FKS) {
      if (!actions.has("cascade")) continue;
      assert.match(
        PGTAP,
        new RegExp(`cascades to (owned )?${table}`, "i"),
        `02_fk_cascade.sql must assert the account-delete cascade for ${table}`,
      );
    }
  });

  it("the pgTAP test asserts the SET-NULL survival for every audit table", () => {
    for (const [table, actions] of FKS) {
      if (!actions.has("set null")) continue;
      assert.match(
        PGTAP,
        new RegExp(`from public\\.${table} where[^)]*is null`, "i"),
        `02_fk_cascade.sql must assert ${table} survives with its user id SET NULL`,
      );
    }
  });

  it("delete-account ends in the terminal auth.admin.deleteUser that fires the cascades", () => {
    // The whole cascade story hangs off this one privileged call; the manual
    // pre-deletes above it are only a belt-and-braces fast path.
    assert.match(DELETE_ACCOUNT, /auth\.admin\.deleteUser\(userId\)/);
    // The subject is always the validated caller, never a body-supplied id.
    // SEC-9: the caller is verified by the shared assertCaller gate.
    assert.match(DELETE_ACCOUNT, /const userId = caller\.user\.id/);
    assert.match(DELETE_ACCOUNT, /assertCaller\(req,\s*["']delete-account["']\)/);
  });

  it("the pgTAP plan count matches its assertions after adding subscriptions", () => {
    const planMatch = PGTAP.match(/select plan\((\d+)\)/i);
    assert.ok(planMatch);
    const declared = Number(planMatch![1]);
    const assertions = (PGTAP.match(/select\s+(is|throws_ok|lives_ok)\(/gi) ?? [])
      .length;
    assert.equal(assertions, declared);
    // subscriptions cascade is the 23rd assertion this task added.
    assert.equal(declared, 23);
  });
});
