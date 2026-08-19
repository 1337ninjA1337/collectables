import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ZipFormatError,
  crc32,
  decodeZipEntryText,
  readZipEntries,
} from "../lib/zip-archive";
import { PBIT_PART_NAMES, zipStore } from "../lib/powerbi-template";
import { repoPath } from "./helpers/repo-file";
import { zipFixture } from "./helpers/zip-fixture";

const PBIT = repoPath("docs", "powerbi", "Collectables-Starter.pbit");

const utf16leWithBom = (text: string) =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

describe("readZipEntries", () => {
  it("reads a STORED archive, which is what this repo writes", () => {
    const zip = zipStore([
      { name: "a.txt", data: Buffer.from("hello", "utf8") },
      { name: "dir/b.bin", data: Buffer.from([1, 2, 3, 4]) },
    ]);
    const back = readZipEntries(zip);
    assert.equal(back["a.txt"].toString("utf8"), "hello");
    assert.ok(back["dir/b.bin"].equals(Buffer.from([1, 2, 3, 4])));
  });

  it("reads a DEFLATED archive, which is what every other tool writes", () => {
    // The store-only reader this replaced threw `unexpected compression
    // method 8` here, so a .pbit re-exported from Power BI Desktop — the only
    // kind that can carry a real connection string — was unreadable.
    const body = "x".repeat(500);
    const zip = zipFixture([{ name: "DataModelSchema", data: Buffer.from(body, "utf8") }], {
      deflate: true,
    });
    assert.ok(zip.length < 400, "the fixture is not actually compressed");
    assert.equal(readZipEntries(zip)["DataModelSchema"].toString("utf8"), body);
  });

  it("reads an entry whose local header has no sizes in it", () => {
    // Bit 3: crc and both sizes live in a trailing data descriptor. A reader
    // that walks local headers takes zero bytes for this entry and reports an
    // empty file — which, in a secret scan, is a pass.
    const body = "y".repeat(400);
    const zip = zipFixture([{ name: "Part", data: Buffer.from(body, "utf8") }], {
      deflate: true,
      streamed: true,
    });
    assert.equal(zip.readUInt32LE(18), 0, "the fixture's local header still carries sizes");
    assert.equal(readZipEntries(zip)["Part"].toString("utf8"), body);
  });

  it("skips directory entries and keeps the files under them", () => {
    const zip = zipFixture([
      { name: "sub/", data: Buffer.alloc(0) },
      { name: "sub/f.txt", data: Buffer.from("in", "utf8") },
    ]);
    assert.deepEqual(Object.keys(readZipEntries(zip)), ["sub/f.txt"]);
  });

  it("refuses a buffer that is not a zip", () => {
    assert.throws(
      () => readZipEntries(Buffer.from("PK not really", "utf8")),
      (error: unknown) =>
        error instanceof ZipFormatError && /end-of-central-directory/.test(error.message),
    );
  });

  it("refuses a compression method it cannot open, rather than dropping the entry", () => {
    // The failure this reader must never have: an entry nobody could read is
    // an entry nobody scanned, and a scan of nothing prints the same line as a
    // scan that found nothing.
    const zip = zipFixture([{ name: "Part", data: Buffer.from("body", "utf8") }]);
    // Method 14 (LZMA) in both the local and the central record.
    zip.writeUInt16LE(14, 8);
    zip.writeUInt16LE(14, zip.length - 22 - 46 - 4 + 10);
    assert.throws(
      () => readZipEntries(zip),
      (error: unknown) =>
        error instanceof ZipFormatError && /unsupported compression method 14/.test(error.message),
    );
  });

  it("refuses an entry whose contents do not match its CRC", () => {
    const zip = zipFixture([{ name: "Part", data: Buffer.from("body", "utf8") }]);
    const at = zip.indexOf(Buffer.from("body", "utf8"));
    zip.write("BODY", at, "utf8");
    assert.throws(
      () => readZipEntries(zip),
      (error: unknown) => error instanceof ZipFormatError && /CRC mismatch/.test(error.message),
    );
  });

  it("opens the committed .pbit and finds every declared part", () => {
    const entries = readZipEntries(readFileSync(PBIT));
    assert.deepEqual(Object.keys(entries).sort(), [...PBIT_PART_NAMES].sort());
  });
});

describe("decodeZipEntryText", () => {
  it("decodes the UTF-16LE parts a .pbit is made of", () => {
    assert.equal(decodeZipEntryText(utf16leWithBom('{"Version":4}')), '{"Version":4}');
  });

  it("decodes UTF-16BE, which node has no decoder for", () => {
    const be = Buffer.from("hi", "utf16le").swap16();
    assert.equal(decodeZipEntryText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), "hi");
  });

  it("strips a UTF-8 BOM and leaves plain UTF-8 alone", () => {
    assert.equal(decodeZipEntryText(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), "a");
    assert.equal(decodeZipEntryText(Buffer.from("<Types/>", "utf8")), "<Types/>");
  });

  it("never throws on bytes that are not text in any encoding", () => {
    assert.doesNotThrow(() => decodeZipEntryText(Buffer.from([0xff, 0xfe, 0x00])));
    assert.doesNotThrow(() => decodeZipEntryText(Buffer.from([0xfe, 0xff, 0x41])));
    assert.doesNotThrow(() => decodeZipEntryText(Buffer.from([0xc3])));
  });

  it("reads every text part of the committed template as JSON or XML", () => {
    // The end-to-end claim: the bytes in the archive become text a line
    // scanner can match against. Read as UTF-8 they parse as neither.
    const entries = readZipEntries(readFileSync(PBIT));
    const schema = decodeZipEntryText(entries["DataModelSchema"]);
    assert.doesNotThrow(() => JSON.parse(schema));
    assert.match(schema, /PostgreSQL\.Database/);
    assert.match(decodeZipEntryText(entries["[Content_Types].xml"]), /^<\?xml /);
  });
});
