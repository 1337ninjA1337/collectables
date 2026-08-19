/**
 * Writing a zip the way a real tool writes one, for the suites that read one.
 *
 * `lib/powerbi-template.ts`'s `zipStore` is not usable as a fixture here: it is
 * the deterministic STORE-only writer that produces the committed `.pbit`, so
 * an archive built with it can only ever exercise the half of the reader this
 * repository's own output already covers. Every other tool — Power BI Desktop
 * included, which is the writer whose output can carry a real credential —
 * deflates.
 */

import * as zlib from "node:zlib";

import { crc32 } from "../../lib/zip-archive";

/**
 * One archive, built to order.
 *
 * Two differences and both are the point. `deflate` compresses the entry, so a
 * store-only reader refuses it — that is what Power BI Desktop produces, and
 * the committed template (STORED, written by this repo) can never exercise it.
 * `streamed` additionally sets general-purpose bit 3 and zeroes the crc and
 * both sizes in the LOCAL header, moving the real values into a trailing data
 * descriptor: the shape any writer that does not know an entry's length before
 * compressing it emits, and the shape a reader that trusts local headers gets
 * an empty entry from.
 */
export function zipFixture(
  entries: readonly { name: string; data: Buffer }[],
  options: { deflate?: boolean; streamed?: boolean } = {},
): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const stored = options.deflate ? zlib.deflateRawSync(entry.data) : entry.data;
    const crc = crc32(entry.data);
    const flags = options.streamed ? 0x08 : 0;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(options.deflate ? 8 : 0, 8);
    header.writeUInt32LE(options.streamed ? 0 : crc, 14);
    header.writeUInt32LE(options.streamed ? 0 : stored.length, 18);
    header.writeUInt32LE(options.streamed ? 0 : entry.data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    const descriptor = Buffer.alloc(options.streamed ? 16 : 0);
    if (options.streamed) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(stored.length, 8);
      descriptor.writeUInt32LE(entry.data.length, 12);
    }
    local.push(header, nameBuf, stored, descriptor);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(options.deflate ? 8 : 0, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(stored.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(nameBuf.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBuf);

    offset += header.length + nameBuf.length + stored.length + descriptor.length;
  }

  const centralDir = Buffer.concat(central);
  const localData = Buffer.concat(local);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralDir, eocd]);
}

