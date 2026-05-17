import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbit } from "@/lib/pbit-template";

const REPO = path.join(__dirname, "..");
const PBIT = path.join(REPO, "docs/powerbi/Collectables-Starter.pbit");

/** Extract one STORED entry's raw bytes from a ZIP (via the central dir). */
function extractEntry(bytes: Buffer, name: string): Buffer {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1);
  let ptr = bytes.readUInt32LE(eocd + 16);
  const count = bytes.readUInt16LE(eocd + 10);
  for (let n = 0; n < count; n += 1) {
    const nameLen = bytes.readUInt16LE(ptr + 28);
    const extraLen = bytes.readUInt16LE(ptr + 30);
    const commentLen = bytes.readUInt16LE(ptr + 32);
    const localOff = bytes.readUInt32LE(ptr + 42);
    const entryName = bytes
      .subarray(ptr + 46, ptr + 46 + nameLen)
      .toString("utf8");
    if (entryName === name) {
      const lNameLen = bytes.readUInt16LE(localOff + 26);
      const lExtraLen = bytes.readUInt16LE(localOff + 28);
      const size = bytes.readUInt32LE(localOff + 22);
      const start = localOff + 30 + lNameLen + lExtraLen;
      return bytes.subarray(start, start + size);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry ${name} not found`);
}

describe("Analytics #15b wiring", () => {
  it("package.json exposes the build:powerbi script", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO, "package.json"), "utf8"),
    );
    assert.equal(
      pkg.scripts["build:powerbi"],
      "tsx scripts/build-powerbi-template.ts",
    );
  });

  it("the build script imports the pure pbit builder (no re-roll)", () => {
    const script = fs.readFileSync(
      path.join(REPO, "scripts/build-powerbi-template.ts"),
      "utf8",
    );
    assert.match(script, /from "\.\.\/lib\/pbit-template"/);
    assert.match(script, /buildPbit/);
    assert.match(script, /measures\.dax/);
    assert.match(script, /queries\.m/);
  });

  it("ships the committed .pbit and it is a valid (PK) ZIP", () => {
    assert.ok(fs.existsSync(PBIT), "Collectables-Starter.pbit must be committed");
    const bytes = fs.readFileSync(PBIT);
    assert.equal(bytes[0], 0x50); // 'P'
    assert.equal(bytes[1], 0x4b); // 'K'
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  });

  it("the committed .pbit is byte-identical to a fresh rebuild", () => {
    const fresh = buildPbit({
      measuresDax: fs.readFileSync(
        path.join(REPO, "docs/powerbi/measures.dax"),
        "utf8",
      ),
      queriesM: fs.readFileSync(
        path.join(REPO, "docs/powerbi/queries.m"),
        "utf8",
      ),
    });
    assert.deepEqual([...new Uint8Array(fs.readFileSync(PBIT))], [...fresh]);
  });

  it("the .pbit contains the seven measures in its DataModelSchema", () => {
    const bytes = fs.readFileSync(PBIT);
    const schema = JSON.parse(
      extractEntry(bytes, "DataModelSchema").toString("utf16le"),
    );
    const names = schema.model.tables[0].measures.map(
      (m: { name: string }) => m.name,
    );
    assert.deepEqual(names, [
      "DAU",
      "ItemsAdded",
      "ListingsCreated",
      "ListingFunnelRate",
      "SignupsLast7d",
      "PremiumActivationsLast7d",
      "PremiumConversionRate7d",
    ]);
  });

  it("powerbi-connection.md §7 documents the template", () => {
    const doc = fs.readFileSync(
      path.join(REPO, "docs/powerbi-connection.md"),
      "utf8",
    );
    assert.match(doc, /Collectables-Starter\.pbit/);
    assert.match(doc, /Import → Power BI template|Power BI template/);
    assert.match(doc, /npm run build:powerbi/);
  });

  it("docs/powerbi/README.md points at the committed template", () => {
    const readme = fs.readFileSync(
      path.join(REPO, "docs/powerbi/README.md"),
      "utf8",
    );
    assert.match(readme, /Collectables-Starter\.pbit/);
    assert.match(readme, /build-powerbi-template\.ts/);
  });
});
