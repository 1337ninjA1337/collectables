/**
 * Minimal, dependency-free ZIP archive writer (STORED / no compression).
 *
 * A `.pbit` Power BI template (Analytics #15) is an Open Packaging
 * Conventions package — i.e. a plain ZIP container. The repo has no
 * `jszip`/`archiver` dependency (and CLAUDE.md prefers not adding deps for
 * a single doc artifact), so this module emits a spec-correct ZIP by hand.
 *
 * STORED entries (compression method 0) are valid ZIP and valid OPC; Power
 * BI Desktop opens them without complaint. The implementation is pure (no
 * `react-native`, no node-only globals beyond the typed-array primitives it
 * needs) so it is unit-testable under `tsx --test`.
 */

export type ZipEntry = {
  /** Forward-slash path inside the archive, e.g. `Report/Layout`. */
  readonly path: string;
  /** Raw bytes for the entry. */
  readonly data: Uint8Array;
};

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, the polynomial ZIP uses). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Method 0 = STORED. Version 20 = baseline ZIP feature level. */
const STORED = 0;
const VERSION = 20;

/**
 * Serialise the given entries into a single ZIP byte array. Entry order is
 * preserved (Power BI does not require a specific ordering, but determinism
 * keeps the committed `.pbit` diff-stable across rebuilds).
 */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8(entry.path);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    writeU32(lv, 0, LOCAL_HEADER_SIG);
    writeU16(lv, 4, VERSION);
    writeU16(lv, 6, 0); // general purpose flag
    writeU16(lv, 8, STORED);
    writeU16(lv, 10, 0); // mod time (fixed for determinism)
    writeU16(lv, 12, 0); // mod date (fixed for determinism)
    writeU32(lv, 14, crc);
    writeU32(lv, 18, size); // compressed size (== uncompressed for STORED)
    writeU32(lv, 22, size); // uncompressed size
    writeU16(lv, 26, nameBytes.length);
    writeU16(lv, 28, 0); // extra field length
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    writeU32(cv, 0, CENTRAL_HEADER_SIG);
    writeU16(cv, 4, VERSION); // version made by
    writeU16(cv, 6, VERSION); // version needed
    writeU16(cv, 8, 0); // flag
    writeU16(cv, 10, STORED);
    writeU16(cv, 12, 0); // mod time
    writeU16(cv, 14, 0); // mod date
    writeU32(cv, 16, crc);
    writeU32(cv, 20, size);
    writeU32(cv, 24, size);
    writeU16(cv, 28, nameBytes.length);
    writeU16(cv, 30, 0); // extra
    writeU16(cv, 32, 0); // comment length
    writeU16(cv, 34, 0); // disk number start
    writeU16(cv, 36, 0); // internal attrs
    writeU32(cv, 38, 0); // external attrs
    writeU32(cv, 42, offset); // local header offset
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);

    offset += localHeader.length + entry.data.length;
  }

  const centralSize = centralChunks.reduce((n, c) => n + c.length, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  writeU32(ev, 0, EOCD_SIG);
  writeU16(ev, 4, 0); // this disk
  writeU16(ev, 6, 0); // central dir start disk
  writeU16(ev, 8, entries.length);
  writeU16(ev, 10, entries.length);
  writeU32(ev, 12, centralSize);
  writeU32(ev, 16, centralOffset);
  writeU16(ev, 20, 0); // comment length

  const total =
    offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of localChunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(eocd, cursor);
  return out;
}
