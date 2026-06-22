import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DATA_EXPORT_TABLES,
  DATA_EXPORT_VERSION,
  buildDataExport,
  dataExportFileName,
  dataExportUrl,
  parseDataExport,
} from "../lib/data-export";

/**
 * BE-26 — behavioural tests for the pure data-export shapes consumed by the
 * `export-data` Edge Function + the `cloudExportData` client wrapper.
 */

describe("data-export — pure shapes (BE-26)", () => {
  describe("dataExportUrl", () => {
    it("targets the export-data Edge Function endpoint", () => {
      assert.equal(
        dataExportUrl("https://x.supabase.co"),
        "https://x.supabase.co/functions/v1/export-data",
      );
    });
  });

  describe("dataExportFileName", () => {
    it("derives a dated filename from the export timestamp", () => {
      assert.equal(
        dataExportFileName("2026-06-22T10:11:12.000Z"),
        "collectables-export-2026-06-22.json",
      );
    });

    it("falls back gracefully on a blank timestamp", () => {
      assert.equal(dataExportFileName(""), "collectables-export-export.json");
    });
  });

  describe("buildDataExport", () => {
    it("assembles every table into the versioned document", () => {
      const doc = buildDataExport({
        userId: "u1",
        exportedAt: "2026-06-22T00:00:00.000Z",
        profile: { id: "u1", username: "anto" },
        collections: [{ id: "c1" }],
        items: [{ id: "i1" }, { id: "i2" }],
        friendRequests: [{ id: "f1" }],
        chatMessages: [{ id: "m1" }],
        subscriptions: [{ user_id: "u1", status: "active" }],
      });
      assert.equal(doc.version, DATA_EXPORT_VERSION);
      assert.equal(doc.exportedAt, "2026-06-22T00:00:00.000Z");
      assert.equal(doc.userId, "u1");
      assert.deepEqual(doc.profile, { id: "u1", username: "anto" });
      assert.equal(doc.items.length, 2);
      assert.equal(doc.subscriptions[0].status, "active");
    });

    it("collapses missing/non-object reads to empty arrays + null profile", () => {
      const doc = buildDataExport({ userId: "u1" });
      assert.equal(doc.profile, null);
      for (const table of DATA_EXPORT_TABLES) {
        assert.deepEqual(doc[table], [], `${table} must default to []`);
      }
    });

    it("filters non-object entries out of table arrays", () => {
      const doc = buildDataExport({
        userId: "u1",
        collections: [{ id: "c1" }, null, "junk", 42, { id: "c2" }],
      });
      assert.equal(doc.collections.length, 2);
    });

    it("defaults exportedAt to a fresh ISO timestamp", () => {
      const before = Date.now();
      const doc = buildDataExport({ userId: "u1" });
      const at = Date.parse(doc.exportedAt);
      assert.ok(at >= before && at <= Date.now() + 1000);
    });
  });

  describe("parseDataExport", () => {
    it("round-trips a well-formed document", () => {
      const doc = buildDataExport({
        userId: "u1",
        collections: [{ id: "c1" }],
      });
      const parsed = parseDataExport(JSON.parse(JSON.stringify(doc)));
      assert.deepEqual(parsed, doc);
    });

    it("returns null for non-objects", () => {
      assert.equal(parseDataExport(null), null);
      assert.equal(parseDataExport("nope"), null);
      assert.equal(parseDataExport(42), null);
    });

    it("returns null when userId is missing or blank", () => {
      assert.equal(parseDataExport({ collections: [] }), null);
      assert.equal(parseDataExport({ userId: "" }), null);
    });

    it("coerces a partial document, filling missing tables with []", () => {
      const parsed = parseDataExport({ userId: "u1", items: [{ id: "i1" }] });
      assert.ok(parsed);
      assert.equal(parsed!.userId, "u1");
      assert.equal(parsed!.items.length, 1);
      assert.deepEqual(parsed!.collections, []);
      assert.equal(parsed!.profile, null);
    });
  });
});
