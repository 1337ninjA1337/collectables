// Regenerates docs/powerbi/Collectables-Starter.pbit from the verifiable text
// assets (queries.m + measures.dax). Run via: tsx scripts/build-powerbi-template.ts
// The output is byte-deterministic so re-running never churns git.

import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbit } from "../lib/powerbi-template";

const POWERBI_DIR = path.join(__dirname, "..", "docs", "powerbi");
const QUERIES_M = path.join(POWERBI_DIR, "queries.m");
const MEASURES_DAX = path.join(POWERBI_DIR, "measures.dax");
const OUTPUT = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

function main(): void {
  for (const f of [QUERIES_M, MEASURES_DAX]) {
    if (!fs.existsSync(f)) {
      console.error(`[build-powerbi-template] missing source: ${f}`);
      process.exit(1);
    }
  }
  const queryM = fs.readFileSync(QUERIES_M, "utf8");
  const measuresDax = fs.readFileSync(MEASURES_DAX, "utf8");
  const pbit = buildPbit(queryM, measuresDax);
  fs.writeFileSync(OUTPUT, pbit);
  console.log(
    `[build-powerbi-template] wrote ${path.relative(process.cwd(), OUTPUT)} (${pbit.length} bytes)`,
  );
}

main();
