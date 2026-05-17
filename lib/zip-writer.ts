/**
 * Pure, deterministic ZIP writer + reader — Node built-ins only, no deps.
 *
 * Power BI `.pbit` / `.pbix` files are OPC (Open Packaging Conventions)
 * packages, i.e. plain ZIP archives. We need to emit one from CI without
 * pulling a ZIP dependency into the app bundle, and the committed binary
 * must be byte-stable across rebuilds so it doesn't churn git on every
 * `npm run build:pbit`.
 *
 * To guarantee that:
 *  - Entries use the STORED method (no compression) — no zlib version /
 *    compression-level variance, and the OPC reader in Power BI accepts it.
 *  - Timestamps are pinned to the DOS epoch (1980-01-01 00:00:00) instead
 *    of `Date.now()`, so the same inputs always produce the same bytes.
 *
 * Only the STORED method is supported by the reader (sufficient — we only
 * ever produce STORED archives ourselves; it exists so tests can round-trip
 * and the committed `.pbit` can be structurally validated in CI).
 */

const CRC32_TABLE: Uint32Array = (() => {
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

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// 1980-01-01 00:00:00 in DOS date/time encoding — the ZIP epoch. Pinned so
// the archive is reproducible (no wall-clock leakage into the bytes).
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(0, 6); // general purpose flags
    local.writeUInt16LE(0, 8); // compression method = stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size (== uncompressed)
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method = stored
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + entry.data.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralPart.length, 12); // central directory size
  eocd.writeUInt32LE(localPart.length, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localPart, centralPart, eocd]);
}

export function readZip(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("readZip: end-of-central-directory record not found");
  }

  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error("readZip: corrupt central directory header");
    }
    const method = buffer.readUInt16LE(p + 10);
    if (method !== 0) {
      throw new Error(`readZip: unsupported compression method ${method} (STORED only)`);
    }
    const size = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString("utf8", p + 46, p + 46 + nameLen);

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = Buffer.from(buffer.subarray(dataStart, dataStart + size));

    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}
