import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { crc32, createZip, readZip } from "@/lib/zip-writer";

describe("crc32", () => {
  it("matches the canonical CRC-32 check vector for \"123456789\"", () => {
    // The ZIP/PKZIP CRC-32 of the ASCII string "123456789" is 0xCBF43926
    // (the IEEE 802.3 "check" value). A correct table-driven implementation
    // must produce exactly this.
    assert.equal(crc32(Buffer.from("123456789", "ascii")), 0xcbf43926);
  });

  it("returns 0 for empty input", () => {
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });

  it("is stable / deterministic across calls", () => {
    const buf = Buffer.from("collectables analytics events", "utf8");
    assert.equal(crc32(buf), crc32(buf));
  });
});

describe("createZip / readZip round-trip", () => {
  const entries = [
    { name: "Version", data: Buffer.from("1.0", "utf8") },
    { name: "nested/Report/Layout", data: Buffer.from([0xff, 0xfe, 0x7b, 0x00]) },
    { name: "empty", data: Buffer.alloc(0) },
  ];

  it("reads back exactly what was written", () => {
    const zip = createZip(entries);
    const back = readZip(zip);
    assert.equal(back.length, entries.length);
    for (let i = 0; i < entries.length; i++) {
      assert.equal(back[i].name, entries[i].name);
      assert.ok(back[i].data.equals(entries[i].data), `data mismatch for ${entries[i].name}`);
    }
  });

  it("produces a byte-identical archive for identical input (deterministic)", () => {
    // No wall-clock leakage — re-running the build must not churn git.
    assert.ok(createZip(entries).equals(createZip(entries)));
  });

  it("starts with the local-file-header signature and ends with EOCD", () => {
    const zip = createZip(entries);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  });

  it("throws a clear error when the EOCD record is missing", () => {
    assert.throws(() => readZip(Buffer.from("not a zip at all", "utf8")), /end-of-central-directory/);
  });
});
