import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { crc32, createZip, type ZipEntry } from "@/lib/zip-writer";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("crc32", () => {
  it("matches the canonical ZIP/IEEE check vector", () => {
    // CRC-32 of ASCII "123456789" is the well-known 0xCBF43926.
    assert.equal(crc32(enc("123456789")) >>> 0, 0xcbf43926);
  });

  it("is 0 for empty input", () => {
    assert.equal(crc32(new Uint8Array(0)) >>> 0, 0);
  });

  it("matches the lazy-dog vector", () => {
    assert.equal(
      crc32(enc("The quick brown fox jumps over the lazy dog")) >>> 0,
      0x414fa339,
    );
  });
});

/** Minimal STORED-only ZIP reader so the test verifies a real round-trip. */
function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate the End Of Central Directory record (no archive comment → -22).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, "EOCD signature must be present");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let n = 0; n < count; n += 1) {
    assert.equal(view.getUint32(ptr, true), 0x02014b50, "central dir sig");
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOff = view.getUint32(ptr + 42, true);
    const name = dec(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    assert.equal(view.getUint32(localOff, true), 0x04034b50, "local sig");
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const size = view.getUint32(localOff + 22, true); // uncompressed
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    out[name] = bytes.subarray(dataStart, dataStart + size);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("createZip", () => {
  const entries: ZipEntry[] = [
    { path: "a.txt", data: enc("hello") },
    { path: "nested/b.bin", data: new Uint8Array([0, 1, 2, 255, 128]) },
    { path: "empty", data: new Uint8Array(0) },
  ];

  it("produces an archive a standard reader can round-trip", () => {
    const zip = createZip(entries);
    const read = readZip(zip);
    assert.deepEqual(Object.keys(read).sort(), ["a.txt", "empty", "nested/b.bin"]);
    assert.equal(dec(read["a.txt"]), "hello");
    assert.deepEqual([...read["nested/b.bin"]], [0, 1, 2, 255, 128]);
    assert.equal(read["empty"].length, 0);
  });

  it("preserves entry order in the central directory", () => {
    const zip = createZip(entries);
    // The first central-dir name should be the first entry's path.
    const view = new DataView(zip.buffer);
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    const first = view.getUint32(eocd + 16, true);
    const nameLen = view.getUint16(first + 28, true);
    assert.equal(dec(zip.subarray(first + 46, first + 46 + nameLen)), "a.txt");
  });

  it("uses the STORED method (compression byte 0)", () => {
    const zip = createZip([{ path: "x", data: enc("y") }]);
    const view = new DataView(zip.buffer);
    assert.equal(view.getUint32(0, true), 0x04034b50, "local file sig");
    assert.equal(view.getUint16(8, true), 0, "method must be STORED");
  });

  it("is deterministic across rebuilds", () => {
    assert.deepEqual([...createZip(entries)], [...createZip(entries)]);
  });
});
