/**
 * Reading a zip container, for the two places in this repository that have to
 * look inside one.
 *
 * It was one place until the secret scan needed the second. `lib/powerbi-
 * template.ts` writes a deterministic STORE-only archive and read its own
 * output back to assert the round-trip, so the reader it carried was allowed to
 * be store-only and to walk local headers from byte zero — both true of a file
 * this repository produced, and neither true of the file the secret scan is
 * actually afraid of.
 *
 * That file is a `.pbit` re-exported from Power BI Desktop by somebody who
 * filled the four connection parameters in with their real Supabase session
 * pooler values (see the header of `docs/powerbi/queries.m`, which instructs
 * exactly that) and committed the result. Desktop DEFLATES its parts, so a
 * store-only reader answers "unexpected compression method 8" rather than
 * scanning it, and it writes the central directory as the authority — a
 * streamed entry's local header can carry zeroes for both sizes with the real
 * ones in a trailing data descriptor. So this reader starts from the
 * end-of-central-directory record and inflates, which is what it takes to read
 * an archive this repository did not write.
 *
 * Node-only (`node:zlib`, `Buffer`) and never imported by app/RN code — the
 * same build-time-only position `lib/powerbi-template.ts` and
 * `lib/guard-root.ts` already hold.
 *
 * Every failure is a throw rather than a skipped entry: this reader's output
 * feeds a secret scan, where "read nothing" and "found nothing" print the same
 * line.
 */

import * as zlib from "node:zlib";

/** A zip this reader cannot turn into entries, with the reason in the message. */
export class ZipFormatError extends Error {
  constructor(message: string) {
    super(`ZipFormatError: ${message}`);
    this.name = "ZipFormatError";
  }
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** The value every zip64 field is set to in the 32-bit record that precedes it. */
const ZIP64_MARKER = 0xffffffff;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (the zip/PNG/zlib polynomial), used to write and to verify entries. */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Offset of the end-of-central-directory record.
 *
 * Searched backwards rather than computed, because the record is followed by a
 * variable-length archive comment of up to 64KiB — so its position is not a
 * function of the file's length. The scan is bounded by that maximum plus the
 * record's own 22 bytes; a buffer with no EOCD in that window is not a zip.
 */
function findEndOfCentralDirectory(buf: Buffer): number {
  const earliest = Math.max(0, buf.length - 22 - 0xffff);
  for (let pos = buf.length - 22; pos >= earliest; pos--) {
    if (buf.readUInt32LE(pos) === EOCD_SIG) return pos;
  }
  throw new ZipFormatError(
    `no end-of-central-directory record in ${buf.length} byte(s) — not a zip archive`,
  );
}

/** The bytes of one entry, decompressed and checked against its stored CRC. */
function inflateEntry(name: string, method: number, stored: Buffer, crc: number): Buffer {
  let data: Buffer;
  if (method === METHOD_STORE) {
    data = stored;
  } else if (method === METHOD_DEFLATE) {
    try {
      data = zlib.inflateRawSync(stored);
    } catch (error) {
      throw new ZipFormatError(
        `${name}: deflate stream did not inflate (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  } else {
    // Named rather than skipped: an entry this reader cannot open is an entry
    // nothing downstream looked at, and a scan that quietly passes over one is
    // the failure this module exists to avoid.
    throw new ZipFormatError(`${name}: unsupported compression method ${method}`);
  }
  const actual = crc32(data);
  if (actual !== crc) {
    throw new ZipFormatError(
      `${name}: CRC mismatch (header says ${crc.toString(16)}, contents are ${actual.toString(16)})`,
    );
  }
  return data;
}

/**
 * Every file entry in `buf`, keyed by its archive-relative name.
 *
 * Read from the central directory, which is the only place a zip is required
 * to state an entry's real sizes; the local header is then used for its own
 * name and extra-field lengths, because those two may legitimately differ from
 * the central copy and getting them from the wrong record puts the read offset
 * inside the data.
 *
 * Directory entries (a trailing `/`, size zero) are dropped — they carry no
 * bytes, and a caller iterating "the files in this archive" does not want them.
 * Zip64 is refused rather than half-supported.
 */
export function readZipEntries(buf: Buffer): Record<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const centralStart = buf.readUInt32LE(eocd + 16);
  if (centralStart === ZIP64_MARKER || count === 0xffff) {
    throw new ZipFormatError("zip64 archive — this reader handles the 32-bit format only");
  }
  if (centralStart > buf.length) {
    throw new ZipFormatError(
      `central directory starts at ${centralStart}, past the end of a ${buf.length} byte buffer`,
    );
  }

  const out: Record<string, Buffer> = {};
  let pos = centralStart;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIG) {
      throw new ZipFormatError(`central directory entry ${i + 1} of ${count} is missing or malformed`);
    }
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;

    if (compressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER) {
      throw new ZipFormatError(`${name}: zip64 sizes — this reader handles the 32-bit format only`);
    }
    if (name.endsWith("/")) continue;

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new ZipFormatError(`${name}: no local header at the offset the central directory gives`);
    }
    // The local record's own name/extra lengths — the extra field is routinely
    // a different length here than in the central copy.
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buf.length) {
      throw new ZipFormatError(`${name}: entry data runs past the end of the archive`);
    }
    out[name] = inflateEntry(name, method, buf.subarray(dataStart, dataStart + compressedSize), crc);
  }
  return out;
}

/**
 * One entry's bytes as text, honouring whichever byte-order mark it carries.
 *
 * Not a detail: every text part of a `.pbit` is UTF-16LE, so reading one as
 * UTF-8 yields a string in which every character is separated from the next by
 * a NUL byte — and a regex looking for `AKIA…`, a JWT or a PEM header finds
 * nothing in that, forever, silently.
 * That is the whole reason the extension list called this file unreadable.
 *
 * No BOM means UTF-8, which is the right guess for the one entry a `.pbit`
 * writes that way (`[Content_Types].xml`) and harmless for a binary entry: junk
 * text matches no rule, and this decoder never throws.
 */
export function decodeZipEntryText(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return data.subarray(2).toString("utf16le");
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    // UTF-16BE: node has no decoder for it, so swap to LE first. An odd
    // trailing byte would make `swap16` throw, so it is dropped — a truncated
    // final character is not worth refusing to scan a file over.
    const even = data.subarray(2, 2 + (((data.length - 2) / 2) | 0) * 2);
    return Buffer.from(even).swap16().toString("utf16le");
  }
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return data.subarray(3).toString("utf8");
  }
  return data.toString("utf8");
}
