import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-12a — generalises the analytics anon/leak RLS verification
 * (`analytics-events-rls-verification.test.ts`) to the four core tables locked
 * down in `20260616_core_tables_rls.sql`. The executable cross-tenant proof is
 * pgTAP (BE-12b, runs in the BE-31 Docker harness); this guards the two things
 * a file-scanning CI step *can* assert offline:
 *   1. every core table has RLS ENABLED and at least one policy per command it
 *      supports (so it is never RLS-enabled-but-policyless = silently locked
 *      out, nor blanket-granted = leaking), and
 *   2. the server-authoritative `is_admin` column stays REVOKEd from end-user
 *      roles, and MANUAL-TASKS.md ships the operator-runnable leak check.
 */
const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260616_core_tables_rls.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");

// strip `-- ...` line comments so prose ("a policy ... would expose ...")
// doesn't trip the executable-SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

const CORE_TABLES = ["profiles", "collections", "items", "friend_requests"] as const;

describe("core tables — RLS enabled (BE-12a)", () => {
  for (const table of CORE_TABLES) {
    it(`enables RLS on public.${table}`, () => {
      assert.match(
        SQL,
        new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`),
        `RLS must be enabled on ${table} or its policies are inert`,
      );
    });
  }
});

describe("core tables — every table has policies (no RLS-without-policy lockout, no blanket grant)", () => {
  // Each table → the FOR <command> policies it is expected to expose. A table
  // that is RLS-enabled but missing one of these would either lock the app out
  // (no SELECT) or leak (a too-broad policy). friend_requests intentionally has
  // NO update policy (rows are immutable; unfriend = DELETE).
  const expected: Record<(typeof CORE_TABLES)[number], string[]> = {
    profiles: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    collections: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    items: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    friend_requests: ["SELECT", "INSERT", "DELETE"],
  };

  function policyCommandsFor(table: string): Set<string> {
    const cmds = new Set<string>();
    // Match: CREATE POLICY "..." ON public.<table> FOR <CMD>
    const re = new RegExp(
      `CREATE POLICY\\s+"[^"]+"\\s+ON public\\.${table}\\s+FOR\\s+(SELECT|INSERT|UPDATE|DELETE)`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(SQL)) !== null) {
      cmds.add(m[1]);
    }
    return cmds;
  }

  for (const table of CORE_TABLES) {
    it(`public.${table} declares exactly its expected per-command policies`, () => {
      const found = policyCommandsFor(table);
      assert.deepEqual(
        [...found].sort(),
        [...expected[table]].sort(),
        `${table} policy commands drifted from the documented model`,
      );
    });
  }

  it("friend_requests intentionally has NO update policy (rows immutable)", () => {
    assert.doesNotMatch(
      SQL,
      /CREATE POLICY\s+"[^"]+"\s+ON public\.friend_requests\s+FOR\s+UPDATE/,
    );
  });
});

describe("core tables — reads are scoped, not open (anon/leak posture)", () => {
  it("no core-table SELECT policy uses a bare USING (true)", () => {
    // A `USING (true)` SELECT policy on any gated table would leak every row.
    // profiles is a public directory but still gates on auth.uid() IS NOT NULL.
    const selectPolicies = SQL.match(
      /CREATE POLICY[\s\S]*?FOR SELECT[\s\S]*?(?=CREATE POLICY|ALTER TABLE|$)/g,
    );
    assert.ok(selectPolicies, "expected at least one SELECT policy");
    for (const policy of selectPolicies!) {
      assert.doesNotMatch(
        policy,
        /USING\s*\(\s*true\s*\)/i,
        "a USING (true) SELECT policy would leak every row",
      );
    }
  });

  it("collections + items SELECT route through can_view_collection (single visibility rule)", () => {
    assert.match(SQL, /ON public\.collections\s+FOR SELECT\s+USING \(public\.can_view_collection\(auth\.uid\(\), id\)\)/);
    assert.match(SQL, /ON public\.items\s+FOR SELECT\s+USING \(public\.can_view_collection\(auth\.uid\(\), collection_id\)\)/);
  });

  it("friend_requests reads are limited to the two parties", () => {
    assert.match(
      SQL,
      /ON public\.friend_requests\s+FOR SELECT\s+USING \(auth\.uid\(\) = from_user_id OR auth\.uid\(\) = to_user_id\)/,
    );
  });
});

describe("core tables — is_admin column stays server-authoritative", () => {
  it("REVOKEs UPDATE(is_admin) from both end-user roles", () => {
    assert.match(SQL, /REVOKE UPDATE \(is_admin\) ON public\.profiles FROM authenticated/);
    assert.match(SQL, /REVOKE UPDATE \(is_admin\) ON public\.profiles FROM anon/);
  });

  it("profiles DELETE policy is own-row-or-admin (not blanket)", () => {
    assert.match(
      SQL,
      /ON public\.profiles\s+FOR DELETE\s+USING \(auth\.uid\(\) = id OR public\.is_admin\(auth\.uid\(\)\)\)/,
    );
  });
});

describe("MANUAL-TASKS.md ships the core-tables leak check (BE-12a)", () => {
  it("documents the BE-11a leak check under the core_tables_rls section", () => {
    assert.match(MANUAL, /## 20260616_core_tables_rls\.sql/);
    assert.match(MANUAL, /RLS leak check \(BE-11a\)/);
  });

  it("exercises an end-user role and asserts the gated tables return zero rows", () => {
    assert.match(MANUAL, /SET ROLE authenticated;/);
    assert.match(MANUAL, /SELECT count\(\*\) FROM public\.collections;/);
    assert.match(MANUAL, /SELECT count\(\*\) FROM public\.items;/);
    assert.match(MANUAL, /SELECT count\(\*\) FROM public\.friend_requests;/);
  });
});
