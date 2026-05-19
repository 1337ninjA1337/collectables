import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbitBuffer, PBIT_RELATIVE_PATH } from "../lib/powerbi-template";

const REPO_ROOT = path.join(__dirname, "..");
const QUERIES_M = path.join(REPO_ROOT, "docs/powerbi/queries.m");
const MEASURES_DAX = path.join(REPO_ROOT, "docs/powerbi/measures.dax");
const PBIT_OUT = path.join(REPO_ROOT, PBIT_RELATIVE_PATH);

function main(): void {
  for (const f of [QUERIES_M, MEASURES_DAX]) {
    if (!fs.existsSync(f)) {
      console.error(`[build-powerbi-template] missing source asset: ${f}`);
      process.exit(1);
    }
  }
  const queriesM = fs.readFileSync(QUERIES_M, "utf8");
  const daxSource = fs.readFileSync(MEASURES_DAX, "utf8");
  const pbit = buildPbitBuffer(queriesM, daxSource);

  const existing = fs.existsSync(PBIT_OUT) ? fs.readFileSync(PBIT_OUT) : null;
  if (existing && existing.equals(pbit)) {
    console.log(`[build-powerbi-template] ${PBIT_RELATIVE_PATH} already up to date — skipping`);
    return;
  }
  fs.writeFileSync(PBIT_OUT, pbit);
  console.log(
    `[build-powerbi-template] wrote ${PBIT_RELATIVE_PATH} (${pbit.length} bytes)`,
  );
}

main();
