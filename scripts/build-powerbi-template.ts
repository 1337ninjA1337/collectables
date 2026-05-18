import * as fs from "node:fs";
import * as path from "node:path";

import { buildPbit } from "../lib/powerbi-template";

const REPO_ROOT = path.join(__dirname, "..");
const POWERBI_DIR = path.join(REPO_ROOT, "docs", "powerbi");
const QUERIES_M = path.join(POWERBI_DIR, "queries.m");
const MEASURES_DAX = path.join(POWERBI_DIR, "measures.dax");
const OUT_PBIT = path.join(POWERBI_DIR, "Collectables-Starter.pbit");

function main(): void {
  for (const f of [QUERIES_M, MEASURES_DAX]) {
    if (!fs.existsSync(f)) {
      console.error(`[build-powerbi-template] missing source: ${f}`);
      process.exit(1);
    }
  }
  const queriesM = fs.readFileSync(QUERIES_M, "utf8");
  const measuresDax = fs.readFileSync(MEASURES_DAX, "utf8");
  const pbit = buildPbit({ queriesM, measuresDax });
  fs.writeFileSync(OUT_PBIT, pbit);
  console.log(
    `[build-powerbi-template] wrote ${path.relative(REPO_ROOT, OUT_PBIT)} (${pbit.length} bytes)`,
  );
}

main();
