import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DUPLICATE_SPECS,
  buildTablePageUrl,
  duplicateKeyForRow,
  findDuplicateGroups,
  renderAllDuplicateSql,
  renderDuplicateReport,
  renderDuplicateSql,
  selectColumns,
  type DuplicateSpec,
} from "../lib/db-duplicates";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const TEST_SPEC: DuplicateSpec = {
  table: "widgets",
  keyColumns: ["owner_id", "name"],
  foldCase: ["name"],
  skipBlank: ["name"],
  reportColumns: ["id", "created_at"],
  filters: ["deleted_at=is.null"],
  sqlWhere: "deleted_at IS NULL",
  reason: "test spec",
};

describe("duplicateKeyForRow", () => {
  it("case-folds and trims foldCase columns only", () => {
    const a = duplicateKeyForRow(TEST_SPEC, { owner_id: "U1", name: "  Coins " });
    const b = duplicateKeyForRow(TEST_SPEC, { owner_id: "U1", name: "coins" });
    const c = duplicateKeyForRow(TEST_SPEC, { owner_id: "u1", name: "coins" });
    assert.equal(a, b);
    assert.notEqual(a, c); // owner_id is NOT case-folded
  });

  it("skips rows with a blank skipBlank column", () => {
    assert.equal(duplicateKeyForRow(TEST_SPEC, { owner_id: "U1", name: "  " }), null);
    assert.equal(duplicateKeyForRow(TEST_SPEC, { owner_id: "U1", name: null }), null);
  });

  it("is collision-free when values contain spaces or the display separator", () => {
    const a = duplicateKeyForRow(TEST_SPEC, { owner_id: "U1 name=x", name: "y" });
    const b = duplicateKeyForRow(TEST_SPEC, { owner_id: "U1", name: "x name=y" });
    assert.notEqual(a, b);
  });
});

describe("findDuplicateGroups", () => {
  it("groups 2+ rows by natural key, largest group first", () => {
    const rows = [
      { id: 1, owner_id: "U1", name: "Coins", created_at: "a" },
      { id: 2, owner_id: "U1", name: "coins ", created_at: "b" },
      { id: 3, owner_id: "U1", name: "Stamps", created_at: "c" },
      { id: 4, owner_id: "U2", name: "coins", created_at: "d" },
      { id: 5, owner_id: "U2", name: "Coins", created_at: "e" },
      { id: 6, owner_id: "U2", name: "COINS", created_at: "f" },
    ];
    const result = findDuplicateGroups(TEST_SPEC, rows);
    assert.equal(result.scannedRows, 6);
    assert.equal(result.groups.length, 2);
    assert.equal(result.groups[0].rows.length, 3); // U2's triple sorts first
    assert.match(result.groups[0].key, /owner_id=U2 \| name=coins/);
    assert.equal(result.groups[1].rows.length, 2);
  });

  it("returns no groups for unique or skipped rows", () => {
    const rows = [
      { id: 1, owner_id: "U1", name: "A" },
      { id: 2, owner_id: "U1", name: "B" },
      { id: 3, owner_id: "U1", name: "" },
      { id: 4, owner_id: "U1", name: " " }, // blanks must not group together
    ];
    assert.equal(findDuplicateGroups(TEST_SPEC, rows).groups.length, 0);
  });
});

describe("buildTablePageUrl / selectColumns", () => {
  it("selects key + report columns without duplicates", () => {
    const spec = { ...TEST_SPEC, reportColumns: ["id", "owner_id"] };
    assert.deepEqual(selectColumns(spec), ["owner_id", "name", "id"]);
  });

  it("builds a PostgREST URL with filters, stable order and paging", () => {
    const url = buildTablePageUrl("https://x.supabase.co/", TEST_SPEC, 2000, 1000);
    assert.equal(
      url,
      "https://x.supabase.co/rest/v1/widgets?select=owner_id,name,id,created_at&deleted_at=is.null&order=id.asc&limit=1000&offset=2000",
    );
  });
});

describe("report + SQL rendering", () => {
  it("report is empty when every table is clean", () => {
    const clean = DUPLICATE_SPECS.map((spec) => ({ spec, scannedRows: 5, groups: [] }));
    assert.equal(renderDuplicateReport(clean), "");
  });

  it("report names the table, key, reason and per-row details", () => {
    const result = findDuplicateGroups(TEST_SPEC, [
      { id: 1, owner_id: "U1", name: "Coins", created_at: "2026-01-01" },
      { id: 2, owner_id: "U1", name: "coins", created_at: "2026-01-02" },
    ]);
    const report = renderDuplicateReport([result]);
    assert.match(report, /widgets — 1 group\(s\) in 2 scanned row\(s\)/);
    assert.match(report, /key: \(owner_id, name\) — test spec/);
    assert.match(report, /×2/);
    assert.match(report, /id=1 {2}created_at=2026-01-01/);
  });

  it("SQL folds the case-folded key columns and keeps the WHERE/HAVING shape", () => {
    const sql = renderDuplicateSql(TEST_SPEC);
    assert.match(sql, /SELECT owner_id, lower\(btrim\(name\)\), count\(\*\) AS copies/);
    assert.match(sql, /FROM public\.widgets/);
    assert.match(sql, /WHERE deleted_at IS NULL/);
    assert.match(sql, /GROUP BY owner_id, lower\(btrim\(name\)\)/);
    assert.match(sql, /HAVING count\(\*\) > 1/);
  });

  it("renderAllDuplicateSql covers every spec", () => {
    const sql = renderAllDuplicateSql();
    for (const spec of DUPLICATE_SPECS) {
      assert.match(sql, new RegExp(`FROM public\\.${spec.table}\\b`));
    }
  });
});

describe("DUPLICATE_SPECS — schema drift guards", () => {
  const migrations = readdirSync(path.join(ROOT, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => read(path.join("supabase", "migrations", f)))
    .join("\n");

  it("every spec's table and columns exist in the migrations", () => {
    for (const spec of DUPLICATE_SPECS) {
      assert.match(
        migrations,
        new RegExp(`public\\.${spec.table}\\b`),
        `${spec.table} missing from migrations`,
      );
      for (const column of selectColumns(spec)) {
        assert.match(
          migrations,
          new RegExp(`\\b${column}\\b`),
          `${spec.table}.${column} missing from migrations`,
        );
      }
    }
  });

  it("every spec orders by its first report column and every filter mirrors sqlWhere", () => {
    for (const spec of DUPLICATE_SPECS) {
      assert.ok(spec.reportColumns.length > 0, `${spec.table} needs a report column`);
      // Each PostgREST `col=is.null` filter must appear as `col IS NULL` in
      // the SQL twin so the two scan modes can never diverge silently.
      for (const filter of spec.filters) {
        const column = filter.split("=")[0];
        assert.match(
          spec.sqlWhere,
          new RegExp(`\\b${column} IS NULL\\b`),
          `${spec.table}: filter ${filter} not mirrored in sqlWhere`,
        );
      }
    }
  });

  it("tables whose natural key is their PRIMARY KEY are excluded", () => {
    const tables = DUPLICATE_SPECS.map((s) => s.table);
    assert.ok(!tables.includes("chat_reads"));
    assert.ok(!tables.includes("subscriptions"));
  });
});

describe("find-db-duplicates script wiring", () => {
  const script = read("scripts/find-db-duplicates.ts");

  it("package.json wires db:find-duplicates to the script", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts["db:find-duplicates"], /scripts\/find-db-duplicates\.ts/);
  });

  it("imports the pure helpers and the shared .env parser", () => {
    assert.match(script, /from\s+"\.\.\/lib\/db-duplicates"/);
    assert.match(script, /parseDotEnv.*from\s+"\.\.\/lib\/powerbi-conn"/s);
  });

  it("prefers the service-role key and warns on the publishable fallback", () => {
    assert.match(script, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(script, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    assert.match(script, /RLS limits the scan/);
  });

  it("is read-only (GET via fetch, no supabase-js, no mutation verbs)", () => {
    assert.ok(!/from\s+"@supabase/.test(script));
    assert.ok(!/method:\s*"(POST|PATCH|DELETE|PUT)"/i.test(script));
  });

  it("offers the no-network --sql mode and exits 1 on findings", () => {
    assert.match(script, /--sql/);
    assert.match(script, /renderAllDuplicateSql/);
    assert.match(script, /process\.exit\(1\)/);
  });
});
