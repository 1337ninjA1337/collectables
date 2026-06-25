import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";

import {
  parseMigrationVersion,
  parseMigrations,
  findVersionCollisions,
  computeApplyOrder,
  formatApplyOrderReport,
} from "../lib/migration-apply-order";

/**
 * BE-34 — apply-order / timestamp-collision guard.
 *
 * `migration-versions-unique.test.ts` checks the live directory for duplicate
 * version prefixes; this suite proves the underlying detection logic actually
 * FAILS on a synthetic collision (so the guard can't silently rot), and that
 * the apply order Supabase derives from filenames is numeric, deterministic,
 * and strictly increasing on disk.
 */
describe("migration apply order (BE-34)", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  describe("parseMigrationVersion", () => {
    it("extracts the digits before the first underscore", () => {
      assert.equal(parseMigrationVersion("20260423_base_schema.sql"), "20260423");
      assert.equal(
        parseMigrationVersion("20260527142510_items_archived_at.sql"),
        "20260527142510",
      );
    });

    it("returns null for malformed names", () => {
      assert.equal(parseMigrationVersion("base_schema.sql"), null);
      assert.equal(parseMigrationVersion("20260423-base.sql"), null);
      assert.equal(parseMigrationVersion("20260423_base_schema.txt"), null);
      assert.equal(parseMigrationVersion("20260423_.sql"), null);
    });
  });

  describe("findVersionCollisions (the headline guard)", () => {
    it("FAILS on a synthetic timestamp collision", () => {
      const colliding = [
        "20260527_items_archived_at.sql",
        "20260527_marketplace_transfers.sql",
        "20260528_profile_display_currency.sql",
      ];
      const collisions = findVersionCollisions(colliding);
      assert.equal(collisions.length, 1);
      assert.equal(collisions[0].version, "20260527");
      assert.deepEqual(collisions[0].files, [
        "20260527_items_archived_at.sql",
        "20260527_marketplace_transfers.sql",
      ]);
      assert.match(
        formatApplyOrderReport(collisions),
        /timestamp collision/,
      );
    });

    it("reports nothing for distinct versions", () => {
      const distinct = [
        "20260527142510_items_archived_at.sql",
        "20260527_marketplace_transfers.sql",
      ];
      assert.deepEqual(findVersionCollisions(distinct), []);
      assert.equal(formatApplyOrderReport([]), "");
    });

    it("the live migrations directory has no collisions", () => {
      const collisions = findVersionCollisions(files);
      assert.equal(
        collisions.length,
        0,
        formatApplyOrderReport(collisions),
      );
    });
  });

  describe("parseMigrations", () => {
    it("separates malformed filenames and ignores non-sql files", () => {
      const { parsed, malformed } = parseMigrations([
        "20260423_base.sql",
        "broken.sql",
        "README.md",
      ]);
      assert.deepEqual(parsed, [{ file: "20260423_base.sql", version: "20260423" }]);
      assert.deepEqual(malformed, ["broken.sql"]);
    });

    it("the live migrations directory has no malformed filenames", () => {
      const { malformed } = parseMigrations(files);
      assert.deepEqual(malformed, []);
    });
  });

  describe("computeApplyOrder", () => {
    it("orders by numeric version, not lexicographically", () => {
      // Lexicographically "100_" < "9_" and "20260527142510_" < "20260527_";
      // numeric ordering must invert both.
      const order = computeApplyOrder([
        "9_b.sql",
        "100_c.sql",
        "20260527_late.sql",
        "20260527142510_early_date_later_time.sql",
      ]).map((m) => m.file);
      assert.deepEqual(order, [
        "9_b.sql",
        "100_c.sql",
        "20260527_late.sql",
        "20260527142510_early_date_later_time.sql",
      ]);
    });

    it("the live apply order is strictly increasing in version", () => {
      const order = computeApplyOrder(files);
      assert.equal(order.length, parseMigrations(files).parsed.length);
      for (let i = 1; i < order.length; i++) {
        assert.ok(
          BigInt(order[i].version) > BigInt(order[i - 1].version),
          `apply order not strictly increasing: ${order[i - 1].file} -> ${order[i].file}`,
        );
      }
    });
  });
});
